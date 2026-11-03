-- =============================================================================
-- 0319 — venda interna: segue na esteira do CCA, fora do mês, do game e do ranking.
-- =============================================================================
-- Pedido de 03/11/2026: "fiz uma venda, preciso mantê-la na esteira do CCA mas
-- não contar para o nosso mês nem para o Archimedes; venda interna, não contábil
-- para o game nem para o ranking".
--
-- `deals.venda_interna`: o negócio continua igual em tudo (Pipeline, CCA,
-- documentos), mas não pontua (`award_game_points`) e sai do placar
-- (`visible_game_ranking`) — inclusive o que já tinha pontuado. As contas do
-- mês na tela (`contaComoVenda`) também o deixam de fora. Só o administrador
-- marca ou desmarca.
-- =============================================================================

alter table public.deals add column if not exists venda_interna boolean not null default false;
comment on column public.deals.venda_interna is
  'Venda interna (0319): segue no Pipeline e na esteira do CCA, mas não conta no mês, no game nem no ranking. Só admin altera.';

create or replace function public.deals_guarda_venda_interna()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.venda_interna is distinct from (case when tg_op = 'UPDATE' then old.venda_interna else false end)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Só o administrador marca uma venda como interna.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.deals_guarda_venda_interna() from public, anon, authenticated;
drop trigger if exists deals_guarda_venda_interna on public.deals;
create trigger deals_guarda_venda_interna
  before insert or update of venda_interna on public.deals
  for each row execute function public.deals_guarda_venda_interna();

create or replace function public.award_game_points(
  p_profile_id uuid,
  p_event_code text,
  p_ref_type   text default null,
  p_ref_id     uuid default null,
  p_occurred   timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid := public.current_game_season();
  v_points int;
  v_id     uuid;
  v_label  text;
begin
  -- 0319: venda interna não pontua nada (venda, proposta, documento...).
  if p_ref_type = 'deal' and exists (
    select 1 from public.deals d where d.id = p_ref_id and d.venda_interna
  ) then
    return null;
  end if;

  if v_season is null then
    raise warning 'award_game_points: jogo parado, ponto descartado (perfil=%, evento=%, ref=%)',
      p_profile_id, p_event_code, p_ref_id;

    -- Um aviso NÃO LIDO por pessoa. Sem esta guarda, anexar cinco documentos
    -- com o jogo parado enchia o sino com a mesma frase cinco vezes — e a
    -- frase não depende do evento: o que aconteceu é que não há temporada.
    if p_profile_id is not null and not exists (
      select 1 from public.notifications n
      where n.profile_id = p_profile_id
        and n.kind = 'game_paused'
        and n.read_at is null
    ) then
      -- O rótulo sai da regra, como em toda a tela: `scoring_points` prefere a
      -- regra da temporada sobre a padrão, e aqui não há temporada — então só
      -- a padrão (`season_id is null`) faz sentido. Sem regra cadastrada, o
      -- próprio código do evento.
      select r.label into v_label
      from public.game_scoring_rules r
      where r.event_code = p_event_code and r.season_id is null
      limit 1;

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      values (
        p_profile_id,
        'game_paused',
        'Jogo parado: este movimento não pontuou',
        format(
          '%s aconteceu sem temporada aberta e não entrou no placar. O ponto não é recuperado quando a próxima temporada abrir — peça ao administrador para abrir o jogo.',
          coalesce(v_label, p_event_code)
        ),
        '/gamification',
        'in_app'
      );
    end if;

    return null;
  end if;

  -- (0142, item j) O dedupe é por temporada: sem esta guarda, a venda que já
  -- pontuou numa temporada fechada pontuava de novo na aberta ao ser ganha
  -- outra vez ou ao o corretor voltar ao rateio. Vendas menos distratos nas
  -- fechadas > 0 = já pago e nunca penalizado. O join parte das temporadas
  -- para cada busca cair inteira no `game_events_dedupe_idx`.
  if p_event_code = 'venda' and p_ref_type = 'deal' and p_ref_id is not null
     and (select count(*) filter (where e.event_code = 'venda')
               - count(*) filter (where e.event_code = 'distrato')
            from public.game_seasons s
            join public.game_events e
              on e.season_id = s.id
             and e.profile_id = p_profile_id
             and e.event_code in ('venda', 'distrato')
             and e.ref_type = 'deal'
             and e.ref_id = p_ref_id
           where s.closed_at is not null) > 0
  then
    return null;
  end if;

  v_points := public.scoring_points(v_season, p_event_code);
  if v_points is null then
    raise warning 'award_game_points: evento sem regra ativa, ponto descartado (evento=%, ref=%)',
      p_event_code, p_ref_id;
    return null;
  end if;

  insert into public.game_events (season_id, profile_id, event_code, points,
                                  ref_type, ref_id, occurred_at)
  values (v_season, p_profile_id, p_event_code, v_points, p_ref_type, p_ref_id, p_occurred)
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;


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
      -- 0311: venda e distrato só do negócio do mês da temporada.
      and (e.event_code not in ('venda', 'distrato') or e.ref_type is distinct from 'deal'
           or exists (select 1 from public.deals d join public.game_seasons gs on gs.id = p_season_id
                       where d.id = e.ref_id
                         and d.month_base >= date_trunc('month', gs.period_start)::date
                         and (gs.period_end is null or d.month_base <= gs.period_end)))
      -- 0319: venda interna fora do placar, inclusive o que pontuou antes da marca.
      and not (e.ref_type = 'deal' and exists (
        select 1 from public.deals di where di.id = e.ref_id and di.venda_interna))
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
    join public.game_seasons gs on gs.id = p_season_id
    -- Só negócio do mês da temporada (mês-base), como as vendas acima.
    where not d.venda_interna
      and d.month_base >= date_trunc('month', gs.period_start)::date
      and (gs.period_end is null or d.month_base <= gs.period_end)
      and d.id in (
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

