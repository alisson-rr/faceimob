-- =============================================================================
-- 0060 · Gamificação: as duas regras mortas passam a disparar, e o log de
--        pontos deixa de ser público
--
-- O inventário de 02/09 mediu a pontuação automática em 38% e achou quatro
-- coisas que esta migration corrige na causa, no banco, e não em cada tela:
--
-- 1. `distrato` (-600) NUNCA disparava pelo produto. O gatilho exigia
--    `new.outcome = 'cancelled'`, e NENHUM dos 9 estágios do funil tem esse
--    resultado (só open/won/lost). O diálogo de perda com motivo "17. DISTRATO"
--    grava a etapa `lost` → `outcome = 'lost'`, que não casava com nenhum dos
--    dois ramos: a venda continuava valendo +600 e a penalidade nunca entrava.
--    Agora o gatilho olha a PERDA de um negócio que estava GANHO, que é o fato
--    real, e não um `outcome` que o produto não produz.
--
--    **A venda não é estornada** (decisão de 03/09, seguindo a ata de 14/07):
--    "Distrato/Queda" é penalidade, não estorno. Anular o +600 reescreveria
--    retroativamente um ranking que o corretor já viu. Fica +600 e -600.
--
-- 2. `incompleto_com_doc` (10) também nunca disparava: nenhuma função do banco
--    chamava `award_game_points` com esse código — os 47 eventos existentes são
--    todos de seed. Agora o gatilho é o fato que o nome descreve: documento
--    anexado a negócio que ainda está na etapa "Incompleto". Idempotente por
--    negócio (`ref_id = deal_id`), então anexar cinco arquivos pontua uma vez.
--
-- 3. Negócio criado JÁ ganho (importação de planilha, carga inicial, correção
--    do admin) nunca pontuava: o gatilho era AFTER UPDATE. Agora é
--    AFTER INSERT OR UPDATE — o mesmo `on conflict do nothing` de
--    `award_game_points` continua impedindo pontuar duas vezes.
--
-- 4. `game_events` e `game_season_results` tinham SELECT `using (true)`: um
--    corretor — ou a SDR, que nem tem `menu.gamification` — lia o log de pontos
--    e o ranking congelado da casa inteira direto pelo PostgREST. O escopo por
--    equipe (decisão de 10/08) existia só dentro de `visible_game_ranking`.
--
--    **Exceção declarada: o evento `venda` continua legível por todo mundo.**
--    A ata de 14/07 pediu "som a cada venda" e o valor está justamente em a
--    loja inteira ouvir — o `EngagementLayer` assina o realtime de
--    `game_events`, e realtime respeita RLS. O que fecha é o resto do log
--    (esteira, aprovado, incompleto, distrato), que é a leitura individual de
--    desempenho. O nome de quem vendeu continua sendo resolvido por
--    `visible_game_ranking`: quem está fora do escopo do espectador aparece
--    como "Equipe", como já aparecia.
--
-- 5. O VGV congelado não tinha teto de data (`d.closed_at >= period_start` e
--    mais nada): uma temporada fechada com atraso absorvia venda ganha DEPOIS
--    do fim do período. `visible_game_ranking` já limitava; o congelamento não.
--
-- 6. Sair do rateio não devolvia o ponto. O editor de negócio grava os
--    participantes desejados e depois APAGA os que saíram: em negócio já ganho,
--    corrigir o rateio somava +600 ao corretor novo e mantinha os +600 do
--    removido para sempre. O gatilho de DELETE fecha o par do item 3 — e grava
--    `deal_history.kind = 'game_points_revoked'` com o autor, porque tirar
--    ponto de alguém sem rastro é pior do que não tirar.
--
-- Idempotente: `create or replace`, `drop … if exists`, nenhuma escrita de dado.
-- Não repontua o passado — quem perdeu um negócio ganho antes desta migration
-- continua sem a penalidade, porque reescrever placar encerrado é exatamente o
-- que `game_season_results` existe para impedir.
--
-- **Consequência aceita, para quem for aplicar:** com o item 3 valendo, negócio
-- ganho que ENTRA no banco passa a pontuar na temporada aberta — seed de
-- demonstração e importação de planilha incluídos. É o comportamento pedido
-- ("carga inicial nunca pontuava e ninguém percebia"), mas significa que o
-- próximo `db:seed` pode subir o placar da demonstração acima dos números que o
-- seed injeta à mão em `game_events`. Importar histórico com o jogo aberto joga
-- tudo na temporada corrente; se não for isso o desejado, feche a temporada
-- antes da carga.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Escopo do jogo — fonte única
-- -----------------------------------------------------------------------------
-- A regra de "quem enxerga o placar de quem" estava escrita uma vez só, dentro
-- do CTE `visible_brokers` de `visible_game_ranking`. As policies precisam da
-- mesma regra; copiá-la criaria a segunda fonte de verdade que a decisão de
-- 10/08 evita. Vira função, e a RPC passa a chamá-la.
create or replace function public.can_see_game_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.can_read_all()
    or p_profile_id in (select public.auth_visible_profiles())
    or (
      public.has_role('broker')
      and exists (
        select 1
        from public.team_members mine
        join public.team_members peer on peer.team_id = mine.team_id
        join public.teams t on t.id = mine.team_id and t.active
        where mine.profile_id = auth.uid()
          and mine.left_at is null
          and peer.profile_id = p_profile_id
          and peer.left_at is null
      )
    )
  );
