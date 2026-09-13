-- =============================================================================
-- 0142 · Game: o distrato que escapava, a venda reaberta, o rateio simétrico,
--        a esteira da construtora externa e o congelado com a regra do vivo
--
-- Pedido do dono em 12/09/2026. Cinco defeitos de pontuação, todos corrigidos
-- no gatilho — o ponto por onde TODO caminho passa (Pipeline, importação,
-- correção do admin) —, e não em tela.
--
-- a) DISTRATO QUE ESCAPAVA. `deals_award_points` (0060) só penalizava quando o
--    negócio GANHO virava perdido no MESMO update (`old.outcome = 'won'`).
--    Ganho → etapa aberta → perdido (reabrir "para arrumar" e depois perder)
--    deixava os +600 de pé sem os −600. O fato que decide passa a ser: o
--    negócio virou perdido/cancelado E aquele corretor tem venda DESTE negócio
--    na temporada aberta. "Sem distrato ainda" é garantido pelo
--    `game_events_dedupe_idx` (temporada, pessoa, evento, negócio).
--
-- b) VENDA REABERTA ZERAVA. Ganho (+600) → perdido (−600) → reaberto → ganho de
--    novo terminava em 0: o +600 da segunda vitória cai no `on conflict do
--    nothing` (a venda original continua lá) e o −600 ficava. Voltar a ganho
--    agora retira o distrato daquele corretor naquele negócio na temporada
--    aberta, com rastro em `deal_history` (`game_points_revoked`, o mesmo que a
--    saída do rateio já grava desde a 0060).
--
-- c) VIVO × CONGELADO. `visible_game_ranking` lista só quem tem papel `broker`;
--    `close_game_season` congelava a view `game_ranking`, que soma o log de
--    QUALQUER perfil. Ponto lançado à mão para quem não é corretor não aparecia
--    no placar e aparecia no congelado. O fechamento passa a congelar a própria
--    `visible_game_ranking`: uma regra só para quem joga, pontos, vendas e VGV.
--    Quem fecha é `is_admin()` (admin ou sócio), e para esses dois
--    `can_see_game_profile` é a casa inteira — nenhuma linha some por escopo.
--
-- d) RATEIO ASSIMÉTRICO. Entrar no rateio dava só a venda; sair tirava só a
--    venda. Agora entrar dá também os eventos que o NEGÓCIO já gerou na
--    temporada aberta (esteira, aprovado, incompleto_com_doc), e sair tira
--    todos os eventos daquele corretor naquele negócio na temporada aberta —
--    venda e distrato inclusive —, cada um com rastro.
--
-- e) ESTEIRA DA CONSTRUTORA EXTERNA. No fluxo externo `submit_deal_for_analysis`
--    (0077) cria o caso já em `sent_to_developer`, e `cca_award_points` (0078)
--    só pontuava `under_review`: o corretor que mandava o dossiê para a
--    construtora externa ganhava zero. O primeiro envio é a mesma entrada na
--    esteira e vale os mesmos pontos.
--
-- j) VENDA JÁ PAGA NÃO PAGA DE NOVO (achado da revisão). Com (a), perder hoje
--    uma venda de temporada fechada não penaliza — e ganhá-la de novo pagava
--    outra venda na temporada aberta, porque o dedupe é por temporada: +600
--    duas vezes por um negócio. Reabrir sem perder e sair e voltar ao rateio
--    faziam o mesmo desde a 0060. `award_game_points` passa a recusar a venda
--    de quem já tem, nas temporadas fechadas, mais vendas que distratos daquele
--    negócio. Venda que levou o distrato lá paga de novo, como deve.
--
-- i) Na homologação há DUAS temporadas "Setembro 2026": a importada do Bubble
--    (fechada em 12/09 às 16:10) e a aberta. O seletor da Gamificação e o selo
--    "De Setembro 2026 (encerrada)" das regras ficavam ambíguos. O critério é
--    `import_bubble_map` (0096), que só tem linha para o que veio da carga.
--
-- ── O QUE NÃO MUDA ─────────────────────────────────────────────────────────
--   · Distrato continua penalidade, não estorno (decisão de 03/09): perder uma
--     venda da temporada aberta mantém os +600 e soma os −600.
--   · Nada é repontuado para trás, e temporada fechada não é tocada.
--
-- ── CONSEQUÊNCIAS ASSUMIDAS ────────────────────────────────────────────────
--   · Venda pontuada em temporada JÁ FECHADA e perdida na aberta não gera mais
--     −600: os +600 estão no congelado, não na temporada em jogo. É o caso de
--     todo negócio importado — a carga não trouxe `game_events` —, e perder
--     hoje um negócio ganho no Bubble deixa de penalizar alguém por um ponto
--     que o placar novo nunca deu. Ganhar de novo a venda de temporada fechada
--     também não paga outra (item j); a do Bubble, sem evento, paga.
--   · O congelado passa a ter só corretores (papel `broker`) com pelo menos um
--     evento na temporada. Ponto dado à mão a quem não é corretor fica fora do
--     congelado, como já ficava fora do vivo.
--   · Seed que insere `cca_cases` em `sent_to_developer` passa a pontuar
--     esteira — a mesma família de consequência que a 0078 registrou.
--
-- Idempotente: `create or replace` e um `update` que só casa enquanto o rótulo
-- colide. Em banco novo `import_bubble_map` está vazia e o update não toca nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Venda, distrato e a volta ao ganho (itens a e b)
-- -----------------------------------------------------------------------------
create or replace function public.deals_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_broker uuid;
  v_points int;
