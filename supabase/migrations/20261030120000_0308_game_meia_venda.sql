-- =============================================================================
-- 0308 · Game: meia venda e meio ponto de venda no negócio dividido
--
-- Pedido de 30/10/2026: "a contagem de meias vendas não está acontecendo,
-- revise e ajuste tanto em ranking quanto em game" — e, nos pontos, "metade
-- dos pontos também". Até aqui cada corretor de um negócio com dois corretores
-- ganhava a venda inteira e os pontos inteiros dela.
--
-- O peso entra na LEITURA do placar (`visible_game_ranking`), não no evento:
-- `game_events` continua com o valor da regra e o peso é 1/n corretores do
-- negócio, então um corretor que entra ou sai do rateio reajusta os dois
-- lados sem reescrever evento. Vale para `venda` e para o `distrato` dela; os
-- demais eventos seguem inteiros. O congelado da temporada sai desta mesma
-- função (`close_game_season`), e `game_season_results.sales` passa a aceitar
-- a meia venda.
-- =============================================================================

create or replace function public.game_peso_do_evento(p_event_code text, p_ref_type text, p_ref_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when p_event_code in ('venda', 'distrato') and p_ref_type = 'deal' then
             1.0 / greatest((select count(*) from public.deal_participants dp
                              where dp.deal_id = p_ref_id and dp.role = 'broker'), 1)
           else 1.0
         end;
$$;
revoke all on function public.game_peso_do_evento(text, text, uuid) from public, anon, authenticated;
comment on function public.game_peso_do_evento(text, text, uuid) is
  'Peso do evento no placar (0308): venda e distrato dividem pelos corretores do negócio; o resto vale inteiro.';

alter table public.game_season_results alter column sales type numeric(10, 1) using sales::numeric;

drop function if exists public.visible_game_ranking(uuid);
drop function if exists public.visible_game_ranking(uuid, date, date);

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
    select sum(d.vgv_net * dp.share_pct / 100) as vgv
    from public.deal_participants dp
    join public.deals d on d.id = dp.deal_id
    join public.game_seasons gs on gs.id = p_season_id
    where dp.profile_id = p.id
      and dp.role = 'broker'
      and d.outcome = 'won'
      and d.closed_at::date >= gs.period_start
      and d.closed_at::date <= coalesce(gs.period_end, current_date)
      and (
        (p_from is null and p_to is null)
        -- Com intervalo, quem manda é a data do PONTO da venda — a mesma que
        -- conta a coluna "vendas" ao lado. Ver o bloco acima.
        or exists (
          select 1
          from public.game_events e
          where e.season_id = p_season_id
            and e.profile_id = p.id
            and e.event_code = 'venda'
            and e.ref_type = 'deal'
            and e.ref_id = d.id
            and (p_from is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date >= p_from)
            and (p_to   is null or (e.occurred_at at time zone 'America/Sao_Paulo')::date <= p_to)
        )
      )
  ) v on true;
$$;

comment on function public.visible_game_ranking(uuid, date, date) is
  'Ranking da temporada recortado por um intervalo de dias (America/Sao_Paulo). Venda e '
  'distrato pesam 1/n corretores do negócio (0308): meia venda e meio ponto no dividido. '
  'Intervalo nulo = temporada inteira. A visibilidade por papel é can_see_game_profile.';
revoke all on function public.visible_game_ranking(uuid, date, date) from public, anon;
grant execute on function public.visible_game_ranking(uuid, date, date) to authenticated, service_role;

-- A assinatura antiga segue como atalho (0107), com o tipo novo de vendas.
create or replace function public.visible_game_ranking(p_season_id uuid)
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
  select * from public.visible_game_ranking(p_season_id, null::date, null::date);
$$;
revoke all on function public.visible_game_ranking(uuid) from public, anon;
grant execute on function public.visible_game_ranking(uuid) to authenticated, service_role;
