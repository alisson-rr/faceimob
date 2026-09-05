-- =============================================================================
-- Regressão da 0078 — a esteira pontua na ENTRADA do dossiê, e o ponto perdido
-- com o jogo parado deixa de ser silencioso para quem perdeu.
--
-- O inventário de 06/09 achou o único gatilho de pontuação sem teste nenhum
-- (`cca_award_points`: 7 blocos no 23_gamificacao.sql, nenhum toca CCA) e,
-- dentro dele, o único gatilho quebrado — a regra `esteira` (140 pts) nunca
-- disparou pelo caminho real, porque `submit_deal_for_analysis` CRIA o caso já
-- em `under_review` e o gatilho era `after update`.
--
-- Nada aqui chama `award_game_points` direto: o que precisa de prova é o
-- GATILHO. Chamar a função à mão contornaria exatamente o que falhava.
--
-- Os UUIDs saem da faixa `…-000000780000`, exclusiva deste arquivo — a faixa
-- `…-0000000000fN` do harness e a `…-000000600000` do 23 já estão ocupadas.
-- =============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- -----------------------------------------------------------------------------
-- Estado conhecido
--
-- Este arquivo roda por último (78). O 23 deixa uma temporada aberta e o 16 um
-- mês travado; nada aqui compara total — todas as asserções contam os eventos
-- DESTE cenário, pelo `ref_id` dos negócios que ele cria.
-- -----------------------------------------------------------------------------
do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000780001';
  v_mes   date := public.month_start((current_date + interval '9 months')::date);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (jogador, 'jogador@game0078.test', '{"full_name":"Jogador Zero Setenta e Oito"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values (jogador, 'broker')
  on conflict do nothing;

  -- Temporada única e aberta hoje: `game_seasons_one_open` só admite uma.
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  insert into public.game_seasons (label, period_start)
  values ('Temporada 0078', current_date);

  -- O mês-base do cenário está no futuro; `deals_guard_closed_month` recusaria
  -- o insert se algum teste anterior o tivesse travado.
  delete from public.closed_months where period = v_mes;

  -- O peso vem de `game_scoring_rules` (seed.sql). Sem a regra, todo assert
  -- abaixo mediria zero e culparia o gatilho por uma falha de cenário.
  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_scoring_rules
      where season_id is null and active and event_code in ('esteira', 'aprovado')),
    2, 'cenário: as regras padrão de esteira e aprovado existem e estão ativas');
end
$$;

\echo '== 1. esteira: a regra que nunca disparou pelo caminho real =='

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000780001';
  v_mes   date := public.month_start((current_date + interval '9 months')::date);
  v_deal  uuid;
  v_case  uuid;
begin
  -- Sem `created_by`: `deals_add_creator_participant` (0048) já grava o autor
  -- no rateio, e o insert explícito abaixo violaria a unicidade de
  -- `deal_participants`. Mesmo desenho do 23_gamificacao e do 58_pipeline.
  insert into public.deals (stage_id, vgv_gross, month_base, unit, document_review_status)
  select id, 500000, v_mes, 'G0078-A', 'approved'
  from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events where ref_id = v_deal),
    0, 'negócio fora da esteira não pontua');

  -- É ISTO que `submit_deal_for_analysis` (0028) faz na PRIMEIRA submissão: um
  -- INSERT com status já em `under_review`. O gatilho `after update` da 0010
  -- não rodava aqui — 12 casos no remoto, 0 eventos de esteira vindos deles.
  insert into public.cca_cases (deal_id, status, submitted_at)
  values (v_deal, 'under_review', now())
  returning id into v_case;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'esteira' and profile_id = jogador),
    1, 'a PRIMEIRA entrada na esteira pontua o corretor do rateio (0078)');

  perform pg_temp.assert_eq(
    (select points from public.game_events
      where ref_id = v_deal and event_code = 'esteira' limit 1),
    public.scoring_points(public.current_game_season(), 'esteira'),
    'o evento de esteira vale o peso de game_scoring_rules, não um número no gatilho');

  -- Idempotência por negócio: voltar da esteira e reenviar não pontua de novo
  -- (`game_events_dedupe_idx` é único em season+profile+code+ref).
  update public.cca_cases set status = 'pending_documents' where id = v_case;
  update public.cca_cases set status = 'under_review'      where id = v_case;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'esteira'),
    1, 'reenviar o mesmo negócio para a esteira não pontua duas vezes');

  -- O ramo de UPDATE continua vivo: é ele que pontua a decisão do analista.
  update public.cca_cases set status = 'approved', decided_at = now() where id = v_case;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'aprovado' and profile_id = jogador),
    1, 'a aprovação do analista continua pontuando pelo UPDATE');
