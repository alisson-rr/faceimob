-- =============================================================================
-- 0291 · Equipes por diretoria
--
-- Pedido de 19/10/2026: uma tela com as diretorias, as equipes de cada uma e os
-- integrantes, com Leads, Visitas, Ágil, Negócio, Vendas, VGV e Off do mês
-- (como a tela do sistema antigo), mais o funil da diretoria do Dashboard.
-- Visível a admin, sócio e diretor.
--
-- Tudo sai pronto do banco, por corretor: a tela não baixa a base de negócios.
--   · Leads   — leads do corretor criados no mês (horário de Brasília);
--   · Visitas — visitas do corretor agendadas para o mês;
--   · Ágil, Negócio, Vendas, Off — negócios do mês-base, divididos pelos
--     corretores do rateio (meio para cada um com dois corretores, como no
--     sistema antigo);
--   · VGV     — VGV líquido das vendas pela parte do corretor (`share_pct`).
-- Diretor vê as equipes que dirige (Diretor 1 ou 2); admin e sócio, todas.
-- Equipe com dois diretores aparece nas duas diretorias.
-- =============================================================================

insert into public.permissions (code, label, category, description)
values ('menu.diretorias', 'Diretorias', 'menu',
        'Equipes por diretoria com os números do mês de cada corretor e o funil da diretoria.')
on conflict (code) do update
  set label = excluded.label, category = excluded.category, description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
select r.role::public.app_role, 'menu.diretorias', true
  from (values ('partner'), ('director')) as r(role)
on conflict (role, permission) do nothing;

create or replace function public.equipes_por_diretoria(p_mes date default null)
returns table (
  diretor_id   uuid,
  diretor_nome text,
  equipe_id    uuid,
  equipe_nome  text,
  gerente_nome text,
  corretor_id  uuid,
  corretor_nome text,
  leads        numeric,
  visitas      numeric,
  agil         numeric,
  negocio      numeric,
  vendas       numeric,
  vgv          numeric,
  off          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_mes    date := date_trunc('month', coalesce(p_mes, public.current_season_month(), current_date))::date;
  v_inicio timestamptz := (v_mes::timestamp at time zone 'America/Sao_Paulo');
  v_fim    timestamptz := ((v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo');
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('director')) then
    raise exception 'Só administrador, sócio e diretor veem as equipes por diretoria.' using errcode = '42501';
  end if;

  return query
  with equipes as (
    select t.id, t.name, t.manager_id, ed.director_id
      from public.teams t
      join public.equipe_diretores ed on ed.team_id = t.id
     where t.active
       and (public.is_admin() or ed.director_id = auth.uid())
    union all
    -- Equipe ativa sem diretor: só o admin vê, em "Sem diretoria".
    select t.id, t.name, t.manager_id, null::uuid
      from public.teams t
     where t.active and public.is_admin()
       and t.director_id is null and t.co_director_id is null
  ),
  membros as (
    select e.director_id, e.id as team_id, e.name as team_name, e.manager_id, tm.profile_id
      from equipes e
      join public.team_members tm on tm.team_id = e.id and tm.left_at is null
  ),
  corretores_do_negocio as (
    select dp.deal_id, dp.profile_id, dp.share_pct,
           count(*) over (partition by dp.deal_id) as n
      from public.deal_participants dp
     where dp.role = 'broker'
  ),
  negocios as (
    select c.profile_id,
           1.0 / c.n as peso,
           coalesce(nullif(c.share_pct, 0) / 100.0, 1.0 / c.n) as parte_vgv,
           public.deal_status_bare(d.status_detail) as st,
           (d.outcome = 'won' or (d.outcome = 'open' and g.code = 'VENDA')) as venda,
           coalesce(d.vgv_net, 0) as vgv_net
      from public.deals d
      join corretores_do_negocio c on c.deal_id = d.id
      left join public.deal_status_groups g on g.id = d.status_group_id
     where d.month_base = v_mes
       and c.profile_id in (select m.profile_id from membros m)
  ),
  por_corretor as (
    select n.profile_id,
           sum(n.peso) filter (where n.st in ('ESTEIRA AGIL', 'ESTEIRA ÁGIL')) as agil,
           sum(n.peso) filter (where n.st in ('VIROU NEGÓCIO', 'VIROU NEGOCIO', 'NEGÓCIO', 'NEGOCIO',
                                              'NEGÓCIO FECHADO', 'NEGOCIO FECHADO')) as negocio,
           sum(n.peso) filter (where n.venda) as vendas,
           sum(n.vgv_net * n.parte_vgv) filter (where n.venda) as vgv,
           sum(n.peso) filter (where n.st = 'OFF' or n.st like 'OFF %') as off
      from negocios n
     group by n.profile_id
  ),
  leads_do_mes as (
    select l.assigned_to as profile_id, count(*) as total
      from public.leads l
     where l.assigned_to in (select m.profile_id from membros m)
       and l.created_at >= v_inicio and l.created_at < v_fim
     group by l.assigned_to
  ),
  visitas_do_mes as (
    select v.broker_id as profile_id, count(*) as total
      from public.visits v
     where v.broker_id in (select m.profile_id from membros m)
       and v.scheduled_at >= v_inicio and v.scheduled_at < v_fim
     group by v.broker_id
  )
  select m.director_id,
         coalesce(nullif(btrim(pd.nickname), ''), pd.full_name, 'Sem diretoria'),
         m.team_id,
         m.team_name,
         coalesce(nullif(btrim(pm.nickname), ''), pm.full_name),
         m.profile_id,
         coalesce(nullif(btrim(pc.nickname), ''), pc.full_name),
         coalesce(lm.total, 0)::numeric,
         coalesce(vm.total, 0)::numeric,
         coalesce(pc2.agil, 0)::numeric,
         coalesce(pc2.negocio, 0)::numeric,
         coalesce(pc2.vendas, 0)::numeric,
         round(coalesce(pc2.vgv, 0), 2)::numeric,
         coalesce(pc2.off, 0)::numeric
    from membros m
    join public.profiles pc on pc.id = m.profile_id and pc.status = 'active'
    left join public.profiles pd on pd.id = m.director_id
    left join public.profiles pm on pm.id = m.manager_id
    left join por_corretor pc2 on pc2.profile_id = m.profile_id
    left join leads_do_mes lm on lm.profile_id = m.profile_id
    left join visitas_do_mes vm on vm.profile_id = m.profile_id;
end;
$$;

revoke all on function public.equipes_por_diretoria(date) from public, anon;
grant execute on function public.equipes_por_diretoria(date) to authenticated;
comment on function public.equipes_por_diretoria(date) is
  'Diretorias → equipes → corretores com Leads, Visitas, Ágil, Negócio, Vendas, VGV e Off do mês (0291). Admin/sócio todas; diretor as que dirige.';
