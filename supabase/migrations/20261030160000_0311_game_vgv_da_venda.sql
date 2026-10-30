-- =============================================================================
-- 0311 · VGV do game acompanha a venda que pontuou
--
-- 30/10/2026: "o VGV de alguns não está aparecendo". O placar somava o VGV só
-- de negócio com desfecho ganho (`outcome = 'won'`) fechado na temporada, mas a
-- venda do game nasce no contrato (0163) — o negócio em contrato pontuava e
-- aparecia com VGV zero. Agora o VGV é o do negócio de cada venda que o corretor
-- pontuou na temporada (no intervalo, quando há), pela parte dele no rateio.
-- O resto da função é a da 0308.
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
  sales numeric,
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
      sum(e.points * public.game_peso_do_evento(e.event_code, e.ref_type, e.ref_id)) as code_points,
      coalesce(sum(public.game_peso_do_evento(e.event_code, e.ref_type, e.ref_id))
               filter (where e.event_code = 'venda'), 0) as code_sales
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
      round(sum(c.code_points))::int as points,
      round(sum(c.code_sales), 1) as sales,
      jsonb_object_agg(c.event_code, round(c.code_points)::int) as breakdown
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
    -- 0311: o VGV de cada venda pontuada (contrato ou fechada), pela parte do
    -- corretor no rateio. Uma linha por negócio: a venda paga uma vez só.
    select sum(d.vgv_net * dp.share_pct / 100) as vgv
    from public.deals d
    join public.deal_participants dp on dp.deal_id = d.id and dp.profile_id = p.id and dp.role = 'broker'
    where d.id in (
      select e.ref_id
      from public.game_events e
      where e.season_id = p_season_id
        and e.profile_id = p.id
        and e.event_code = 'venda'
        and e.ref_type = 'deal'
        and (p_from is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date >= p_from)
        and (p_to   is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date <= p_to)
    )
  ) v on true;
$$;
