-- =============================================================================
-- 0202 — o gerente vê os números da diretoria dele no Dashboard
--
-- Pedido de 03/10/2026 ("dava para mostrar o número de vendas do Diretor da
-- minha gerência"): a RLS de `deals` entrega ao gerente só a equipe dele, então
-- o painel não tinha como somar a diretoria. Esta função devolve SÓ números
-- agregados — vendas e VGV do mês por equipe da diretoria, e o total — nunca
-- negócio, cliente ou valor de alguém.
--
-- Venda é a regra única do app (`contaComoVenda`): fechado, ou aberto com
-- Status 1 VENDA. O mês é o mês-base. O negócio conta na equipe de cada
-- corretor dele; no total da diretoria conta uma vez só.
-- Quem pergunta: gerente ou diretor vê a(s) diretoria(s) das equipes que
-- lidera; admin vê todas.
-- =============================================================================

create or replace function public.resumo_da_diretoria(p_mes date)
returns table (
  director_id   uuid,
  director_name text,
  team_id       uuid,
  team_name     text,
  manager_name  text,
  vendas        integer,
  vgv           numeric,
  total_vendas  integer,
  total_vgv     numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with diretorias as (
    select distinct t.director_id
      from public.teams t
     where t.active and t.director_id is not null
       and auth.uid() is not null
       and (public.is_admin() or auth.uid() in (t.manager_id, t.director_id))
  ),
  equipes as (
    select t.id, t.name, t.director_id, t.manager_id
      from public.teams t
      join diretorias d on d.director_id = t.director_id
     where t.active
  ),
  vendas as (
    select distinct e.director_id, e.id as team_id, dl.id as deal_id, dl.vgv_net
      from public.deals dl
      left join public.deal_status_groups g on g.id = dl.status_group_id
      join public.deal_participants dp on dp.deal_id = dl.id and dp.role = 'broker'
      join public.team_members tm on tm.profile_id = dp.profile_id and tm.left_at is null
      join equipes e on e.id = tm.team_id
     where dl.month_base = date_trunc('month', p_mes)::date
       and (dl.outcome = 'won' or (dl.outcome = 'open' and g.code = 'VENDA'))
  ),
  totais as (
    select x.director_id, count(*)::int as n, coalesce(sum(x.vgv_net), 0) as v
      from (select distinct v.director_id, v.deal_id, v.vgv_net from vendas v) x
     group by x.director_id
  )
  select e.director_id,
         dp.full_name,
         e.id,
         e.name,
         mp.full_name,
         (select count(*)::int from vendas v where v.team_id = e.id),
         (select coalesce(sum(v.vgv_net), 0) from vendas v where v.team_id = e.id),
         coalesce(tt.n, 0),
         coalesce(tt.v, 0)
    from equipes e
    join public.profiles dp on dp.id = e.director_id
    left join public.profiles mp on mp.id = e.manager_id
    left join totais tt on tt.director_id = e.director_id
   order by dp.full_name, 7 desc, e.name;
$$;

revoke all on function public.resumo_da_diretoria(date) from public, anon;
grant execute on function public.resumo_da_diretoria(date) to authenticated;
comment on function public.resumo_da_diretoria(date) is
  'Vendas e VGV do mês-base por equipe da diretoria de quem pergunta (gerente/diretor: as diretorias das equipes que lidera; admin: todas) e o total da diretoria. Só números agregados (0202).';
