-- =============================================================================
-- Regressão da 0060 — a gamificação pontua o que o produto realmente faz, e o
-- log de pontos deixa de ser público.
--
-- O inventário de 02/09 achou duas regras de pontuação que a tela exibia e o
-- banco nunca emitia (`distrato` e `incompleto_com_doc`), o negócio que nasce
-- ganho sem pontuar, e SELECT `using (true)` em `game_events` e
-- `game_season_results` — a SDR, que nem tem `menu.gamification`, lia 96 linhas
-- do log de pontos da casa inteira.
--
-- Nada aqui usa `award_game_points` direto: o que precisa de prova é o GATILHO,
-- e chamar a função à mão contornaria exatamente o que falhava.
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

-- -----------------------------------------------------------------------------
-- Estado conhecido
--
-- Os testes anteriores deixam temporada aberta (16), mês travado (16) e eventos
-- de jogo para Bruno, Bia e Caio (11). Por isso nenhuma asserção abaixo compara
-- total: todas contam os eventos DESTE cenário, pelo `ref_id` dos negócios que
-- ele cria.
--
-- Os UUIDs saem da faixa `…-000000600000`, exclusiva deste arquivo. A faixa
-- `…-0000000000fN` do harness JÁ está ocupada: `…f1` é o Pedro Sócio do 01 e o
-- `adm` de onze blocos do 11. Reusá-la fazia o `on conflict do nothing` virar
-- no-op (o "corretor sem histórico" era o sócio) e, pior, o `grant broker`
-- mutava um usuário compartilhado para todos os arquivos seguintes.
-- -----------------------------------------------------------------------------
do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000600001';
  v_mes   date := public.month_start((current_date + interval '8 months')::date);
begin
  -- Corretor sem equipe e sem histórico: o VGV congelado dele é medível, o dos
  -- corretores do 01 já carrega negócio de outros testes.
  insert into auth.users (id, email, raw_user_meta_data) values
    (jogador, 'jogador@game0060.test', '{"full_name":"Jogador Zero Sessenta"}'),
    ('00000000-0000-0000-0000-000000600000', 'admin@game0060.test', '{"full_name":"Admin Zero Sessenta"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (jogador, 'broker'),
    ('00000000-0000-0000-0000-000000600000', 'admin')
  on conflict do nothing;

  -- Temporada única e aberta hoje: `game_seasons_one_open` só admite uma.
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  insert into public.game_seasons (label, period_start)
  values ('Temporada 0060', current_date);

  -- O mês-base do cenário está no futuro; `deals_guard_closed_month` recusaria
  -- o insert se algum teste anterior o tivesse travado.
  delete from public.closed_months where period = v_mes;
end
$$;

\echo '== 1. incompleto_com_doc: a regra que nunca disparava =='

do $$
declare
  bruno   uuid := '00000000-0000-0000-0000-0000000000b1';
  v_mes   date := public.month_start((current_date + interval '8 months')::date);
  v_deal  uuid;
  v_tipo  uuid;
begin
  select id into v_tipo from public.document_types where active order by sort_order limit 1;

  -- `unit` marca a linha: outro teste pode ter deixado negócio incompleto do
  -- Bruno, e "o mais recente" é frágil demais para o bloco seguinte reencontrar.
  --
  -- SEM `created_by`: `deals_add_creator_participant` (0048) já grava
  -- `(negócio, autor, papel efetivo)` no AFTER INSERT do negócio, então passar
  -- o Bruno aqui fazia o insert explícito abaixo violar
  -- `deal_participants_deal_id_profile_id_role_key` e derrubar o arquivo
  -- inteiro pelo `ON_ERROR_STOP`. É o mesmo desenho do 58_pipeline_rateio.
  insert into public.deals (stage_id, vgv_gross, month_base, unit)
  select id, 400000, v_mes, 'G0060-A' from public.pipeline_stages where code = 'incomplete'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, bruno, 'broker', 100);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'incompleto_com_doc'),
    0, 'negócio incompleto SEM documento não pontua');

  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal, v_tipo, 'game0060/' || v_deal || '/a.pdf', 'a.pdf', 'a-cliente.pdf', bruno);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'incompleto_com_doc' and profile_id = bruno),
    1, 'documento em negócio incompleto pontua o corretor do rateio');

  -- Idempotência: o peso é do NEGÓCIO com documento, não de cada arquivo.
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal, v_tipo, 'game0060/' || v_deal || '/b.pdf', 'b.pdf', 'b-cliente.pdf', bruno);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'incompleto_com_doc'),
    1, 'o segundo documento do mesmo negócio não pontua de novo');

  -- O evento vale o peso da regra vigente, não um número embutido no gatilho.
  perform pg_temp.assert_eq(
    (select points from public.game_events
      where ref_id = v_deal and event_code = 'incompleto_com_doc' limit 1),
    public.scoring_points(public.current_game_season(), 'incompleto_com_doc'),
    'o evento vale o peso de game_scoring_rules');
