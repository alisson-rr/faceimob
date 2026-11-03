-- =============================================================================
-- 0315 — fila mais clara e lead da campanha no grupo da campanha.
-- =============================================================================
-- Pedido de 03/11/2026:
--   1. "Estava em 3º e fui para 8º": quem saía da fila por leads atrasados
--      voltava com a hora antiga e entrava na frente de todos. Agora o bloqueio
--      é registrado (`fila_bloqueios`) e a volta conta como chegada: fim da fila
--      (decisão do cliente).
--   2. O corretor vê o andamento da própria fila no dia
--      (`minha_fila_andamento`): check-in, lead recebido, atendido, prazo
--      vencido, bloqueio e volta — o que o mandou para o fim.
--   3. Campanhas do grupo Open entregues a corretores de outros grupos: a
--      origem passa a ter grupo (`lead_sources.distribution_group_id`), o lead
--      herda na chegada e o handoff da IA respeita o grupo do lead.
-- =============================================================================

-- 1. Bloqueios por leads atrasados ------------------------------------------------
create table if not exists public.fila_bloqueios (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  inicio     timestamptz not null default now(),
  fim        timestamptz
);
create unique index if not exists fila_bloqueios_aberto_idx
  on public.fila_bloqueios (profile_id) where fim is null;
create index if not exists fila_bloqueios_profile_idx
  on public.fila_bloqueios (profile_id, inicio desc);

alter table public.fila_bloqueios enable row level security;
drop policy if exists fila_bloqueios_select on public.fila_bloqueios;
create policy fila_bloqueios_select on public.fila_bloqueios
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.ve_fila_completa()));
-- Escrita só pela função abaixo (security definer): nenhuma policy de escrita.

comment on table public.fila_bloqueios is
  'Períodos em que o corretor ficou fora da roleta por leads atrasados (0315). O fim do bloqueio conta como chegada na fila.';

-- Abre o bloqueio de quem passou do limite e fecha o de quem regularizou.
-- Roda a cada minuto, no começo do dreno da fila (cron faceimob-assign-queued).
create or replace function public.fila_registrar_bloqueios()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limite int;
begin
  select s.overdue_block_threshold into v_limite from public.automation_settings s where s.id;
  if v_limite is null then return; end if;

  insert into public.fila_bloqueios (profile_id)
  select distinct m.profile_id
    from public.distribution_group_members m
    join public.distribution_groups g on g.id = m.group_id and g.active
   where m.active
     and public.overdue_lead_count(m.profile_id) >= v_limite
     and not exists (select 1 from public.fila_bloqueios b where b.profile_id = m.profile_id and b.fim is null)
  on conflict do nothing;

  update public.fila_bloqueios b
     set fim = now()
   where b.fim is null
     and public.overdue_lead_count(b.profile_id) < v_limite;
