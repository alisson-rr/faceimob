-- =============================================================================
-- 0027 · Visibilidade de produto sem ampliar a carteira
--
-- Duas leituras pedidas pelo cliente não podem reutilizar
-- auth_visible_profiles(): ela também protege leads e negócios.
--   · nomes dos participantes do negócio que o usuário já pode abrir;
--   · ranking dos corretores da equipe, sem expor seus leads ou contatos.
-- =============================================================================

create or replace function public.deal_participant_names()
returns table (
  deal_id uuid,
  profile_id uuid,
  full_name text,
  role text,
  ordinal int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select dp.deal_id, dp.profile_id, p.full_name, dp.role, dp.ordinal
  from public.deal_participants dp
  join public.profiles p on p.id = dp.profile_id
  where auth.uid() is not null
    and (public.can_see_deal(dp.deal_id) or public.has_role('cca'))
  order by dp.deal_id, dp.role, dp.ordinal;
$$;

comment on function public.deal_participant_names() is
  'Nomes e papéis dos participantes de negócios que o usuário já pode abrir. '
  'Não libera a linha de profiles nem amplia auth_visible_profiles().';

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
  with visible_brokers as (
    select p.id
    from public.profiles p
    where exists (
      select 1 from public.user_roles ur
      where ur.profile_id = p.id and ur.role = 'broker'
    )
      and (
        public.can_read_all()
        or p.id in (select public.auth_visible_profiles())
        or (
          public.has_role('broker')
          and exists (
            select 1
            from public.team_members mine
            join public.team_members peer on peer.team_id = mine.team_id
            join public.teams t on t.id = mine.team_id and t.active
            where mine.profile_id = auth.uid()
              and mine.left_at is null
              and peer.profile_id = p.id
              and peer.left_at is null
          )
        )
      )
  ),
  code_totals as (
    select
      e.profile_id,
      e.event_code,
      sum(e.points)::int as code_points,
      count(*) filter (where e.event_code = 'venda')::int as code_sales
    from public.game_events e
    where e.season_id = p_season_id
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
  ) v on true;
$$;

comment on function public.visible_game_ranking(uuid) is
  'Ranking no escopo do usuário. Corretor vê os corretores das próprias equipes; '
  'a função expõe somente dados públicos do placar e não altera o RLS da carteira.';

revoke all on function public.deal_participant_names() from public, anon;
revoke all on function public.visible_game_ranking(uuid) from public, anon;
grant execute on function public.deal_participant_names() to authenticated, service_role;
grant execute on function public.visible_game_ranking(uuid) to authenticated, service_role;