end
$$;

\echo '== 2. venda e distrato pelo caminho que a tela usa =='

do $$
declare
  bruno  uuid := '00000000-0000-0000-0000-0000000000b1';
  v_deal uuid;
begin
  select d.id into v_deal from public.deals d where d.unit = 'G0060-A'
   order by d.created_at desc limit 1;
  perform pg_temp.assert_eq(v_deal is not null, true, 'o negócio do bloco 1 foi reencontrado');

  -- A conferência documental ANTES da etapa: `deals_guard_stage` (0028) recusa
  -- a entrada em under_analysis/approved/contract/closed enquanto
  -- `document_review_status` não for 'approved', e a checagem não olha
  -- `auth.uid()` — como superusuário o arquivo inteiro morria aqui, e os blocos
  -- 3 a 7 nunca rodavam. `deals_guard_document_review` libera `postgres`; é o
  -- mesmo desenho de `e2e/broker/etapas.spec.ts`.
  update public.deals set document_review_status = 'approved' where id = v_deal;

  -- Fechado: é o `stage_id` que a tela grava; o outcome sai do estágio.
  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = 'closed')
   where id = v_deal;

  perform pg_temp.assert_eq(
    (select outcome::text from public.deals where id = v_deal), 'won',
    'mover para "Fechado" põe o negócio em outcome=won');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'venda' and profile_id = bruno),
    1, 'a venda pontua o corretor do rateio');

  -- Distrato pelo caminho REAL: o diálogo de perda grava a etapa `lost` com o
  -- motivo. O gatilho antigo exigia outcome='cancelled', que nenhum estágio
  -- produz — a penalidade de -600 nunca entrava.
  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = 'lost'),
         status_detail = '17. DISTRATO',
         lost_reason = '17. DISTRATO — cliente desistiu'
   where id = v_deal;

  perform pg_temp.assert_eq(
    (select outcome::text from public.deals where id = v_deal), 'lost',
    'o diálogo de perda deixa o negócio em outcome=lost, não cancelled');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'distrato' and profile_id = bruno),
    1, 'perder um negócio GANHO dispara a penalidade de distrato');

  -- Decisão de 03/09: a penalidade não estorna a venda. Anular o +600
  -- reescreveria um ranking que o corretor já viu.
  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'venda'),
    1, 'a venda continua valendo — distrato é penalidade, não estorno');

  perform pg_temp.assert_eq(
    (select points < 0 from public.game_events
      where ref_id = v_deal and event_code = 'distrato' limit 1),
    true, 'o evento de distrato tem peso negativo');
end
$$;

\echo '== 3. negócio que perde SEM ter sido ganho não é distrato =='

do $$
declare
  bruno  uuid := '00000000-0000-0000-0000-0000000000b1';
  v_mes  date := public.month_start((current_date + interval '8 months')::date);
  v_deal uuid;
begin
  -- Sem `created_by`, pelo mesmo motivo do bloco 1.
  insert into public.deals (stage_id, vgv_gross, month_base)
  select id, 300000, v_mes from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, bruno, 'broker', 100);

  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = 'lost'),
         lost_reason = '18. QUEDA'
   where id = v_deal;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events where ref_id = v_deal),
    0, 'proposta perdida sem venda anterior não pontua nem penaliza');
end
$$;

