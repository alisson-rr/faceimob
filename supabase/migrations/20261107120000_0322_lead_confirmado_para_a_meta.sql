-- =============================================================================
-- 0322 · "LeadConfirmado" para a Meta (API de Conversões)
--
-- Pedido de 07/11/2026: a Meta só recebe "Lead atendido" (primeiro contato do
-- corretor), e é por ele que ~5 conjuntos otimizam hoje. Faltava o sinal de
-- lead qualificado de verdade: o card chegar em "Interesse confirmado".
--
-- O que muda:
--   · evento NOVO `LeadConfirmado`, enfileirado UMA vez por lead quando o
--     `funnel_stage` entra em `hot` (Interesse confirmado) ou numa etapa depois
--     dela (Visita combinada, Pronto para proposta, Documentação) sem ter
--     passado por `hot` — o corretor às vezes pula a coluna;
--   · além do lead do Lead Ads (`leadgen_id`), entra o lead do anúncio
--     clique-para-WhatsApp que guardou o `ctwa_clid` (0254, `raw_payload`);
--   · `meta_crm_reservar` devolve também o `ctwa_clid`.
--
-- O que NÃO muda: "Lead atendido" e as outras quatro etapas continuam com o
-- mesmo gatilho, o mesmo `meta_crm_enfileirar` e o mesmo payload. Nenhuma
-- campanha que otimiza por eles perde ou ganha sinal.
-- =============================================================================

alter table public.meta_crm_events drop constraint if exists meta_crm_events_event_name_check;
alter table public.meta_crm_events add constraint meta_crm_events_event_name_check
  check (event_name in ('Lead atendido', 'Visita agendada', 'Enviado para análise',
                        'Crédito aprovado', 'Virou negócio', 'LeadConfirmado'));

-- -----------------------------------------------------------------------------
-- Enfileirar o LeadConfirmado: Lead Ads OU clique-para-WhatsApp com ctwa_clid.
-- Separado do `meta_crm_enfileirar` de propósito: aquele continua só Lead Ads.
-- -----------------------------------------------------------------------------
create or replace function public.meta_crm_enfileirar_confirmado(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lead_id is null then return; end if;
  insert into public.meta_crm_events (lead_id, event_name)
  select l.id, 'LeadConfirmado'
    from public.leads l
   where l.id = p_lead_id
     and (l.external_id ~ '^[0-9]{6,}$'
          or nullif(l.raw_payload #>> '{whatsapp_anuncio,ctwaClid}', '') is not null)
  on conflict (lead_id, event_name) do nothing;
end;
$$;
revoke all on function public.meta_crm_enfileirar_confirmado(uuid) from public, anon, authenticated;

create or replace function public.meta_crm_lead_confirmado()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.meta_crm_enfileirar_confirmado(new.id);
  return null;
end;
$$;
revoke all on function public.meta_crm_lead_confirmado() from public, anon, authenticated;

drop trigger if exists meta_crm_lead_confirmado on public.leads;
create trigger meta_crm_lead_confirmado
  after update of funnel_stage on public.leads
  for each row
  when (new.funnel_stage::text in ('hot', 'scheduled_visit', 'qualified', 'gathering_docs')
        and old.funnel_stage::text not in ('hot', 'scheduled_visit', 'qualified', 'gathering_docs'))
  execute function public.meta_crm_lead_confirmado();

-- -----------------------------------------------------------------------------
-- Reserva: mesma regra da 0288, com o `ctwa_clid` a mais no retorno. Mudar as
-- colunas de retorno exige drop + create; a edge antiga ignora a coluna nova.
-- -----------------------------------------------------------------------------
drop function if exists public.meta_crm_reservar(int);
create function public.meta_crm_reservar(p_limite int default 200)
returns table (id uuid, event_name text, event_time timestamptz, leadgen_id text, phone text, email text, ctwa_clid text)
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
  select r.id, r.event_name, r.event_time, l.external_id, l.phone, l.email::text,
         nullif(l.raw_payload #>> '{whatsapp_anuncio,ctwaClid}', '')
    from reservado r join public.leads l on l.id = r.lead_id;
$$;
revoke all on function public.meta_crm_reservar(int) from public, anon, authenticated;
grant execute on function public.meta_crm_reservar(int) to service_role;