$$;

comment on function public.can_see_game_profile(uuid) is
  'Escopo do placar: admin/diretor/sócio veem todos; gerente vê quem lidera; '
  'corretor vê os colegas de equipe ativa e a si mesmo. Fonte única — '
  'visible_game_ranking e as policies de game_events/game_season_results usam esta.';

revoke all on function public.can_see_game_profile(uuid) from public, anon;
grant execute on function public.can_see_game_profile(uuid) to authenticated, service_role;

-- Mesma RPC da 0027, com o CTE trocado pela função acima. O corpo restante é
-- idêntico ao aplicado — só a origem da regra mudou.
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

-- -----------------------------------------------------------------------------
-- 2. O log de pontos deixa de ser público
-- -----------------------------------------------------------------------------
drop policy if exists game_events_select on public.game_events;
create policy game_events_select on public.game_events
  for select to authenticated
  using (event_code = 'venda' or public.can_see_game_profile(profile_id));

comment on table public.game_events is
  'Log de pontuação. SELECT: a venda é pública dentro da casa (a loja inteira '
  'comemora — ata de 14/07, e é o realtime desta tabela que toca a fanfarra); '
  'o restante do log só aparece para quem já enxerga a pessoa (can_see_game_profile).';

drop policy if exists game_season_results_select on public.game_season_results;
create policy game_season_results_select on public.game_season_results
  for select to authenticated
  using (public.can_see_game_profile(profile_id));

comment on table public.game_season_results is
  'Ranking congelado da temporada. Mesmo escopo do ranking vivo: a tela escondia '
  'e o banco não — qualquer autenticado lia os pontos congelados da casa inteira.';

-- Consequência aceita, e escrita na tela: o escopo é o de HOJE. Para corretor e
-- gerente, o colega que saiu da equipe sai também do congelado — `can_see_game_profile`
-- só reconhece vínculo ativo. Admitir o histórico aqui (`team_members` sem o
-- filtro de `left_at`) devolveria a linha, mas abriria o placar congelado a
-- quem passou uma semana na equipe em qualquer época; entre as duas, a que não
-- alarga permissão vence. Quem precisa do congelado íntegro — admin, diretor e
-- sócio, por `can_read_all()` — continua vendo todas as linhas, inclusive as de
-- quem já saiu, e é lá que a auditoria do placar acontece.
-- `buildFrozenScores` (src/components/engagement/ranking.ts) diz o mesmo.

-- -----------------------------------------------------------------------------
-- 3. Ponto descartado deixa rastro
-- -----------------------------------------------------------------------------
-- Sem temporada aberta a função devolvia null em silêncio: a venda acontecia e
-- o ponto se perdia para sempre, sem registro. A tela da Gamificação avisa
-- ("Jogo parado"), mas quem fechou a venda não vê nada. O `raise warning` põe a
-- perda no log do Postgres, que é onde dá para auditar depois.
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
begin
  if v_season is null then
    raise warning 'award_game_points: jogo parado, ponto descartado (perfil=%, evento=%, ref=%)',
      p_profile_id, p_event_code, p_ref_id;
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

-- -----------------------------------------------------------------------------
-- 4. Venda e distrato — o gatilho passa a olhar o fato que o produto produz
-- -----------------------------------------------------------------------------
create or replace function public.deals_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker   uuid;
  v_venda    boolean := false;
  v_distrato boolean := false;
