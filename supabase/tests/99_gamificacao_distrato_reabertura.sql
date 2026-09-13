-- =============================================================================
-- Regressão da 0142 — a pontuação do game pelos caminhos que escapavam:
--   1. distrato depois de uma etapa aberta (ganho → aberto → perdido);
--   2. venda reaberta (perdido → reaberto → ganho devolve a venda);
--   3. rateio simétrico (quem entra recebe e quem sai perde TODOS os eventos
--      do negócio na temporada aberta);
--   4. esteira no envio à construtora externa (`sent_to_developer`);
--   5. vivo e congelado com a mesma regra de quem joga;
--   6. venda paga numa temporada fechada não paga de novo na aberta (perder e
--      ganhar de novo, ou sair e voltar ao rateio).
--
-- Nada aqui chama `award_game_points` à mão: o que se prova é o GATILHO. A
-- única linha escrita direto em `game_events` é o ponto manual do bloco 5, que
-- É o caminho que aquele bloco cobra (ajuste lançado pelo administrador).
--
-- UUIDs na faixa `…-000001420000`, exclusiva deste arquivo. Os negócios levam
-- `code` explícito: marca a linha e não consome `deal_code_seq` — sequência
-- não volta no ROLLBACK de quem roda este cenário contra um banco com dado.
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

create or replace function pg_temp.become(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    false
  );
end;
$$;

create or replace function pg_temp.etapa(p_code text)
returns uuid language sql as $$
  select id from public.pipeline_stages where code = p_code;
$$;

-- Eventos de um corretor num negócio, na temporada ABERTA. `p_code` nulo conta
-- todos os códigos.
create or replace function pg_temp.eventos(p_deal uuid, p_profile uuid, p_code text)
returns int language sql as $$
  select count(*)::int from public.game_events
   where season_id = public.current_game_season()
     and ref_type = 'deal' and ref_id = p_deal and profile_id = p_profile
     and (p_code is null or event_code = p_code);
$$;

create or replace function pg_temp.saldo(p_deal uuid, p_profile uuid)
returns int language sql as $$
  select coalesce(sum(points), 0)::int from public.game_events
   where season_id = public.current_game_season()
     and ref_type = 'deal' and ref_id = p_deal and profile_id = p_profile;
$$;

-- -----------------------------------------------------------------------------
-- Estado conhecido
--
-- Temporada própria aberta hoje e mês-base no futuro, como o 23 e o 78. Nenhum
-- assert compara total da temporada: todos contam os eventos DESTE cenário.
-- -----------------------------------------------------------------------------
do $$
declare
  ana    uuid := '00000000-0000-0000-0000-000001420001';
  beto   uuid := '00000000-0000-0000-0000-000001420002';
  adm    uuid := '00000000-0000-0000-0000-000001420003';
  avulso uuid := '00000000-0000-0000-0000-000001420004';
  v_mes  date := public.month_start((current_date + interval '11 months')::date);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana,    'ana@game0142.test',    '{"full_name":"Ana Cento e Quarenta e Dois"}'),
    (beto,   'beto@game0142.test',   '{"full_name":"Beto Cento e Quarenta e Dois"}'),
    (adm,    'adm@game0142.test',    '{"full_name":"Admin Cento e Quarenta e Dois"}'),
    (avulso, 'avulso@game0142.test', '{"full_name":"Avulso Cento e Quarenta e Dois"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (ana, 'broker'), (beto, 'broker'), (adm, 'admin')
  on conflict do nothing;

  -- `handle_new_auth_user` (0002) dá `broker` a todo perfil novo. O bloco 5
  -- precisa de alguém que NÃO joga.
  delete from public.user_roles where profile_id = avulso and role = 'broker';

  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  insert into public.game_seasons (label, period_start)
  values ('Temporada 0142', current_date);

  delete from public.closed_months where period = v_mes;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_scoring_rules
      where season_id is null and active
        and event_code in ('venda', 'distrato', 'esteira', 'aprovado', 'incompleto_com_doc')),
    5, 'cenário: as cinco regras padrão existem e estão ativas');