begin
  -- `OLD` não existe no INSERT, então o ramo sai por `if` de statement (0060).
  -- Negócio que nasce ganho pontua quem já estiver no rateio — em geral
  -- ninguém: o rateio entra depois e quem pontua é
  -- `deal_participants_award_points`. Nascer perdido não é distrato: não houve
  -- venda antes.
  if tg_op = 'INSERT' then
    if new.outcome = 'won' then
      for v_broker in
        select profile_id from public.deal_participants
        where deal_id = new.id and role = 'broker'
      loop
        perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());
      end loop;
    end if;
    return null;
  end if;

  -- Editar um negócio sem trocar o desfecho é o update mais comum da tabela;
  -- sai antes de qualquer leitura do log.
  if new.outcome is not distinct from old.outcome then
    return null;
  end if;

  v_season := public.current_game_season();

  if new.outcome = 'won' then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.id and role = 'broker'
    loop
      -- Venda já paga numa temporada fechada é recusada dentro da própria
      -- `award_game_points` (item j), o ponto por onde o rateio também passa.
      perform public.award_game_points(v_broker, 'venda', 'deal', new.id, now());

      -- (b) Ganhar de novo desfaz o distrato desta temporada. Apagar, e não
      -- lançar +600 de compensação, pelo mesmo motivo da 0060: o índice de
      -- dedupe recusaria a compensação e o saldo ficaria zerado para sempre.
      -- Sem temporada aberta `season_id = null` não casa nada.
      v_points := null;
      delete from public.game_events
       where season_id = v_season
         and profile_id = v_broker
         and event_code = 'distrato'
         and ref_type = 'deal'
         and ref_id = new.id
      returning points into v_points;

      if v_points is not null then
        insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
        values (new.id, auth.uid(), 'game_points_revoked', v_points::text, '0',
                jsonb_build_object('profile_id', v_broker, 'event_code', 'distrato'));
      end if;
    end loop;

  elsif new.outcome in ('lost', 'cancelled') then
    -- (a) Quem é penalizado é quem tem a VENDA deste negócio na temporada
    -- aberta, venha o perdido direto do ganho ou depois de uma etapa aberta.
    -- Sem venda nesta temporada não há o que penalizar: proposta que cai sem
    -- nunca ter sido ganha, ou venda de temporada já congelada.
    for v_broker in
      select e.profile_id
      from public.game_events e
      where e.season_id = v_season
        and e.event_code = 'venda'
        and e.ref_type = 'deal'
        and e.ref_id = new.id
    loop
      perform public.award_game_points(v_broker, 'distrato', 'deal', new.id, now());
    end loop;
  end if;

  return null;
end;
$$;

comment on function public.deals_award_points() is
  'Pontua venda ao virar ganho (INSERT ou UPDATE) e distrato ao virar perdido/'
  'cancelado para quem tem a venda do negócio na temporada aberta — mesmo com '
  'etapa aberta no meio (0142). Voltar a ganho retira o distrato da temporada '
  'aberta com rastro em deal_history. Distrato é penalidade, não estorno.';

