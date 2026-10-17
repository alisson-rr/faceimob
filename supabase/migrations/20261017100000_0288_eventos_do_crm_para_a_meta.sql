-- =============================================================================
-- 0288 · Eventos do CRM para a Meta (API de Conversões para CRM)
--
-- Pedido de 17/10/2026: devolver à Meta o que acontece com cada lead do Lead
-- Ads, para ela otimizar as campanhas por lead que vira venda, e não só por
-- formulário preenchido. Substitui a conexão da Leadfy (desligada pelo cliente).
--
-- Cinco etapas, cada uma enviada UMA vez por lead:
--   · Lead atendido          — o corretor faz o primeiro contato;
--   · Visita agendada        — visita marcada no lead ou no negócio dele;
--   · Enviado para análise   — o caso abre na esteira do CCA;
--   · Crédito aprovado       — o caso é aprovado na CCA;
--   · Virou negócio          — Status 2 em VIROU NEGÓCIO.
--
-- Só lead que veio do Lead Ads (tem o `leadgen_id` da Meta em `external_id`):
-- é por ele que a Meta casa o evento com o anúncio. O negócio chega ao lead por
-- `deals.lead_id` ou pelo vínculo do telefone (`deal_lead_links`, 0269).
--
-- Os gatilhos só ENFILEIRAM (`meta_crm_events`). Quem envia é a edge
-- `meta-crm-events`, chamada pelo pg_cron a cada 5 min; sem token/conjunto de
-- dados cadastrados em Integrações ela não envia nada e a fila espera.
-- =============================================================================

create table if not exists public.meta_crm_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  event_name  text not null check (event_name in
                ('Lead atendido', 'Visita agendada', 'Enviado para análise', 'Crédito aprovado', 'Virou negócio')),
  event_time  timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    int not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (lead_id, event_name)
);

create index if not exists meta_crm_events_pendentes_idx
  on public.meta_crm_events (created_at) where status = 'pending';

comment on table public.meta_crm_events is
  'Fila dos eventos do CRM para a API de Conversões da Meta (0288): um por lead e etapa; a edge meta-crm-events envia.';

-- Só o admin acompanha a fila pela tela; quem escreve são os gatilhos e a edge.
alter table public.meta_crm_events enable row level security;
drop policy if exists meta_crm_events_select on public.meta_crm_events;
create policy meta_crm_events_select on public.meta_crm_events
  for select to authenticated using (public.is_admin());
revoke all on public.meta_crm_events from anon, authenticated;
grant select on public.meta_crm_events to authenticated;
grant all on public.meta_crm_events to service_role;

-- -----------------------------------------------------------------------------
-- Enfileirar: ignora lead sem `leadgen_id` e etapa já enfileirada.
-- -----------------------------------------------------------------------------
create or replace function public.meta_crm_enfileirar(p_lead_id uuid, p_evento text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lead_id is null then return; end if;
  insert into public.meta_crm_events (lead_id, event_name)
  select l.id, p_evento
    from public.leads l
   where l.id = p_lead_id
     and l.external_id ~ '^[0-9]{6,}$'
  on conflict (lead_id, event_name) do nothing;
end;
$$;
revoke all on function public.meta_crm_enfileirar(uuid, text) from public, anon, authenticated;

create or replace function public.lead_do_negocio(p_deal_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select d.lead_id from public.deals d where d.id = p_deal_id),
    (select k.lead_id from public.deal_lead_links k where k.deal_id = p_deal_id));
$$;
revoke all on function public.lead_do_negocio(uuid) from public, anon, authenticated;

-- 1. Lead atendido -------------------------------------------------------------
create or replace function public.meta_crm_lead_atendido()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.meta_crm_enfileirar(new.id, 'Lead atendido');
  return null;
end;
$$;
revoke all on function public.meta_crm_lead_atendido() from public, anon, authenticated;

drop trigger if exists meta_crm_lead_atendido on public.leads;
create trigger meta_crm_lead_atendido
  after update of first_contact_at on public.leads
  for each row
  when (old.first_contact_at is null and new.first_contact_at is not null)
  execute function public.meta_crm_lead_atendido();