end
$$;

\echo '== 1. distrato que escapava: ganho -> etapa aberta -> perdido =='

do $$
declare
  ana    uuid := '00000000-0000-0000-0000-000001420001';
  v_mes  date := public.month_start((current_date + interval '11 months')::date);
  v_deal uuid;
  v_tipo uuid;
begin
  select id into v_tipo from public.document_types where active order by sort_order limit 1;

  -- Sem `created_by`: `deals_add_creator_participant` (0048) poria o autor no
  -- rateio e o insert explícito abaixo violaria a unicidade. Mesmo desenho do 23.
  insert into public.deals (code, stage_id, vgv_gross, month_base, unit, document_review_status)
  values ('G0142-A', pg_temp.etapa('proposal'), 400000, v_mes, 'G0142-A', 'approved')
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, ana, 'broker', 100);

  -- Etapa com `pipeline_stages.requires_document` recusa negócio sem anexo
  -- (`deal_stage_document_block`, 0111) — e a configuração das etapas é do
  -- admin, então o cenário não pode contar com ela desligada. Em "Proposta" o
  -- anexo não pontua nada: `incompleto_com_doc` é só da etapa "Incompleto".
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal, v_tipo, 'game0142/' || v_deal || '/a.pdf', 'a.pdf', 'a-cliente.pdf', ana);

  update public.deals set stage_id = pg_temp.etapa('closed') where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'venda'), 1,
    'ganhar pontua a venda');

  -- É o que o ReopenDealDialog grava: etapa aberta, motivo e Status 2 limpos.
  update public.deals
     set stage_id = pg_temp.etapa('proposal'), lost_reason = null, status_detail = null
   where id = v_deal;

  perform pg_temp.assert_eq((select outcome::text from public.deals where id = v_deal), 'open',
    'reabrir põe o negócio em outcome=open');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'distrato'), 0,
    'reabrir sozinho não é distrato');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'venda'), 1,
    'reabrir não tira a venda');

  -- O caminho que escapava: o update que perde NÃO parte de `won`.
  update public.deals
     set stage_id = pg_temp.etapa('lost'), lost_reason = '18. QUEDA'
   where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'distrato'), 1,
    'perder DEPOIS de uma etapa aberta penaliza quem tem a venda na temporada (antes escapava)');

  perform pg_temp.assert_eq(pg_temp.saldo(v_deal, ana),
    public.scoring_points(public.current_game_season(), 'venda')
      + public.scoring_points(public.current_game_season(), 'distrato'),
    'o saldo do negócio é venda + distrato: penalidade, não estorno');
end
$$;

\echo '== 2. venda reaberta: perdido -> reaberto -> ganho devolve a venda =='

do $$
declare
  ana        uuid := '00000000-0000-0000-0000-000001420001';
  v_deal     uuid;
  v_venda    int := public.scoring_points(public.current_game_season(), 'venda');
  v_distrato int := public.scoring_points(public.current_game_season(), 'distrato');
begin
  select id into v_deal from public.deals where code = 'G0142-A';

  update public.deals
     set stage_id = pg_temp.etapa('proposal'), lost_reason = null, status_detail = null
   where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'distrato'), 1,
    'reabrir não devolve nada ainda: o negócio não foi ganho de novo');

  update public.deals set stage_id = pg_temp.etapa('closed') where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'distrato'), 0,
    'ganhar de novo retira o distrato da temporada aberta');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'venda'), 1,
    'a venda continua uma só (o dedupe não deixa duplicar)');
  perform pg_temp.assert_eq(pg_temp.saldo(v_deal, ana), v_venda,
    'o saldo volta a ser o da venda — antes ficava zerado para sempre');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.deal_history
      where deal_id = v_deal
        and kind = 'game_points_revoked'
        and detail ->> 'event_code' = 'distrato'
        and detail ->> 'profile_id' = ana::text
        and from_value = v_distrato::text),
    1, 'a retirada do distrato fica no histórico do negócio, com o valor');

  -- E o ciclo continua honesto: perder de novo penaliza de novo.
  update public.deals
     set stage_id = pg_temp.etapa('lost'), lost_reason = '18. QUEDA'
   where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.saldo(v_deal, ana), v_venda + v_distrato,
    'perder de novo depois da reabertura volta a penalizar');
