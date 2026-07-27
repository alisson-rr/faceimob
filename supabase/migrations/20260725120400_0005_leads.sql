-- =============================================================================
-- 0005 · Leads, roleta e check-in operacional
--
-- O coração do sistema. Regras de negócio que este arquivo implementa,
-- todas vindas das atas:
--
--   · lead chega por API (Meta/WhatsApp) e entra numa roleta
--   · a roleta só considera quem tem check-in aberto no turno corrente
--   · o corretor tem N segundos (padrão 300) para agir; senão o lead volta à fila
--   · clicar em "atender" trava o lead com ele e para o cronômetro
--   · corretor com 20+ leads vencidos não consegue fazer check-in
--   · todo movimento do lead fica registrado, com espaço para comentário manual
-- =============================================================================

-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id          uuid primary key default gen_random_uuid(),

  -- Identificação
  full_name   text not null check (length(btrim(full_name)) > 0),
  phone       text,        -- normalizado por trigger; é por aqui que se deduplica
  phone_raw   text,        -- como veio na origem, para auditoria
  email       extensions.citext,
  document    text,

  -- Origem e rastreio. "O sistema deve manter o histórico completo do lead,
  -- incluindo dados de origem (UTM, ID de campanha, página), permitindo
  -- identificar quais campanhas e imagens estão gerando maior conversão."
  source_id             uuid references public.lead_sources(id) on delete set null,
  distribution_group_id uuid references public.distribution_groups(id) on delete set null,
  form_id       text,
  -- ID do provedor (leadgen_id da Meta). Torna o webhook idempotente.
  external_id   text,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_id         text,
  ad_name       text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  landing_page  text,
  raw_payload   jsonb,

  -- Estado operacional
  status        lead_status not null default 'queued',
  funnel_stage  lead_funnel_stage not null default 'new',
  assigned_to   uuid references public.profiles(id) on delete set null,
  assigned_at   timestamptz,
  -- Prazo da trava de atendimento. Preenchido na atribuição, zerado quando o
  -- corretor assume o lead. NULL = sem cronômetro correndo.
  attend_deadline timestamptz,

  first_contact_at timestamptz,
  last_activity_at timestamptz not null default now(),
  -- Vencimento da próxima ação. É o que define "lead atrasado".
  next_action_at   timestamptz,

  -- Qualificação pela IA de SDR antes de cair para os corretores.
  sdr_qualified_at timestamptz,

  -- Desfecho
  converted_at timestamptz,
  lost_reason  text,
  lost_at      timestamptz,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_assigned_consistency
    check (status not in ('assigned','attending') or assigned_to is not null),
  constraint leads_lost_consistency
    check ((status = 'lost') = (lost_at is not null))
);

-- Idempotência do webhook: o mesmo leadgen_id nunca entra duas vezes.
create unique index leads_external_id_idx on public.leads (external_id)
  where external_id is not null;

create index leads_assigned_idx     on public.leads (assigned_to, status);
create index leads_status_idx       on public.leads (status);
create index leads_phone_idx        on public.leads (phone) where phone is not null;
create index leads_created_idx      on public.leads (created_at desc);
create index leads_campaign_idx     on public.leads (campaign_id) where campaign_id is not null;
-- Suporta a varredura de expirados, que roda a cada poucos segundos.
create index leads_deadline_idx     on public.leads (attend_deadline)
  where attend_deadline is not null;
-- Suporta a contagem de atrasados por corretor (bloqueio de check-in).
create index leads_overdue_idx      on public.leads (assigned_to, next_action_at)
  where status in ('assigned','attending','in_progress');

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Telefone é a chave prática de dedupe; normalizar na escrita evita ter que
-- normalizar em toda consulta.
create or replace function public.leads_normalize()
returns trigger
language plpgsql
as $$
begin
  if new.phone_raw is null and new.phone is not null then
    new.phone_raw := new.phone;
  end if;
  new.phone := public.normalize_phone(coalesce(new.phone, new.phone_raw));
  new.full_name := btrim(new.full_name);
  return new;
