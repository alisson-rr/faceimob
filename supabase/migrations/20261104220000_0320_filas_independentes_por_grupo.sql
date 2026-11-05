-- 0320: cada grupo tem sua própria ordem de entrega/atendimento/timeout.
-- Mantém a trava global de um lead sem resposta e todas as regras de acesso.
-- Não altera atribuições, check-ins nem contatos existentes.

create or replace function public.distribution_queue_interna(p_group_id uuid)
returns table(profile_id uuid, full_name text, queue_position integer,
              last_assigned_at timestamptz, last_turn_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with eligible as (
    select m.profile_id, p.full_name,
      (select max(la.assigned_at) from public.lead_assignments la
        where la.profile_id = m.profile_id and la.group_id = m.group_id and la.counts_for_queue) as last_assigned_at,
      (select max(coalesce(la.responded_at, case when la.release_reason = 'timeout' then la.released_at end, la.assigned_at))
         from public.lead_assignments la
        where la.profile_id = m.profile_id and la.group_id = m.group_id and la.counts_for_queue) as last_turn_at,
      c.checked_in_at
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
      and not exists (
        select 1 from public.lead_assignments la where la.profile_id = m.profile_id
          and la.counts_for_queue and la.released_at is null and la.responded_at is null)
  )
  select e.profile_id, e.full_name,
         row_number() over (order by greatest(e.checked_in_at, e.last_turn_at) nulls first, e.profile_id)::int,
         e.last_assigned_at, e.last_turn_at
    from eligible e;
$$;
revoke all on function public.distribution_queue_interna(uuid) from public, anon, authenticated;
grant execute on function public.distribution_queue_interna(uuid) to service_role;

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
         from public.lead_assignments la where la.profile_id = c.profile_id and la.group_id = g.id and la.counts_for_queue) ultima_vez
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m on m.profile_id = c.profile_id and m.active
    join public.distribution_groups g on g.id = m.group_id and g.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = public.current_work_date() and c.checked_out_at is null and p.status = 'active'
  ), classificados as (
    select pr.*, case
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