\echo '== 4. negócio que nasce ganho pontua quando o rateio entra =='

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000600001';
  v_mes   date := public.month_start((current_date + interval '8 months')::date);
  v_deal  uuid;
begin
  -- Importação de planilha e carga inicial gravam o negócio já em `won`. O
  -- gatilho era AFTER UPDATE: essa venda nunca pontuava. E o gatilho de INSERT
  -- sozinho também não bastaria — o rateio é escrito DEPOIS do negócio, então
  -- no INSERT ainda não há corretor nenhum para pontuar.
  --
  -- Sem `created_by`: com ele, `deals_add_creator_participant` põe o autor no
  -- rateio JÁ no insert do negócio, e o assert seguinte ("no INSERT ainda não
  -- há rateio") passaria a medir o gatilho errado.
  insert into public.deals (stage_id, outcome, closed_at, vgv_gross, month_base)
  select id, 'won', now(), 100000, v_mes
  from public.pipeline_stages where code = 'closed'
  returning id into v_deal;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events where ref_id = v_deal),
    0, 'no INSERT ainda não há rateio: ninguém a pontuar');

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'venda' and profile_id = jogador),
    1, 'o corretor que entra no rateio de um negócio JÁ ganho pontua a venda');
end
$$;

\echo '== 5. o log de pontos não é mais público =='

do $$
declare
  bruno uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  -- Congelado à mão: o `close_game_season` do bloco 6 congela a temporada
  -- corrente, e o que se cobra aqui é a policy, não o fechamento.
  insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv)
  values (public.current_game_season(), bruno, 1, 999, 1, 123456)
  on conflict (season_id, profile_id) do update set points = 999;
end
$$;

set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');   -- Caio, equipe B

-- A venda continua pública dentro da casa: é ela que toca a fanfarra na loja
-- inteira (ata de 14/07), e o realtime do EngagementLayer respeita RLS.
select pg_temp.assert_eq(
  (select count(*)::int > 0 from public.game_events
    where profile_id = '00000000-0000-0000-0000-0000000000b1' and event_code = 'venda'),
  true, 'a venda de outra equipe continua legível — é o que toca o som');

-- O resto do log, não. Era `using (true)`: qualquer autenticado lia tudo.
select pg_temp.assert_eq(
  (select count(*)::int from public.game_events
    where profile_id = '00000000-0000-0000-0000-0000000000b1' and event_code <> 'venda'),
  0, 'corretor de outra equipe não lê o restante do log de pontos');

select pg_temp.assert_eq(
  (select count(*)::int from public.game_season_results
    where profile_id = '00000000-0000-0000-0000-0000000000b1'),
  0, 'corretor de outra equipe não lê o ranking congelado alheio');

select pg_temp.become('00000000-0000-0000-0000-0000000000b1');   -- o próprio

select pg_temp.assert_eq(
  (select count(*)::int > 0 from public.game_events
    where profile_id = '00000000-0000-0000-0000-0000000000b1' and event_code <> 'venda'),
  true, 'o corretor continua lendo o próprio log');

select pg_temp.assert_eq(
  (select count(*)::int from public.game_season_results
    where profile_id = '00000000-0000-0000-0000-0000000000b1'),
  1, 'o corretor continua lendo o próprio ranking congelado');

select pg_temp.become('00000000-0000-0000-0000-000000600000');   -- admin do cenário

select pg_temp.assert_eq(
  (select count(*)::int from public.game_season_results
    where profile_id = '00000000-0000-0000-0000-0000000000b1'),
  1, 'o administrador continua lendo o ranking congelado de todos');

reset role;
select set_config('request.jwt.claims', '', false);

\echo '== 6. o VGV congelado não passa do fim do período =='

do $$
declare
  adm     uuid := '00000000-0000-0000-0000-000000600000';
  jogador uuid := '00000000-0000-0000-0000-000000600001';
  v_mes   date := public.month_start((current_date + interval '8 months')::date);
  v_deal  uuid;
  v_season uuid := public.current_game_season();
  v_vgv   numeric;
