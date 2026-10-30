-- =============================================================================
-- 0310 · Fila privada para o corretor
--
-- Pedido de 30/10/2026: o corretor vê só a própria colocação em cada grupo de
-- distribuição de que participa — não vê quem mais está no grupo nem os grupos
-- de que não faz parte. A liderança e as áreas de apoio (admin, sócio, diretor,
-- gerente, CCA, SDR, marketing) seguem vendo tudo.
--
-- Antes, `distribution_groups` e `distribution_group_members` eram legíveis por
-- qualquer usuário logado (0004, `using (true)`), e `distribution_queue` /
-- `fila_em_formacao` devolviam a fila inteira com nomes: a tela escondia, mas a
-- API entregava. Agora o recorte é no banco. As funções da roleta são SECURITY
-- DEFINER e não dependem destas policies.
-- =============================================================================

create or replace function public.ve_fila_completa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or public.has_any_role('director', 'manager', 'cca', 'sdr', 'marketing');
$$;
revoke all on function public.ve_fila_completa() from public, anon;
grant execute on function public.ve_fila_completa() to authenticated, service_role;
comment on function public.ve_fila_completa() is
  'Quem vê a fila e os grupos de distribuição inteiros (0310). O corretor puro vê só a própria posição.';

drop policy if exists distribution_groups_select on public.distribution_groups;
create policy distribution_groups_select on public.distribution_groups
  for select to authenticated
  using ((select public.ve_fila_completa()) or id in (select public.auth_distribution_group_ids()));

drop policy if exists distribution_group_members_select on public.distribution_group_members;
create policy distribution_group_members_select on public.distribution_group_members
  for select to authenticated
  using ((select public.ve_fila_completa()) or profile_id = (select auth.uid()));

create or replace function public.distribution_queue(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.profile_id, q.full_name, q.queue_position, q.last_assigned_at, q.last_turn_at
    from public.distribution_queue_interna(p_group_id) q
   where (select auth.uid()) is null
      or (p_group_id in (select public.auth_distribution_group_ids())
          -- 0310: o corretor recebe só a própria linha (a colocação dele).
          and ((select public.ve_fila_completa()) or q.profile_id = (select auth.uid())));
$$;

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
         from public.lead_assignments la where la.profile_id = c.profile_id and la.counts_for_queue) ultima_vez
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
                  order by (k.sit = 'aguardando'), greatest(k.entrou, k.ultima_vez), k.p_id)::int end as pos,
      k.sit, k.entrou, to_char(k.abre, 'HH24:MI') as abre_txt, k.ultima_vez, k.atrasos::int as atrasos_int,
      greatest(k.entrou, k.ultima_vez) as chegada
    from classificados k
  )
  -- 0310: a posição sai da fila inteira; o corretor recebe só as próprias linhas.
  select o.g_id, o.g_name, o.p_id, o.p_nome, o.pos, o.sit, o.entrou, o.abre_txt, o.ultima_vez, o.atrasos_int
  from ordenados o
  where public.ve_fila_completa() or o.p_id = auth.uid()
  order by o.g_name, (o.sit = 'bloqueado'), (o.sit = 'com_lead'), (o.sit = 'aguardando'), o.chegada, o.p_id;
end;
$$;