begin
  -- As duas decisões saem de um `if` de STATEMENT, não de uma expressão só.
  -- Em PL/pgSQL `OLD` não está atribuído num gatilho de INSERT, e `and`/`or`
  -- não garantem curto-circuito: `tg_op = 'INSERT' or old.outcome …` numa
  -- expressão única levantaria "record old is not assigned yet".
  if tg_op = 'INSERT' then
    v_venda := (new.outcome = 'won');
  else
    v_venda := (new.outcome = 'won' and old.outcome is distinct from 'won');
    -- Distrato/Queda: negócio que ESTAVA ganho e saiu do ganho. `cancelled`
    -- fica na lista por compatibilidade, mas nenhum estágio o produz — o
    -- caminho real é `lost`, que é o que o diálogo de perda grava.
    v_distrato := (old.outcome = 'won' and new.outcome in ('lost', 'cancelled'));
  end if;

  if v_venda then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());
    end loop;
  end if;

  if v_distrato then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'distrato', 'deal', new.id, now());
    end loop;
  end if;

  return null;
end;
$$;

comment on function public.deals_award_points() is
  'Pontua venda e distrato. Venda em INSERT ou UPDATE (negócio importado já '
  'ganho pontuava zero); distrato quando um negócio GANHO vira perdido — o '
  '+600 da venda fica de pé, a penalidade é somada (decisão de 03/09).';

drop trigger if exists deals_award_points on public.deals;
create trigger deals_award_points
  after insert or update on public.deals
  for each row execute function public.deals_award_points();