begin
  -- Venda fechada DEPOIS do fim do período. `close_game_season` só filtrava
  -- `closed_at >= period_start`: uma temporada fechada com atraso absorvia no
  -- VGV congelado negócio que não é dela — e o congelamento é irreversível.
  -- Sem `created_by`, pelo mesmo motivo do bloco 1.
  insert into public.deals (stage_id, outcome, closed_at, vgv_gross, month_base)
  select id, 'won', (current_date + 40)::timestamptz, 900000, v_mes
  from public.pipeline_stages where code = 'closed'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  perform pg_temp.become(adm);
  perform public.close_game_season('Temporada pós-0060');
  perform set_config('request.jwt.claims', '', false);

  select vgv into v_vgv from public.game_season_results
   where season_id = v_season and profile_id = jogador;

  perform pg_temp.assert_eq(v_vgv, 100000.00::numeric,
    'o VGV congelado conta só a venda dentro do período (a de +40 dias fica fora)');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_seasons where closed_at is null),
    1, 'o fechamento abriu exatamente a próxima temporada');

  perform pg_temp.assert_eq(
    (select period_end is not null from public.game_seasons where id = v_season),
    true, 'a temporada fechada guarda o fim do período');
end
$$;

\echo '== 7. sair do rateio devolve o ponto da venda, e o rastro fica =='

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000600001';
  v_mes   date := public.month_start((current_date + interval '8 months')::date);
  v_deal  uuid;
begin
  -- O editor de negócio troca rateio por upsert seguido de delete
  -- (`saveLegacyDeal`). Sem contrapartida no DELETE, corrigir um erro de
  -- digitação no rateio de um negócio JÁ ganho somava +600 ao corretor novo e
  -- deixava os +600 do removido gravados para sempre: o total da temporada
  -- inflava a cada correção, e pontos decidem o pódio.
  --
  -- `unit` marca a linha porque o DELETE abaixo acontece FORA do bloco: ele
  -- roda como o corretor, e `set role` não vale dentro de um `do`.
  insert into public.deals (stage_id, outcome, closed_at, vgv_gross, month_base, unit)
  select id, 'won', now(), 250000, v_mes, 'G0060-B'
  from public.pipeline_stages where code = 'closed'
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, jogador, 'broker', 100);

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'venda' and profile_id = jogador),
    1, 'entrar no rateio de um negócio ganho pontua a venda');
end
$$;

-- O DELETE é do CORRETOR, não do superusuário.
--
-- Como `postgres` o bloco provava o gatilho e nada sobre permissão: escrever em
-- `game_events` é de admin (`game_events_write`), e quem apaga a linha do rateio
-- é qualquer um que `deal_participants_write` autoriza. O gatilho é SECURITY
-- DEFINER de propósito — o ponto acompanha o rateio, e quem mexe no rateio já
-- move a comissão do colega, que pesa muito mais do que 600 pontos. O que
-- faltava era o rastro; ele é cobrado logo abaixo.
set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-000000600001');

delete from public.deal_participants
 where deal_id = (select id from public.deals where unit = 'G0060-B' order by created_at desc limit 1)
   and profile_id = '00000000-0000-0000-0000-000000600001'
   and role = 'broker';

reset role;
select set_config('request.jwt.claims', '', false);

do $$
declare
  jogador uuid := '00000000-0000-0000-0000-000000600001';
  v_deal  uuid;
begin
  select id into v_deal from public.deals where unit = 'G0060-B' order by created_at desc limit 1;

  perform pg_temp.assert_eq(
    (select count(*)::int from public.game_events
      where ref_id = v_deal and event_code = 'venda' and profile_id = jogador),
    0, 'o corretor sai do rateio e o ponto da entrada sai junto, sob RLS');

  -- Apagar linha de log sem rastro era o buraco: o prejudicado não tem como
  -- saber que os +600 sumiram, nem quem os tirou. `deal_history` é o log
  -- imutável do negócio e nomeia o autor.
  perform pg_temp.assert_eq(
    (select count(*)::int from public.deal_history
      where deal_id = v_deal and kind = 'game_points_revoked' and actor_id = jogador),
    1, 'a retirada do ponto fica no histórico do negócio, com o autor');
end
$$;

\echo 'gamificação (0060) ok'
