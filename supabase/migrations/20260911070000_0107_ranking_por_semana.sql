-- =============================================================================
-- 0107 · Ranking recortado por semana
--
-- Pedido do cliente (10/09/2026): "colocar filtro do game semanal, pq tem
-- premiação por semana" — confirmado depois como "usa as mesmas pontuações do
-- game, porém com um filtro de semana".
--
-- Semana é LEITURA, não ciclo (CONTEXT.md): o jogo continua fechando por
-- TEMPORADA. Este arquivo não cria período semanal, não congela nada e não
-- toca em `game_seasons` nem em `game_season_results` — só recorta a MESMA
-- soma de `game_events` por um intervalo de dias.
--
-- O que NÃO muda, e é o ponto sensível: a visibilidade. O CTE `visible_brokers`
-- continua saindo de `can_see_game_profile` (0060) — admin/diretor/sócio veem a
-- casa, gerente vê quem lidera, corretor vê a equipe ativa. Recorte de tempo é
-- ortogonal a recorte de gente; um filtro de data não pode revelar ninguém.
--
-- Assinatura: a de um argumento continua existindo e virou atalho para a de
-- três. Os parâmetros novos NÃO têm `default` de propósito — com default, a
-- chamada posicional `visible_game_ranking(uuid)` de
-- `supabase/tests/11_product_visibility.sql` ficaria ambígua entre as duas
-- funções e o Postgres recusaria em tempo de plano.
--
-- Fuso: o dia é o de America/Sao_Paulo, o mesmo de `current_work_date()`
-- (0057) e do filtro de leads da 0063. O banco roda em UTC — uma venda das
-- 21:30 de domingo em Brasília é segunda 00:30 em UTC, e sem a conversão ela
-- pagaria o prêmio da semana errada. Quem decide onde a semana começa é a
-- interface (segunda a domingo); o banco só recebe o intervalo já resolvido,
-- para não existirem duas definições de "semana".
-- =============================================================================

create or replace function public.visible_game_ranking(
  p_season_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  season_id uuid,
  profile_id uuid,
  full_name text,
  avatar_url text,
  active boolean,
  points int,
  sales int,
  vgv numeric,
  breakdown jsonb,
  team_id uuid,
  team_name text,
  manager_id uuid,
  manager_name text,
  director_id uuid,
  director_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible_brokers as (
    select p.id
    from public.profiles p
    where exists (
      select 1 from public.user_roles ur
      where ur.profile_id = p.id and ur.role = 'broker'
    )
      and public.can_see_game_profile(p.id)
  ),
  code_totals as (
    select
      e.profile_id,
      e.event_code,
      sum(e.points)::int as code_points,
      count(*) filter (where e.event_code = 'venda')::int as code_sales
    from public.game_events e
    where e.season_id = p_season_id
      -- Intervalo nulo = temporada inteira: é assim que a assinatura antiga
      -- continua devolvendo exatamente o que devolvia.
      and (p_from is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date <= p_to)
    group by e.profile_id, e.event_code
  ),
  scores as (
    select
      c.profile_id,
      sum(c.code_points)::int as points,
      sum(c.code_sales)::int as sales,
      jsonb_object_agg(c.event_code, c.code_points) as breakdown
    from code_totals c
    group by c.profile_id
  )
  select
    p_season_id,
    p.id,
    p.full_name,
    p.avatar_url,
    p.status = 'active',
    coalesce(s.points, 0),
    coalesce(s.sales, 0),
    coalesce(v.vgv, 0),
    coalesce(s.breakdown, '{}'::jsonb),
    team.id,
    team.name,
    team.manager_id,
    manager.full_name,
    team.director_id,
    director.full_name
  from visible_brokers vb
  join public.profiles p on p.id = vb.id
  left join scores s on s.profile_id = p.id
  left join lateral (
    select t.id, t.name, t.manager_id, t.director_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id and t.active
    where tm.profile_id = p.id and tm.left_at is null
    order by tm.joined_at, t.name
    limit 1
  ) team on true
  left join public.profiles manager on manager.id = team.manager_id
  left join public.profiles director on director.id = team.director_id
  left join lateral (
    select sum(d.vgv_net * dp.share_pct / 100) as vgv
    from public.deal_participants dp
    join public.deals d on d.id = dp.deal_id
    join public.game_seasons gs on gs.id = p_season_id
    where dp.profile_id = p.id
      and dp.role = 'broker'
      and d.outcome = 'won'
      and d.closed_at::date >= gs.period_start
      and d.closed_at::date <= coalesce(gs.period_end, current_date)
      -- O VGV acompanha o mesmo recorte, senão a semana mostraria pontos de
      -- sete dias ao lado do VGV da temporada inteira. Os limites da TEMPORADA
      -- acima ficam como estavam de propósito: convertê-los para São Paulo
      -- mudaria o VGV de temporada já fechada, e isso não é esta tarefa.
      and (p_from is null or (d.closed_at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to   is null or (d.closed_at at time zone 'America/Sao_Paulo')::date <= p_to)
  ) v on true;
$$;

comment on function public.visible_game_ranking(uuid, date, date) is
  'Ranking da temporada recortado por um intervalo de dias (America/Sao_Paulo). '
  'Intervalo nulo = temporada inteira. A semana é leitura: não congela nem '
  'fecha nada. A visibilidade por papel continua sendo can_see_game_profile.';

revoke all on function public.visible_game_ranking(uuid, date, date) from public, anon;
grant execute on function public.visible_game_ranking(uuid, date, date) to authenticated, service_role;

-- A assinatura antiga vira atalho, para não haver dois corpos que possam
-- divergir. `PipelineTopRanking` e os asserts da 11 continuam chamando esta.
create or replace function public.visible_game_ranking(p_season_id uuid)
returns table (
  season_id uuid,
  profile_id uuid,
  full_name text,
  avatar_url text,
  active boolean,
  points int,
  sales int,
  vgv numeric,
  breakdown jsonb,
  team_id uuid,
  team_name text,
  manager_id uuid,
  manager_name text,
  director_id uuid,
  director_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.visible_game_ranking(p_season_id, null::date, null::date);
$$;