end
$$;

\echo '== 3. rateio simétrico: entra e sai com os eventos do negócio =='

do $$
declare
  ana    uuid := '00000000-0000-0000-0000-000001420001';
  beto   uuid := '00000000-0000-0000-0000-000001420002';
  v_mes  date := public.month_start((current_date + interval '11 months')::date);
  v_deal uuid;
  v_case uuid;
  v_tipo uuid;
begin
  select id into v_tipo from public.document_types where active order by sort_order limit 1;

  insert into public.deals (code, stage_id, vgv_gross, month_base, unit, document_review_status)
  values ('G0142-B', pg_temp.etapa('incomplete'), 300000, v_mes, 'G0142-B', 'approved')
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, ana, 'broker', 100);

  -- O negócio anda com a Ana sozinha: documento no incompleto, esteira, aprovação.
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal, v_tipo, 'game0142/' || v_deal || '/a.pdf', 'a.pdf', 'a-cliente.pdf', ana);

  insert into public.cca_cases (deal_id, status, submitted_at)
  values (v_deal, 'under_review', now())
  returning id into v_case;

  update public.cca_cases set status = 'approved', decided_at = now() where id = v_case;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, null), 3,
    'cenário: incompleto_com_doc, esteira e aprovado da Ana');

  -- Beto entra depois. Antes da 0142 ele não recebia nada disso.
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, beto, 'broker');

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, 'incompleto_com_doc'), 1,
    'quem entra no rateio recebe o incompleto_com_doc que o negócio já gerou');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, 'esteira'), 1,
    'quem entra no rateio recebe a esteira que o negócio já gerou');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, 'aprovado'), 1,
    'quem entra no rateio recebe o aprovado que o negócio já gerou');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, 'venda'), 0,
    'negócio aberto: quem entra não ganha venda');

  update public.deals set stage_id = pg_temp.etapa('closed') where id = v_deal;

  perform pg_temp.assert_eq(
    pg_temp.eventos(v_deal, ana, 'venda') + pg_temp.eventos(v_deal, beto, 'venda'), 2,
    'a venda pontua os dois corretores do rateio');

  -- Beto sai com o negócio ganho: leva os quatro eventos, não só a venda.
  delete from public.deal_participants
   where deal_id = v_deal and profile_id = beto and role = 'broker';

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, null), 0,
    'quem sai do rateio perde todos os eventos do negócio na temporada, não só a venda');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.deal_history
      where deal_id = v_deal and kind = 'game_points_revoked'
        and detail ->> 'profile_id' = beto::text),
    4, 'cada evento retirado deixa uma linha no histórico do negócio');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, null), 4,
    'quem fica no rateio não perde nada');

  -- Beto volta, o negócio cai e ele sai de novo: venda e distrato saem JUNTOS.
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, beto, 'broker');

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, null), 4,
    'quem volta ao rateio de negócio ganho recebe a venda e os três eventos de novo');

  update public.deals
     set stage_id = pg_temp.etapa('lost'), lost_reason = '18. QUEDA'
   where id = v_deal;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, 'distrato'), 1,
    'o distrato alcança quem entrou no rateio depois e tem a venda');

  delete from public.deal_participants
   where deal_id = v_deal and profile_id = beto and role = 'broker';

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, beto, null), 0,
    'sair de negócio perdido leva venda e distrato juntos: ninguém fica negativo por ter saído');
  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'distrato'), 1,
    'o distrato de quem ficou continua de pé');