end;
$$;

create trigger leads_normalize
  before insert or update of phone, phone_raw, full_name on public.leads
  for each row execute function public.leads_normalize();

-- -----------------------------------------------------------------------------
-- lead_assignments — cada passagem do lead pela roleta.
-- Preserva quantas voltas o lead deu e quem deixou vencer.
-- -----------------------------------------------------------------------------
create table public.lead_assignments (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  group_id       uuid references public.distribution_groups(id) on delete set null,
  sequence       int  not null default 1,
  assigned_at    timestamptz not null default now(),
  deadline       timestamptz not null,
  responded_at   timestamptz,
  released_at    timestamptz,
  release_reason lead_release_reason,

  constraint lead_assignments_release_consistency
    check ((released_at is null) = (release_reason is null))
);

create index lead_assignments_lead_idx    on public.lead_assignments (lead_id, sequence desc);
create index lead_assignments_profile_idx on public.lead_assignments (profile_id, assigned_at desc);
-- Uma atribuição aberta por lead.
create unique index lead_assignments_one_open
  on public.lead_assignments (lead_id) where released_at is null;

-- -----------------------------------------------------------------------------
-- lead_events — log automático da jornada. Nunca editável.
-- -----------------------------------------------------------------------------
create table public.lead_events (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null,
  from_value text,
  to_value   text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

-- -----------------------------------------------------------------------------
-- lead_comments — anotações manuais. "O registro histórico deve permitir
-- comentários manuais para manter um log de toda a movimentação do lead,
-- possibilitando que corretores, gerentes e a equipe do CCA registrem
-- observações específicas."
-- Separado de lead_events porque é conteúdo humano: editável e removível pelo
-- autor, enquanto o log automático é imutável.
-- -----------------------------------------------------------------------------
create table public.lead_comments (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_comments_lead_idx on public.lead_comments (lead_id, created_at desc);

create trigger lead_comments_set_updated_at
  before update on public.lead_comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- lead_attachments — documentos anexados ainda na fase de lead.
-- Ao converter em negócio os anexos são promovidos para deal_documents (0006).
-- -----------------------------------------------------------------------------
create table public.lead_attachments (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  document_type_id uuid references public.document_types(id) on delete set null,
  storage_path     text not null unique,
  original_name    text not null,
  stored_name      text not null,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index lead_attachments_lead_idx on public.lead_attachments (lead_id);

-- =============================================================================
-- Roleta
-- =============================================================================

-- Turno vigente agora. NULL fora das janelas configuradas.
create or replace function public.current_shift(at_time timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
  from public.work_shifts s
  where s.active
    and (at_time at time zone 'America/Sao_Paulo')::time
        between s.checkin_start and s.checkout_time
  order by s.position
  limit 1;
$$;

-- Quantos leads vencidos o corretor acumula. Base do bloqueio de check-in.
create or replace function public.overdue_lead_count(who uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.leads l
  where l.assigned_to = who
    and l.status in ('assigned','attending','in_progress')
    and l.next_action_at is not null
    and l.next_action_at < now();
$$;

-- "Criar um bloqueio automático para usuários com mais de 20 leads atrasados."
-- Retorna o motivo em vez de só um booleano: a tela de check-in precisa
-- explicar ao corretor por que ele está travado.
create or replace function public.checkin_eligibility(who uuid default auth.uid())
returns table (allowed boolean, reason text, overdue_count int, threshold int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_overdue   int;
  v_threshold int;
  v_status    profile_status;
begin
  select p.status into v_status from public.profiles p where p.id = who;
  select s.overdue_block_threshold into v_threshold from public.automation_settings s where s.id;

  v_overdue   := public.overdue_lead_count(who);
  v_threshold := coalesce(v_threshold, 20);

  if v_status is null then
    return query select false, 'Perfil não encontrado.', 0, v_threshold;
  elsif v_status <> 'active' then
    return query select false, 'Perfil inativo.', v_overdue, v_threshold;
  elsif v_overdue >= v_threshold then
    return query select false,
      format('Você tem %s leads atrasados. Regularize até %s para liberar o check-in.',
             v_overdue, v_threshold - 1),
      v_overdue, v_threshold;
  else
    return query select true, null::text, v_overdue, v_threshold;
  end if;
end;
$$;

-- Check-in do corretor. Valida IP, turno e bloqueio por atraso numa transação
-- só — impossível burlar chamando as partes separadamente pelo client.
create or replace function public.perform_checkin(client_ip inet default null)
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who      uuid := auth.uid();
  v_shift    uuid;
  v_ok       boolean;
  v_reason   text;
  v_row      public.checkins;
begin
  if v_who is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  v_shift := public.current_shift();
  if v_shift is null then
    raise exception 'Fora da janela de check-in.' using errcode = 'P0001';
  end if;

  select e.allowed, e.reason into v_ok, v_reason
  from public.checkin_eligibility(v_who) e;

  if not v_ok then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  if client_ip is not null and not public.ip_is_allowed(client_ip, v_who) then
    raise exception 'IP % não autorizado para check-in.', host(client_ip)
      using errcode = 'P0001';
  end if;

  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (v_who, v_shift, current_date, client_ip)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at = null,
        auto_checkout  = false,
        ip_address     = coalesce(excluded.ip_address, public.checkins.ip_address)
  returning * into v_row;

  return v_row;
end;
$$;

-- Fila da roleta para um grupo: quem está presente, desbloqueado e há mais
-- tempo sem receber. Round-robin por último recebimento, não aleatório —
-- o corretor precisa conseguir prever a própria posição.
create or replace function public.distribution_queue(p_group_id uuid)
returns table (profile_id uuid, full_name text, queue_position int, last_assigned_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      c.profile_id,
      p.full_name,
      (
        select max(la.assigned_at)
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_assigned_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = current_date
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
  )
  select
    e.profile_id,
    e.full_name,
    row_number() over (order by e.last_assigned_at asc nulls first, e.profile_id)::int as queue_position,
    e.last_assigned_at
  from eligible e;
$$;

comment on function public.distribution_queue is
  'Fila ordenada da roleta de um grupo. Alimenta o indicador de posição na tela do corretor.';

-- Atribui um lead ao próximo da fila. Chamada pelo webhook (service_role) e
-- pela varredura de expirados. Retorna NULL quando não há ninguém elegível —
-- o lead permanece em queued e é reprocessado na próxima rodada.
create or replace function public.assign_lead(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead     public.leads;
  v_group    uuid;
  v_target   uuid;
  v_timeout  int;
  v_seq      int;
  v_paused   boolean;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead % não encontrado.', p_lead_id using errcode = 'P0002';
  end if;

  select s.leads_paused into v_paused from public.automation_settings s where s.id;
  if coalesce(v_paused, false) then
    return null;
  end if;

  if v_lead.status not in ('queued') then
    return v_lead.assigned_to;
  end if;

  -- Grupo do lead: o explícito, senão o vinculado ao formulário, senão a geral.
  v_group := coalesce(
    v_lead.distribution_group_id,
    (select f.group_id from public.distribution_group_forms f where f.form_id = v_lead.form_id),
    (select g.id from public.distribution_groups g where g.kind = 'general' and g.active limit 1)
  );

  if v_group is null then
    return null;
  end if;

  select q.profile_id into v_target
  from public.distribution_queue(v_group) q
  order by q.queue_position
  limit 1;

  if v_target is null then
    return null;
  end if;

  v_timeout := public.effective_attend_timeout(v_group);

  select coalesce(max(la.sequence), 0) + 1 into v_seq
  from public.lead_assignments la where la.lead_id = p_lead_id;

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  values (p_lead_id, v_target, v_group, v_seq, now() + make_interval(secs => v_timeout));

  update public.leads
     set status                = 'assigned',
         assigned_to           = v_target,
         assigned_at           = now(),
         attend_deadline       = now() + make_interval(secs => v_timeout),
         distribution_group_id = v_group,
         last_activity_at      = now()
   where id = p_lead_id;

  update public.checkins
     set leads_received = leads_received + 1
   where profile_id = v_target
     and work_date = current_date
     and checked_out_at is null;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, null, 'assigned', v_target::text,
          jsonb_build_object('group_id', v_group, 'sequence', v_seq, 'timeout_seconds', v_timeout));

  return v_target;
end;
$$;

-- Corretor assume o lead. Para o cronômetro: a partir daqui o lead é dele.
create or replace function public.claim_lead(p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.assigned_to is distinct from auth.uid() then
    raise exception 'Este lead não está atribuído a você.' using errcode = '42501';
  end if;

  if v_lead.status <> 'assigned' then
    raise exception 'Lead não está aguardando atendimento.' using errcode = 'P0001';
  end if;

  update public.lead_assignments
     set responded_at = now()
   where lead_id = p_lead_id and released_at is null;

  update public.leads
     set status           = 'attending',
         attend_deadline  = null,       -- travado com o corretor
         first_contact_at = coalesce(first_contact_at, now()),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind)
  values (p_lead_id, auth.uid(), 'claimed');

  return v_lead;
end;
$$;

-- Devolve à fila os leads cujo prazo estourou e tenta redistribuir na hora.
-- Idempotente: chamável por cron a cada 30s sem efeito colateral.
create or replace function public.release_expired_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_count   int := 0;
begin
  for v_lead_id in
    select l.id
    from public.leads l
    where l.status = 'assigned'
      and l.attend_deadline is not null
      and l.attend_deadline < now()
    for update skip locked
  loop
    update public.lead_assignments
       set released_at = now(), release_reason = 'timeout'
     where lead_id = v_lead_id and released_at is null;

    insert into public.lead_events (lead_id, actor_id, kind, from_value, detail)
    select v_lead_id, null, 'released', l.assigned_to::text,
           jsonb_build_object('reason', 'timeout')
    from public.leads l where l.id = v_lead_id;

    update public.leads
       set status          = 'queued',
           assigned_to     = null,
           assigned_at     = null,
           attend_deadline = null
     where id = v_lead_id;

    perform public.assign_lead(v_lead_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Realocação manual por gestor. Sai da roleta e vai direto para o alvo.
create or replace function public.reassign_lead(p_lead_id uuid, p_target uuid)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_timeout int;
begin
  if not (public.is_admin() or public.manages_profile(p_target)) then
    raise exception 'Sem permissão para realocar para este corretor.' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  update public.lead_assignments
     set released_at = now(), release_reason = 'reassigned'
   where lead_id = p_lead_id and released_at is null;

  v_timeout := public.effective_attend_timeout(v_lead.distribution_group_id);

  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline)
  select p_lead_id, p_target, v_lead.distribution_group_id,
         coalesce(max(la.sequence), 0) + 1,
         now() + make_interval(secs => v_timeout)
  from public.lead_assignments la where la.lead_id = p_lead_id;

  update public.leads
     set status           = 'assigned',
         assigned_to      = p_target,
         assigned_at      = now(),
         attend_deadline  = now() + make_interval(secs => v_timeout),
         last_activity_at = now()
   where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, auth.uid(), 'reassigned', p_target::text,
          jsonb_build_object('manual', true));

  return v_lead;
end;
$$;

-- Registra automaticamente mudanças de estágio e desfecho no log do lead.
create or replace function public.leads_log_changes()
returns trigger
language plpgsql
as $$
begin
  if new.funnel_stage is distinct from old.funnel_stage then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, auth.uid(), 'stage_changed', old.funnel_stage::text, new.funnel_stage::text);
  end if;

  if new.status is distinct from old.status then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, auth.uid(), 'status_changed', old.status::text, new.status::text);
  end if;

  return new;
end;
$$;

create trigger leads_log_changes
  after update on public.leads
  for each row execute function public.leads_log_changes();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.leads            enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_events      enable row level security;
alter table public.lead_comments    enable row level security;
alter table public.lead_attachments enable row level security;

-- "Corretores veem apenas seus negócios, gerentes veem o desempenho de sua
--  equipe, e diretores possuem visibilidade total."
-- Leads ainda na fila (sem dono) só aparecem para quem administra a operação:
-- deixar o corretor ver a fila inteira abriria espaço para escolher lead.
create policy leads_select on public.leads
  for select to authenticated
  using (
    assigned_to in (select public.auth_visible_profiles())
    or (assigned_to is null and public.has_any_role('admin','director','manager','marketing'))
  );

-- O corretor mexe no lead que é dele; gestor mexe no da equipe.
create policy leads_update on public.leads
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
  )
  with check (
    assigned_to = auth.uid()
    or public.is_admin()
    or public.manages_profile(assigned_to)
  );

-- Criação manual (indicação, importação). O webhook usa service_role e não
-- passa por RLS.
create policy leads_insert on public.leads
  for insert to authenticated
  with check (public.has_any_role('admin','director','manager','marketing','sdr'));

create policy leads_delete on public.leads
  for delete to authenticated
  using (public.is_admin());

-- Atribuições e log seguem a visibilidade do lead.
create policy lead_assignments_select on public.lead_assignments
  for select to authenticated
  using (
    profile_id in (select public.auth_visible_profiles())
    or public.has_any_role('admin','director')
  );

create policy lead_events_select on public.lead_events
  for select to authenticated
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_events.lead_id
        and (
          l.assigned_to in (select public.auth_visible_profiles())
          or public.has_any_role('admin','director')
        )
    )
  );

-- Log automático é imutável: não há policy de insert/update/delete para
-- authenticated. Só as funções SECURITY DEFINER escrevem aqui.

-- Comentários: quem enxerga o lead, lê e comenta. Editar/apagar só o autor.
create policy lead_comments_select on public.lead_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_comments.lead_id
        and (
          l.assigned_to in (select public.auth_visible_profiles())
          or public.has_any_role('admin','director','cca')
        )
    )
  );

