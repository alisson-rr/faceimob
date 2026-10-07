-- =============================================================================
-- Correção da fila CCA: apenas esteira ágil do mês vigente + visibilidade por papel
-- =============================================================================
drop function if exists public.my_cca_queue_position();
create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text,
queue_position integer, submitted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
with current_month as (
select public.month_start(coalesce(public.current_season_month(), current_date)) as month
),
my_team_brokers as (
-- Corretores da minha equipe (para gerente/diretor) ou só eu (para corretor)
select case
when public.has_any_role('admin', 'partner') then null -- admin vê todos
when public.has_any_role('manager', 'director') then
(select array_agg(tm.profile_id) from public.team_members tm
join public.teams t on t.id = tm.team_id and t.active
where (t.manager_id = auth.uid() or t.director_id = auth.uid())
and tm.left_at is null)
else array[auth.uid()] -- corretor vê só seus
end as broker_ids
),
ranked as (
select c.deal_id, c.submitted_at,
row_number() over (order by c.submitted_at asc nulls last, c.id) as position
from public.cca_cases c
join public.deals d on d.id = c.deal_id
cross join current_month cm
where c.status not in ('approved', 'rejected', 'cancelled')
and d.month_base = cm.month -- APENAS esteira ágil do mês vigente
and (
-- Filtro de visibilidade por papel
(public.has_any_role('admin', 'partner')) -- admin vê todos
or exists (
select 1 from public.deal_participants dp
where dp.deal_id = c.deal_id
and dp.role = 'broker'
and (
(public.has_any_role('manager', 'director') and dp.profile_id = any((select broker_ids from my_team_brokers)))
or (not public.has_any_role('admin', 'partner', 'manager', 'director') and dp.profile_id = auth.uid())
)
)
)
)
select r.deal_id, d.code,
coalesce(dc.full_name, d.code, 'Cliente não informado'),
r.position::integer, r.submitted_at
from ranked r
join public.deals d on d.id = r.deal_id
left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
order by r.position;
$$;
revoke all on function public.my_cca_queue_position() from public, anon;
grant execute on function public.my_cca_queue_position() to authenticated;
comment on function public.my_cca_queue_position() is
'Posição na ESTEIRA ÁGIL do mês vigente, com visibilidade por papel: corretor vê só seus, gerente/diretor vê equipe, admin vê todos.';