end
$$;

\echo '== 4. esteira no envio à construtora externa =='

do $$
declare
  ana     uuid := '00000000-0000-0000-0000-000001420001';
  v_mes   date := public.month_start((current_date + interval '11 months')::date);
  v_deal  uuid;
  v_deal2 uuid;
  v_case  uuid;
begin
  insert into public.deals (code, stage_id, vgv_gross, month_base, unit, document_review_status)
  values ('G0142-C', pg_temp.etapa('proposal'), 200000, v_mes, 'G0142-C', 'approved')
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, ana, 'broker', 100);

  -- É o que `submit_deal_for_analysis` (0077) grava no fluxo EXTERNO na
  -- primeira submissão: o caso nasce em `sent_to_developer`.
  insert into public.cca_cases (deal_id, status, submitted_at)
  values (v_deal, 'sent_to_developer', now())
  returning id into v_case;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'esteira'), 1,
    'o primeiro envio à construtora externa pontua a esteira (antes: zero)');
  perform pg_temp.assert_eq(pg_temp.saldo(v_deal, ana),
    public.scoring_points(public.current_game_season(), 'esteira'),
    'vale o peso da regra de esteira, o mesmo do fluxo interno');

  update public.cca_cases set status = 'under_review' where id = v_case;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal, ana, 'esteira'), 1,
    'passar para a análise interna depois não pontua de novo');

  -- Resubmissão que cai no `on conflict do update`: caso parado em pendência
  -- que vai para a construtora externa.
  insert into public.deals (code, stage_id, vgv_gross, month_base, unit, document_review_status)
  values ('G0142-D', pg_temp.etapa('proposal'), 200000, v_mes, 'G0142-D', 'approved')
  returning id into v_deal2;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal2, ana, 'broker', 100);

  insert into public.cca_cases (deal_id, status)
  values (v_deal2, 'pending_documents')
  returning id into v_case;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal2, ana, 'esteira'), 0,
    'caso parado em pendência de documentos não pontua');

  update public.cca_cases
     set status = 'sent_to_developer', submitted_at = now()
   where id = v_case;

  perform pg_temp.assert_eq(pg_temp.eventos(v_deal2, ana, 'esteira'), 1,
    'o envio à construtora externa pelo UPDATE também pontua');
end
$$;

\echo '== 5. vivo e congelado com a mesma regra de quem joga =='

do $$
declare
  ana      uuid := '00000000-0000-0000-0000-000001420001';
  beto     uuid := '00000000-0000-0000-0000-000001420002';
  adm      uuid := '00000000-0000-0000-0000-000001420003';
  avulso   uuid := '00000000-0000-0000-0000-000001420004';
  v_season uuid := public.current_game_season();
  v_vivo   int;
begin
  -- Ajuste lançado à mão pelo admin para um perfil que não é corretor, sem
  -- `ref_id` — o jeito como ponto manual entra. O vivo nunca mostrou essa
  -- pessoa; a view que o fechamento lia a congelava.
  insert into public.game_events (season_id, profile_id, event_code, points)
  values (v_season, avulso, 'venda', 600);

  perform pg_temp.become(adm);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.visible_game_ranking(v_season) where profile_id = avulso),
    0, 'cenário: o placar vivo não lista quem não é corretor');

  select r.points into v_vivo
    from public.visible_game_ranking(v_season) r
   where r.profile_id = ana;

  perform public.close_game_season('Temporada seguinte 0142');
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_season_results
      where season_id = v_season and profile_id = avulso),
    0, 'o congelado usa a regra do vivo: quem não é corretor não entra');

  perform pg_temp.assert_eq(
    (select points from public.game_season_results
      where season_id = v_season and profile_id = ana),
    v_vivo, 'o congelado guarda o número que o placar vivo mostrava');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_season_results
      where season_id = v_season and profile_id = beto),
    0, 'corretor sem evento na temporada continua fora do congelado');