-- O gatilho de INSERT sozinho não fecha a lacuna: `saveLegacyDeal` grava o
-- negócio PRIMEIRO e o rateio depois, então no momento do INSERT ainda não há
-- corretor em `deal_participants` e a varredura acima não acha ninguém. Quem
-- pontua é o rateio, não o cadastro do negócio (glossário: "é o rateio que
-- define quem ganha comissão e quem pontua") — então o corretor que entra num
-- negócio JÁ ganho pontua ao entrar. Idempotente pelo mesmo índice de dedupe.
create or replace function public.deal_participants_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role <> 'broker' then
    return null;
  end if;

  if exists (select 1 from public.deals d where d.id = new.deal_id and d.outcome = 'won') then
    perform public.award_game_points(new.profile_id, 'venda', 'deal', new.deal_id, now());
  end if;

  return null;
end;
$$;

revoke all on function public.deal_participants_award_points() from public, anon, authenticated;

drop trigger if exists deal_participants_award_points on public.deal_participants;
create trigger deal_participants_award_points
  after insert on public.deal_participants
  for each row execute function public.deal_participants_award_points();

-- ...e sair do rateio devolve o ponto. `saveLegacyDeal` grava os participantes
-- desejados e DEPOIS apaga os que saíram: sem esta contrapartida, corrigir um
-- erro de digitação no rateio de um negócio já ganho dava +600 ao corretor novo
-- e deixava os +600 do removido gravados para sempre — o total da temporada
-- inflava a cada correção, sem caminho de reversão fora de editar a tabela à
-- mão.
--
-- Só a temporada CORRENTE: placar já congelado em `game_season_results` não é
-- reescrito, que é o motivo de a tabela existir. E só com o negócio ainda em
-- `won`: se ele virou distrato, o -600 já compensa o +600, e apagar só a venda
-- deixaria o corretor no negativo por ter saído do rateio.
create or replace function public.deal_participants_revoke_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_points int;
begin
  if old.role <> 'broker' then
    return null;
  end if;

  if exists (select 1 from public.deals d where d.id = old.deal_id and d.outcome = 'won') then
    delete from public.game_events
     where profile_id = old.profile_id
       and event_code = 'venda'
       and ref_type = 'deal'
       and ref_id = old.deal_id
       and season_id = public.current_game_season()
    returning points into v_points;

    -- Apagar linha de log sem deixar rastro é o que não se faz. Quem tira o
    -- colega do rateio é qualquer participante do negócio (`deal_participants_write`
    -- é `can_edit_deal`) — o mesmo poder que já move a comissão dele, e a
    -- gamificação não é o lugar de reescrever essa autorização. Mas a retirada
    -- passa a ficar no histórico do negócio, com autor e valor, para quem
    -- enxerga o negócio.
    --
    -- Por que apagar, e não lançar um evento negativo de compensação:
    -- `game_events_dedupe_idx` é único em (season_id, profile_id, event_code,
    -- ref_id). Com o +600 preservado, o corretor que VOLTASSE ao rateio não
    -- seria repontuado (o insert cairia no `on conflict do nothing`) e ficaria
    -- com o saldo zerado para sempre. O log fica em `deal_history`, que é
    -- imutável e não interfere na dedupe.
    --
    -- Dentro do `if`: numa exclusão do negócio inteiro o cascade chega aqui com
    -- a linha de `deals` já removida, o `exists` dá falso e nada é inserido —
    -- é o que evita violar a FK de `deal_history.deal_id`.
    if v_points is not null then
      insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
      values (old.deal_id, auth.uid(), 'game_points_revoked', v_points::text, '0',
              jsonb_build_object('profile_id', old.profile_id, 'event_code', 'venda'));
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.deal_participants_revoke_points() from public, anon, authenticated;

drop trigger if exists deal_participants_revoke_points on public.deal_participants;
create trigger deal_participants_revoke_points
  after delete on public.deal_participants
  for each row execute function public.deal_participants_revoke_points();

-- -----------------------------------------------------------------------------
-- 5. Incompleto com documento
-- -----------------------------------------------------------------------------
-- A regra existia em `game_scoring_rules` (10 pts) e nada a emitia. O fato que
-- o nome descreve é: o corretor anexou documento a um negócio que ainda está na
-- etapa "Incompleto". `ref_id = deal_id` deixa o evento idempotente por
-- negócio — cinco arquivos no mesmo negócio valem 10 pontos, não 50.
create or replace function public.deal_documents_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker uuid;
begin
  if not exists (
    select 1
    from public.deals d
    join public.pipeline_stages s on s.id = d.stage_id
    where d.id = new.deal_id and s.code = 'incomplete'
  ) then
    return null;
  end if;

  for v_broker in
    select profile_id from public.deal_participants
    where deal_id = new.deal_id and role = 'broker'
  loop
    perform public.award_game_points(v_broker, 'incompleto_com_doc', 'deal', new.deal_id, now());
  end loop;

  return null;
end;
$$;

revoke all on function public.deal_documents_award_points() from public, anon, authenticated;

drop trigger if exists deal_documents_award_points on public.deal_documents;
create trigger deal_documents_award_points
  after insert on public.deal_documents
  for each row execute function public.deal_documents_award_points();

-- -----------------------------------------------------------------------------
-- 6. O VGV congelado ganha teto de data
-- -----------------------------------------------------------------------------
-- Era só `d.closed_at >= v_season.period_start`. Uma temporada de julho fechada
-- em setembro somava no VGV congelado as vendas de agosto — número que ninguém
-- vai conseguir explicar depois, porque o congelamento é irreversível.
create or replace function public.close_game_season(
  p_next_label text default null,
  p_close_month boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season     public.game_seasons;
  v_period_end date;
  v_next       uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador encerra a temporada.' using errcode = '42501';
  end if;

  select * into v_season from public.game_seasons
  where closed_at is null order by period_start desc limit 1
  for update;

  if not found then
    raise exception 'Nenhuma temporada aberta.' using errcode = 'P0001';
  end if;

  -- `greatest`: a temporada que este mesmo fluxo abre nasce em `current_date + 1`,
  -- então encerrá-la no mesmo dia daria `period_end < period_start` e o
  -- `game_seasons_period` derrubaria a transação inteira com erro cru — dois
  -- fechamentos no mesmo dia são um caminho real (corrigir o mês, refazer a demo).
  v_period_end := greatest(v_season.period_start, current_date);

  -- Congela o ranking com as regras vigentes agora.
  insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv, breakdown)
  select
    r.season_id,
    r.profile_id,
    row_number() over (order by r.points desc, r.full_name)::int,
    r.points,
    r.sales,
    coalesce((
      select sum(d.vgv_net * dp.share_pct / 100)
      from public.deal_participants dp
      join public.deals d on d.id = dp.deal_id
      where dp.profile_id = r.profile_id
        and dp.role = 'broker'
        and d.outcome = 'won'
        and d.closed_at::date >= v_season.period_start
        and d.closed_at::date <= v_period_end
    ), 0),
    r.breakdown
  from public.game_ranking r
  where r.season_id = v_season.id
  on conflict (season_id, profile_id) do nothing;

  update public.game_seasons
     set closed_at = now(),
         closed_by = auth.uid(),
         period_end = v_period_end
   where id = v_season.id;

  -- p_close_month ignorado desde a 0032: quem trava mês é close_month_and_season.

  insert into public.game_seasons (label, period_start)
  values (
    coalesce(p_next_label, public.season_label_ptbr(current_date + 1)),
    current_date + 1
  )
  returning id into v_next;

  return v_next;
end;
$$;

comment on function public.close_game_season is
  'Encerra a temporada aberta: congela o ranking (com o VGV limitado ao período, '
  'desde a 0060) e abre a próxima. NÃO trava mês — p_close_month é ignorado '
  'desde a 0032; o fechamento contábil é close_month_and_season(). Só admin.';