end;
$$;
revoke all on function public.fila_registrar_bloqueios() from public, anon, authenticated;
grant execute on function public.fila_registrar_bloqueios() to service_role;

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with eligible as (
    select m.profile_id, p.full_name,
      (select max(la.assigned_at) from public.lead_assignments la
        where la.profile_id = m.profile_id and la.counts_for_queue) as last_assigned_at,
      (select max(coalesce(la.responded_at, case when la.release_reason = 'timeout' then la.released_at end, la.assigned_at))
         from public.lead_assignments la
        where la.profile_id = m.profile_id and la.counts_for_queue) as last_turn_at,
      c.checked_in_at,
      -- 0315: a volta de um bloqueio por leads atrasados conta como chegada.
      -- Bloqueio ainda aberto (o cron fecha em até 1 min) vale como agora.
      (select max(coalesce(b.fim, now())) from public.fila_bloqueios b
        where b.profile_id = m.profile_id) as voltou_do_bloqueio_em
    from public.distribution_group_members m
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.profiles p on p.id = m.profile_id
    left join public.checkins c
      on c.profile_id = m.profile_id
     and c.work_date = public.current_work_date() and c.checked_out_at is null
    left join public.work_shifts s on s.id = c.shift_id
    where public.roleta_horario_aberto()
      and m.group_id = p_group_id and m.active and p.status = 'active'
      and (g.deliver_without_checkin
           or (c.profile_id is not null
               and s.active
               and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
               and (now() at time zone 'America/Sao_Paulo')::time < s.checkout_time))
      and public.overdue_lead_count(m.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
      and not exists (
        select 1 from public.lead_assignments la where la.profile_id = m.profile_id
          and la.counts_for_queue and la.released_at is null and la.responded_at is null)
  )
  select e.profile_id, e.full_name,
         row_number() over (order by greatest(e.checked_in_at, e.last_turn_at, e.voltou_do_bloqueio_em) nulls first, e.profile_id)::int,
         e.last_assigned_at, e.last_turn_at
    from eligible e;
$$;

revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;

create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
begin
  -- 0315: o bloqueio entra na ordem da fila, então é registrado antes de girar.
  perform public.fila_registrar_bloqueios();

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
    order by l.created_at, l.id
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.assign_queued_leads() from public, anon, authenticated;
grant execute on function public.assign_queued_leads() to service_role;

-- 2. Andamento da fila do corretor ----------------------------------------------
create or replace function public.minha_fila_andamento()
returns table (ocorreu_em timestamptz, tipo text, detalhe text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with dia as (
    select (public.current_work_date()::timestamp at time zone 'America/Sao_Paulo') as inicio
  )
  select c.checked_in_at, 'checkin'::text, null::text
    from public.checkins c
   where c.profile_id = auth.uid() and c.work_date = public.current_work_date()
  union all
  select la.assigned_at, 'recebeu', l.full_name
    from public.lead_assignments la join public.leads l on l.id = la.lead_id, dia
   where la.profile_id = auth.uid() and la.counts_for_queue and la.assigned_at >= dia.inicio
  union all
  select la.responded_at, 'atendeu', l.full_name
    from public.lead_assignments la join public.leads l on l.id = la.lead_id, dia
   where la.profile_id = auth.uid() and la.counts_for_queue and la.responded_at >= dia.inicio
  union all
  select la.released_at, 'prazo_vencido', l.full_name
    from public.lead_assignments la join public.leads l on l.id = la.lead_id, dia
   where la.profile_id = auth.uid() and la.counts_for_queue
     and la.release_reason = 'timeout' and la.released_at >= dia.inicio
  union all
  select b.inicio, 'bloqueado', null
    from public.fila_bloqueios b, dia
   where b.profile_id = auth.uid() and b.inicio >= dia.inicio
  union all
  select b.fim, 'desbloqueado', null
    from public.fila_bloqueios b, dia
   where b.profile_id = auth.uid() and b.fim >= dia.inicio
  order by 1 desc
  limit 50;
$$;
revoke all on function public.minha_fila_andamento() from public, anon;
grant execute on function public.minha_fila_andamento() to authenticated;
comment on function public.minha_fila_andamento() is
  'O que mexeu na fila do próprio corretor hoje: check-in, lead recebido/atendido, prazo vencido, bloqueio por atrasados e volta (0315).';

-- 3. Grupo da campanha ----------------------------------------------------------
alter table public.lead_sources
  add column if not exists distribution_group_id uuid references public.distribution_groups(id) on delete set null;
comment on column public.lead_sources.distribution_group_id is
  'Grupo da roleta que recebe os leads desta origem/campanha (0315). Vazio: segue o agente da IA ou o grupo geral.';

create or replace function public.leads_grupo_da_origem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.distribution_group_id is null and new.source_id is not null then
    select s.distribution_group_id into new.distribution_group_id
      from public.lead_sources s where s.id = new.source_id;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_grupo_da_origem on public.leads;
create trigger leads_grupo_da_origem
  before insert on public.leads
  for each row execute function public.leads_grupo_da_origem();

create or replace function public.sdr_handoff(
  p_conversation_id uuid,
  p_reason text default 'qualified'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.sdr_conversations;
  v_group  uuid;
  v_broker uuid;
  v_compra boolean;
begin
  if p_reason not in ('qualified', 'exhausted', 'sem_resposta') then
    raise exception 'Motivo de handoff desconhecido: %', p_reason using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.has_any_role('admin','sdr','marketing') then
    raise exception 'Sem permissão para devolver a conversa do SDR à roleta.'
      using errcode = '42501';
  end if;

  select * into v_conv from public.sdr_conversations
  where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conv.status = 'handed_off' then
    return v_conv.handed_off_to;
  end if;

  -- Candidato (0264): não entra na roleta de leads.
  select coalesce(a.lead_de_compra, true) into v_compra
    from public.sdr_agents a where a.id = v_conv.agent_id;
  if v_compra is false then
    perform public.sdr_virar_candidato(p_conversation_id);
    return null;
  end if;

  -- 0315: o grupo do lead (o da campanha, gravado na chegada) vence o do
  -- agente. Antes o agente mandava o lead da campanha Open para o grupo dele
  -- ("Leads Qualificados"), e corretores de fora do Open recebiam.
  select l.distribution_group_id into v_group from public.leads l where l.id = v_conv.lead_id;

  if v_group is null then
    select coalesce(a.handoff_group_id,
                    (select g.id from public.distribution_groups g
                     where g.kind = 'general' and g.active limit 1))
      into v_group
    from public.sdr_agents a where a.id = v_conv.agent_id;
  end if;

  if v_group is null then
    select g.id into v_group from public.distribution_groups g
    where g.kind = 'general' and g.active limit 1;
  end if;

  update public.leads
     set distribution_group_id = coalesce(v_group, distribution_group_id),
         status                = 'queued',
         assigned_to           = null,
         assigned_at           = null,
         attend_deadline       = null,
         sdr_qualified_at      = case when p_reason = 'qualified' then now() else sdr_qualified_at end,
         funnel_stage          = case when p_reason = 'qualified' then 'qualified'::lead_funnel_stage else funnel_stage end,
         last_activity_at      = now()
   where id = v_conv.lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, detail)
  values (v_conv.lead_id, null, 'sdr_qualified',
          jsonb_build_object('conversation_id', p_conversation_id,
                             'reason', p_reason,
                             'score', v_conv.score,
                             'group_id', v_group));

  v_broker := public.assign_lead(v_conv.lead_id);

  update public.sdr_conversations
     set status        = 'handed_off',
         qualified_at  = case when p_reason = 'qualified' then coalesce(qualified_at, now()) else qualified_at end,
         handed_off_at = now(),
         handed_off_to = v_broker
   where id = p_conversation_id;

  return v_broker;
end;
$$;

revoke all on function public.sdr_handoff(uuid, text) from public, anon;
grant execute on function public.sdr_handoff(uuid, text) to authenticated, service_role;

revoke all on function public.sdr_handoff(uuid, text) from public, anon;
grant execute on function public.sdr_handoff(uuid, text) to authenticated, service_role;

-- Fila em formação: mesma chegada da roleta (0315).
create or replace function public.fila_em_formacao()
returns table (group_id uuid, group_name text, profile_id uuid, full_name text,
  posicao integer, situacao text, checked_in_at timestamptz, abre_as text,
  last_turn_at timestamptz, atrasados integer)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  return query
  with presentes as (
    select g.id g_id, g.name g_name, c.profile_id p_id, p.full_name p_nome,
      c.checked_in_at entrou, s.distribution_start abre,
      (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start aberta,
      public.overdue_lead_count(c.profile_id) atrasos,
      exists (select 1 from public.lead_assignments la where la.profile_id = c.profile_id
               and la.counts_for_queue and la.released_at is null and la.responded_at is null) com_lead,
      (select max(coalesce(la.responded_at, case when la.release_reason = 'timeout' then la.released_at end, la.assigned_at))
         from public.lead_assignments la where la.profile_id = c.profile_id and la.counts_for_queue) ultima_vez,
      -- 0315: a volta do bloqueio por atrasados conta como chegada (fim da fila).
      (select max(coalesce(b.fim, now())) from public.fila_bloqueios b where b.profile_id = c.profile_id) volta
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date() and c.checked_out_at is null and p.status = 'active'
  ), classificados as (
    select pr.*, case
      when pr.atrasos >= (select a.overdue_block_threshold from public.automation_settings a where a.id) then 'bloqueado'
      when pr.com_lead then 'com_lead' when pr.aberta then 'na_fila' else 'aguardando' end sit
    from presentes pr
  ), ordenados as (
    select k.g_id, k.g_name, k.p_id, k.p_nome,
      case when k.sit in ('bloqueado', 'com_lead') then null
           else row_number() over (partition by k.g_id, (k.sit in ('bloqueado', 'com_lead'))
                  order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez, k.volta), k.p_id)::int end as pos,
      k.sit, k.entrou, to_char(k.abre, 'HH24:MI') as abre_txt, k.ultima_vez, k.atrasos::int as atrasos_int,
      greatest(k.entrou, k.ultima_vez, k.volta) as chegada
    from classificados k
  )
  -- 0310: a posição sai da fila inteira; o corretor recebe só as próprias linhas.
  select o.g_id, o.g_name, o.p_id, o.p_nome, o.pos, o.sit, o.entrou, o.abre_txt, o.ultima_vez, o.atrasos_int
  from ordenados o
  where public.ve_fila_completa() or o.p_id = auth.uid()
  order by o.g_name, (o.sit = 'bloqueado'), (o.sit = 'com_lead'), (o.sit = 'aguardando'), o.chegada, o.p_id;
end;
$$;