end
$$;

\echo '== 6. venda de temporada fechada: perder e ganhar de novo não paga duas vezes =='

do $$
declare
  ana    uuid := '00000000-0000-0000-0000-000001420001';
  v_mes  date := public.month_start((current_date + interval '11 months')::date);
  v_tipo uuid;
  v_paga uuid;  -- venda que fica paga na temporada que fecha
  v_caiu uuid;  -- venda que já levou o distrato na temporada que fecha
begin
  select id into v_tipo from public.document_types where active order by sort_order limit 1;

  insert into public.deals (code, stage_id, vgv_gross, month_base, unit, document_review_status)
  values ('G0142-E', pg_temp.etapa('proposal'), 500000, v_mes, 'G0142-E', 'approved'),
         ('G0142-F', pg_temp.etapa('proposal'), 500000, v_mes, 'G0142-F', 'approved');

  select id into v_paga from public.deals where code = 'G0142-E';
  select id into v_caiu from public.deals where code = 'G0142-F';

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_paga, ana, 'broker', 100), (v_caiu, ana, 'broker', 100);

  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  select d, v_tipo, 'game0142/' || d || '/a.pdf', 'a.pdf', 'a-cliente.pdf', ana
    from unnest(array[v_paga, v_caiu]) d;

  update public.deals set stage_id = pg_temp.etapa('closed') where id in (v_paga, v_caiu);
  update public.deals
     set stage_id = pg_temp.etapa('lost'), lost_reason = '18. QUEDA'
   where id = v_caiu;

  -- O que se prova é a virada, não quem fecha (isso é o bloco 5): fecha
  -- direto, como o cenário inicial.
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  insert into public.game_seasons (label, period_start)
  values ('Temporada 0142 (virada)', current_date);

  update public.deals
     set stage_id = pg_temp.etapa('lost'), lost_reason = '18. QUEDA'
   where id = v_paga;

  perform pg_temp.assert_eq(pg_temp.eventos(v_paga, ana, 'distrato'), 0,
    'perder agora a venda de uma temporada fechada não penaliza (consequência assumida)');

  update public.deals
     set stage_id = pg_temp.etapa('proposal'), lost_reason = null, status_detail = null
   where id in (v_paga, v_caiu);
  update public.deals set stage_id = pg_temp.etapa('closed') where id in (v_paga, v_caiu);

  perform pg_temp.assert_eq(pg_temp.eventos(v_paga, ana, 'venda'), 0,
    'ganhar de novo a venda que já pontuou em temporada fechada não paga outra (antes: +600 duas vezes)');
  perform pg_temp.assert_eq(pg_temp.eventos(v_caiu, ana, 'venda'), 1,
    'a venda que levou o distrato na temporada fechada paga de novo ao ser ganha');

  -- A guarda está em `award_game_points`: o rateio passa por ela também.
  delete from public.deal_participants
   where deal_id = v_paga and profile_id = ana and role = 'broker';
  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_paga, ana, 'broker', 100);

  perform pg_temp.assert_eq(pg_temp.eventos(v_paga, ana, null), 0,
    'sair e voltar ao rateio não paga de novo a venda da temporada fechada');
  perform pg_temp.assert_eq(
    (select sum(points)::int from public.game_events
      where ref_type = 'deal' and ref_id = v_paga and profile_id = ana),
    public.scoring_points(public.current_game_season(), 'venda'),
    'somando todas as temporadas, o negócio rendeu uma venda só');
end
$$;

-- Devolve o estado que os arquivos anteriores deixam: uma temporada aberta
-- desde hoje. A que o fechamento abriu começa amanhã e mudaria o mês-base
-- padrão de quem roda depois na virada do mês.
do $$
begin
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  insert into public.game_seasons (label, period_start)
  values ('Temporada pós-0142', current_date);
end
$$;

\echo 'gamificação (0142) ok'