-- 2. Visita agendada -----------------------------------------------------------
create or replace function public.meta_crm_visita()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.meta_crm_enfileirar(coalesce(new.lead_id, public.lead_do_negocio(new.deal_id)), 'Visita agendada');
  return null;
end;
$$;
revoke all on function public.meta_crm_visita() from public, anon, authenticated;

drop trigger if exists meta_crm_visita on public.visits;
create trigger meta_crm_visita
  after insert on public.visits
  for each row execute function public.meta_crm_visita();

-- 3 e 4. Enviado para análise e crédito aprovado --------------------------------
create or replace function public.meta_crm_caso_cca()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.meta_crm_enfileirar(public.lead_do_negocio(new.deal_id), 'Enviado para análise');
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform public.meta_crm_enfileirar(public.lead_do_negocio(new.deal_id), 'Crédito aprovado');
  end if;
  return null;
end;
$$;
revoke all on function public.meta_crm_caso_cca() from public, anon, authenticated;

drop trigger if exists meta_crm_caso_cca on public.cca_cases;
create trigger meta_crm_caso_cca
  after insert or update of status on public.cca_cases
  for each row execute function public.meta_crm_caso_cca();

-- 5. Virou negócio -------------------------------------------------------------
create or replace function public.meta_crm_virou_negocio()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.deal_status_bare(new.status_detail) in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'VIROU NEGÓCIO COM PENDÊNCIAS')
     and public.deal_status_bare(old.status_detail) is distinct from public.deal_status_bare(new.status_detail) then
    perform public.meta_crm_enfileirar(public.lead_do_negocio(new.id), 'Virou negócio');
  end if;
  return null;
end;
$$;
revoke all on function public.meta_crm_virou_negocio() from public, anon, authenticated;

drop trigger if exists meta_crm_virou_negocio on public.deals;
create trigger meta_crm_virou_negocio
  after update of status_detail on public.deals
  for each row
  when (new.status_detail is distinct from old.status_detail)
  execute function public.meta_crm_virou_negocio();

-- -----------------------------------------------------------------------------
-- Lote para a edge: reserva até 200 eventos pendentes (ou com falha e menos de
-- 5 tentativas) e devolve o que a Meta precisa para casar o lead.
-- -----------------------------------------------------------------------------
create or replace function public.meta_crm_reservar(p_limite int default 200)
returns table (id uuid, event_name text, event_time timestamptz, leadgen_id text, phone text, email text)
language sql
security definer
set search_path = public, pg_temp
as $$
  with alvo as (
    select e.id from public.meta_crm_events e
     where e.status = 'pending' or (e.status = 'failed' and e.attempts < 5)
     order by e.created_at
     limit least(greatest(coalesce(p_limite, 200), 1), 500)
     for update skip locked
  ), reservado as (
    update public.meta_crm_events e
       set attempts = e.attempts + 1
      from alvo where e.id = alvo.id
    returning e.id, e.event_name, e.event_time, e.lead_id
  )
  select r.id, r.event_name, r.event_time, l.external_id, l.phone, l.email::text
    from reservado r join public.leads l on l.id = r.lead_id;
$$;
revoke all on function public.meta_crm_reservar(int) from public, anon, authenticated;
grant execute on function public.meta_crm_reservar(int) to service_role;

-- -----------------------------------------------------------------------------
-- Disparo pelo pg_cron: só chama a edge quando há o que enviar.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_meta_crm_events()
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.meta_crm_events e
                  where e.status = 'pending' or (e.status = 'failed' and e.attempts < 5)) then
    return false;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;
  if v_url is null or v_key is null then
    raise warning 'dispatch_meta_crm_events: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;

  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/meta-crm-events',
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  return true;
end;
$$;
revoke all on function public.dispatch_meta_crm_events() from public, anon, authenticated;
grant execute on function public.dispatch_meta_crm_events() to service_role;

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0288] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-crm-events') then
      perform cron.unschedule('faceimob-meta-crm-events');
    end if;
    perform cron.schedule('faceimob-meta-crm-events', '*/5 * * * *', $cmd$select public.dispatch_meta_crm_events();$cmd$);
  exception when others then
    raise warning '[0288] não foi possível agendar o envio à Meta: %', sqlerrm;
  end;
end
$do$;