create policy lead_comments_insert on public.lead_comments
  for insert to authenticated
  with check (author_id = auth.uid());

create policy lead_comments_update_own on public.lead_comments
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy lead_comments_delete on public.lead_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy lead_attachments_select on public.lead_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.leads l
      where l.id = lead_attachments.lead_id
        and (
          l.assigned_to in (select public.auth_visible_profiles())
          or public.has_any_role('admin','director','cca')
        )
    )
  );

create policy lead_attachments_insert on public.lead_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid());

create policy lead_attachments_delete on public.lead_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_any_role('admin','cca'));

-- =============================================================================
-- Grants das RPCs
-- Funções que alteram estado da roleta são chamadas pelo app autenticado;
-- assign_lead e release_expired_leads também pelo webhook/cron (service_role).
-- =============================================================================

revoke all on function public.assign_lead(uuid)          from public, anon;
revoke all on function public.release_expired_leads()     from public, anon;
revoke all on function public.reassign_lead(uuid, uuid)   from public, anon;
revoke all on function public.claim_lead(uuid)            from public, anon;
revoke all on function public.perform_checkin(inet)       from public, anon;

grant execute on function public.assign_lead(uuid)        to service_role;
grant execute on function public.release_expired_leads()  to service_role;
grant execute on function public.reassign_lead(uuid,uuid) to authenticated, service_role;
grant execute on function public.claim_lead(uuid)         to authenticated;
grant execute on function public.perform_checkin(inet)    to authenticated;
grant execute on function public.checkin_eligibility(uuid) to authenticated;
grant execute on function public.distribution_queue(uuid)  to authenticated;