-- -----------------------------------------------------------------------------
-- 2. Entrar no rateio traz os eventos do negócio (item d)
-- -----------------------------------------------------------------------------
create or replace function public.deal_participants_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_code   text;
begin
  if new.role <> 'broker' then
    return null;
  end if;

  -- A venda segue o ESTADO do negócio, como desde a 0060: `saveLegacyDeal`
  -- grava o negócio antes do rateio, e é aqui que a venda de quem entra nasce.
  if exists (select 1 from public.deals d where d.id = new.deal_id and d.outcome = 'won') then
    perform public.award_game_points(new.profile_id, 'venda', 'deal', new.deal_id, now());
  end if;

  -- Os outros três seguem os EVENTOS que o negócio já gerou na temporada
  -- aberta. É o espelho exato da saída (item 3): o que sai com quem deixa o
  -- rateio é o que entra com quem chega. `saveLegacyDeal` faz upsert ANTES de
  -- apagar quem saiu, então na troca de corretor o evento do antigo ainda
  -- existe quando o novo entra. Distrato não entra: ele só existe junto de uma
  -- venda, e quem chega a um negócio perdido não teve a venda.
  v_season := public.current_game_season();

  for v_code in
    select distinct e.event_code
    from public.game_events e
    where e.season_id = v_season
      and e.ref_type = 'deal'
      and e.ref_id = new.deal_id
      and e.event_code in ('esteira', 'aprovado', 'incompleto_com_doc')
  loop
    perform public.award_game_points(new.profile_id, v_code, 'deal', new.deal_id, now());
  end loop;

  return null;
end;
$$;

comment on function public.deal_participants_award_points() is
  'Corretor que entra no rateio pontua a venda se o negócio está ganho e recebe '
  'os eventos de esteira, aprovado e incompleto_com_doc que o negócio já gerou '
  'na temporada aberta (0142). Idempotente pelo game_events_dedupe_idx.';

-- -----------------------------------------------------------------------------
-- 3. Sair do rateio leva todos os eventos do negócio (item d)
-- -----------------------------------------------------------------------------
create or replace function public.deal_participants_revoke_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role <> 'broker' then
    return null;
  end if;

  -- Exclusão do negócio inteiro chega aqui pelo cascade com a linha de `deals`
  -- já removida: sem esta saída o rastro abaixo violaria a FK de
  -- `deal_history.deal_id`. É a mesma guarda que a 0060 fazia com `outcome =
  -- 'won'` — que deixou de fazer sentido: com venda E distrato saindo juntos,
  -- tirar alguém de um negócio perdido não o deixa mais no negativo.
  if not exists (select 1 from public.deals d where d.id = old.deal_id) then
    return null;
  end if;

  -- Só a temporada aberta: o congelado não se reescreve. Uma linha de rastro
  -- por evento retirado, com autor e valor, para quem enxerga o negócio.
  with retirados as (
    delete from public.game_events
     where profile_id = old.profile_id
       and ref_type = 'deal'
       and ref_id = old.deal_id
       and season_id = public.current_game_season()
       and event_code in ('venda', 'distrato', 'esteira', 'aprovado', 'incompleto_com_doc')
    returning event_code, points
  )
  insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
  select old.deal_id, auth.uid(), 'game_points_revoked', r.points::text, '0',
         jsonb_build_object('profile_id', old.profile_id, 'event_code', r.event_code)
  from retirados r;

  return null;
end;
$$;

comment on function public.deal_participants_revoke_points() is
  'Corretor que sai do rateio perde, na temporada aberta, todos os eventos '
  'daquele negócio (venda, distrato, esteira, aprovado, incompleto_com_doc), '
  'com uma linha game_points_revoked em deal_history por evento (0142).';

-- -----------------------------------------------------------------------------
-- 4. Esteira também no envio à construtora externa (item e)
-- -----------------------------------------------------------------------------
create or replace function public.cca_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker   uuid;
  v_aprovado boolean := false;
  v_esteira  boolean := false;
begin
  -- `sent_to_developer` conta como entrada na esteira: é o status em que o
  -- fluxo EXTERNO cria o caso (0077). Passar de `under_review` para
  -- `sent_to_developer` depois (construtora externa escolhida já com o caso em
  -- análise) chama de novo e cai no dedupe — o envio pontua uma vez por
  -- negócio na temporada, qualquer que seja o fluxo.
  if tg_op = 'INSERT' then
    v_aprovado := (new.status = 'approved');
    v_esteira  := (new.status in ('under_review', 'sent_to_developer'));
  else
    v_aprovado := (new.status = 'approved' and old.status is distinct from 'approved');
    v_esteira  := (new.status in ('under_review', 'sent_to_developer')
                   and old.status not in ('under_review', 'sent_to_developer'));
  end if;

  if v_aprovado then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.deal_id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'aprovado', 'deal', new.deal_id, now());
    end loop;
  end if;

  if v_esteira then
    for v_broker in
      select profile_id from public.deal_participants
      where deal_id = new.deal_id and role = 'broker'
    loop
      perform public.award_game_points(v_broker, 'esteira', 'deal', new.deal_id, now());
    end loop;
  end if;

  return null;