end
$$;

\echo '== 2. caso que NASCE aprovado pontua a aprovação, e só ela =='

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000780001';
  v_mes   date := public.month_start((current_date + interval '9 months')::date);
  v_deal  uuid;
begin
  insert into public.deals (stage_id, vgv_gross, month_base, unit, document_review_status)
  select id, 300000, v_mes, 'G0078-B', 'approved'
  from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  -- Carga inicial e correção do admin gravam o caso já decidido. Com o gatilho
  -- só de UPDATE isso também não pontuava — é o mesmo par que a 0060 fechou
  -- para o negócio que nasce ganho.
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at)
  values (v_deal, 'approved', now(), now());

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'aprovado' and profile_id = jogador),
    1, 'caso que nasce aprovado pontua a aprovação');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'esteira'),
    0, 'nascer aprovado não inventa uma passagem pela esteira');
end
$$;

\echo '== 3. jogo parado: o ponto é descartado, mas o corretor fica sabendo =='

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000780001';
  v_mes   date := public.month_start((current_date + interval '9 months')::date);
  v_deal  uuid;
  v_case  uuid;
begin
  delete from public.notifications where profile_id = jogador and kind = 'game_paused';

  -- Jogo parado é a temporada fechada sem próxima aberta — o estado que a tela
  -- da Gamificação chama de "Jogo parado".
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  perform pg_temp.assert_eq(public.current_game_season() is null, true,
    'cenário: nenhuma temporada aberta');

  insert into public.deals (stage_id, vgv_gross, month_base, unit, document_review_status)
  select id, 200000, v_mes, 'G0078-C', 'approved'
  from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  insert into public.cca_cases (deal_id, status, submitted_at)
  values (v_deal, 'under_review', now())
  returning id into v_case;

  -- Decisão de 06/09: o ponto NÃO é recuperado quando a próxima temporada
  -- abrir. Recuperar encheria a temporada nova de fatos que ninguém viu.
  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events where ref_id = v_deal),
    0, 'com o jogo parado nada entra em game_events');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications
      where profile_id = jogador and kind = 'game_paused' and read_at is null),
    1, 'quem perdeu o ponto recebe o aviso no sino');

  perform pg_temp.assert_eq(
    (select body like '%Envio para esteira ágil%' from public.notifications
      where profile_id = jogador and kind = 'game_paused' order by created_at desc limit 1),
    true, 'o aviso nomeia o movimento pelo rótulo da regra, não pelo código');

  -- Um NÃO LIDO por pessoa: sem esta guarda, cada documento anexado com o jogo
  -- parado repetiria a mesma frase no sino.
  update public.cca_cases set status = 'approved', decided_at = now() where id = v_case;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications
      where profile_id = jogador and kind = 'game_paused'),
    1, 'o segundo movimento com o jogo parado não repete o aviso');

  -- Lido o aviso, o próximo movimento volta a avisar: a guarda é por não lido,
  -- não "uma vez na vida".
  update public.notifications set read_at = now()
   where profile_id = jogador and kind = 'game_paused';

  update public.cca_cases set status = 'pending_documents' where id = v_case;
  update public.cca_cases set status = 'under_review'      where id = v_case;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications
      where profile_id = jogador and kind = 'game_paused' and read_at is null),
    1, 'depois de lido, um movimento novo avisa de novo');

  -- Devolve o jogo ao ar: o arquivo é o último da bateria, mas deixar o banco
  -- com o jogo parado esconderia qualquer regressão de quem rodar só a sanidade.
  insert into public.game_seasons (label, period_start)
  values ('Temporada pós-0078', current_date);
end
$$;

\echo 'gamificação (0078) ok'