end;
$$;

comment on function public.cca_award_points() is
  'Pontua esteira na entrada do dossiê — under_review (fluxo interno) ou '
  'sent_to_developer (construtora externa, 0142) — e aprovado na decisão do '
  'analista. INSERT ou UPDATE. Idempotente por negócio pelo game_events_dedupe_idx.';

-- -----------------------------------------------------------------------------
-- 5. O congelado sai do placar vivo (item c)
-- -----------------------------------------------------------------------------
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

  -- `greatest`: a temporada que este fluxo abre nasce em `current_date + 1`, e
  -- encerrá-la no mesmo dia daria `period_end < period_start` (0060).
  v_period_end := greatest(v_season.period_start, current_date);

  -- O fim do período é gravado ANTES de congelar: `visible_game_ranking` tira o
  -- teto do VGV de `game_seasons.period_end` e, com ele ainda nulo, usaria
  -- `current_date` — que difere de `v_period_end` justamente no segundo
  -- fechamento do mesmo dia.
  update public.game_seasons
     set closed_at = now(),
         closed_by = auth.uid(),
         period_end = v_period_end
   where id = v_season.id;

  -- Congela exatamente o placar vivo: quem joga (papel `broker`), pontos,
  -- vendas e VGV saem da MESMA função que a tela lê. O filtro de `breakdown`
  -- mantém o congelado como sempre foi — de quem pontuou —, porque o vivo
  -- devolve todo corretor, com ou sem ponto, e a casa tem centenas deles.
  insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv, breakdown)
  select
    r.season_id,
    r.profile_id,
    row_number() over (order by r.points desc, r.full_name)::int,
    r.points,
    r.sales,
    r.vgv,
    r.breakdown
  from public.visible_game_ranking(v_season.id) r
  where r.breakdown <> '{}'::jsonb
  on conflict (season_id, profile_id) do nothing;

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
  'Encerra a temporada aberta: congela visible_game_ranking (a mesma regra do '
  'placar vivo — só corretores, desde a 0142; só quem pontuou) e abre a próxima. '
  'NÃO trava mês — p_close_month é ignorado desde a 0032; o fechamento contábil '
  'é close_month_and_season(). Só admin e sócio.';

-- -----------------------------------------------------------------------------
-- 6. A temporada importada deixa de ter o mesmo nome da aberta (item i)
-- -----------------------------------------------------------------------------
-- Só renomeia a importada que COLIDE com uma temporada criada aqui. Temporada
-- importada sem homônima fica como veio; depois do sufixo o rótulo deixa de
-- colidir e reaplicar não faz nada.
update public.game_seasons s
   set label = s.label || ' (importada)'
 where exists (
         select 1 from public.import_bubble_map m
          where m.tabela_destino = 'game_seasons' and m.registro_id = s.id
       )
   and exists (
         select 1 from public.game_seasons o
          where o.id <> s.id
            and o.label = s.label
            and not exists (
              select 1 from public.import_bubble_map m
               where m.tabela_destino = 'game_seasons' and m.registro_id = o.id
            )
       );

-- -----------------------------------------------------------------------------
-- 7. Venda já paga numa temporada fechada não paga de novo (item j)
-- -----------------------------------------------------------------------------
-- Corpo idêntico ao da 0078 mais a guarda da venda. A guarda mora aqui, e não
-- nos gatilhos, porque os dois caminhos da venda — o desfecho do negócio e a
-- entrada no rateio — passam por esta função.
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

comment on function public.award_game_points is
  'Pontua um evento na temporada aberta. Sem temporada, o ponto é DESCARTADO '
  '(decisão de 06/09: não há recuperação retroativa) e o corretor recebe um '
  'aviso no sino — um não lido por pessoa, kind game_paused. Venda de negócio '
  'já paga numa temporada fechada, sem distrato lá, não pontua de novo (0142).';
