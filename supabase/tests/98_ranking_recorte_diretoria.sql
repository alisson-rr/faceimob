-- =============================================================================
-- 98 · O recorte do placar, provado com RLS ligada (migration 0112)
--
-- POR QUE ESTE ARQUIVO EXISTE. Nenhuma asserção provava quem lê o placar de
-- quem. `78_gamificacao.sql` cobre quanto cada evento PONTUA, e roda como
-- `postgres` — dono das tabelas, portanto isento de RLS. Aqui toda leitura
-- acontece depois de `set local role authenticated`, que é o papel com que o
-- PostgREST chega ao banco: sem isso o arquivo passaria com as policies
-- apagadas e com `can_see_game_profile` devolvendo `true`.
--
-- O que cada bloco defende:
--   · DIRETOR lê a diretoria dele e NÃO lê a do outro diretor — no ranking, no
--     congelado e no log de pontos. É a regra do cliente ("diretor vê de todos
--     q ele é diretor") cobrada no banco: antes da 0112 ela existia só no React
--     (`podioDoRanking`) e o placar da casa inteira trafegava até o navegador.
--   · ADMIN e SÓCIO leem tudo (0099: sócio tem a permissão do administrador).
--   · GERENTE lê quem ele lidera; CORRETOR lê a própria equipe ativa. Sem esse
--     lado, uma função que devolvesse só a si mesmo passaria nas de cima.
--   · A VENDA continua legível por toda a casa. É o ramo `event_code = 'venda'`
--     da policy `game_events_select` (0060), de onde o `EngagementLayer` tira a
--     fanfarra por realtime. Está aqui para ser uma DECISÃO visível, e não uma
--     surpresa de quem for ler a policy depois.
--   · Na linha SEMANAL, vendas e VGV ancoram no mesmo fato (0112, parte 2):
--     negócio fechado numa semana e pontuado em outra não pode aparecer como
--     "1 venda, R$ 0". A temporada inteira continua somando por `closed_at`.
--
-- UUIDs na faixa `…-000001120001+`, exclusiva deste arquivo. As contagens são
-- sempre escopadas nos ids do próprio fixture: o harness roda os arquivos no
-- mesmo banco, e um `count(*)` solto mediria o resto da suíte.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check112(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.assert_eq112(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % (obtido %, esperado %)', label, got, want;
  end if;
  raise notice '  ok  %', label;
end;
$$;

/** Assume a identidade de alguém logado, como o PostgREST faria. */
create or replace function pg_temp.become112(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-000001120001';
  socio  uuid := '00000000-0000-0000-0000-000001120002';
  dir_a  uuid := '00000000-0000-0000-0000-000001120003';
  dir_b  uuid := '00000000-0000-0000-0000-000001120004';
  ger_a  uuid := '00000000-0000-0000-0000-000001120005';
  cor_a1 uuid := '00000000-0000-0000-0000-000001120006';
  cor_a2 uuid := '00000000-0000-0000-0000-000001120007';
  cor_b  uuid := '00000000-0000-0000-0000-000001120008';

  team_a uuid := '11200000-0000-0000-0000-000000000001';
  team_b uuid := '11200000-0000-0000-0000-000000000002';

  -- Temporada FECHADA e com limites próprios: assim o recorte semanal não
  -- depende de `current_date` nem da temporada que outro arquivo deixou aberta.
  --   semana 1 = 31/08 (segunda) a 06/09 (domingo)
  --   semana 2 = 07/09 (segunda) a 13/09 (domingo)
  v_season uuid := '11200000-0000-0000-0000-0000000000ff';

  ev_a1_esteira uuid := '11200000-0000-0000-0000-0000000000e1';
  ev_b_esteira  uuid := '11200000-0000-0000-0000-0000000000e2';
  ev_a1_venda   uuid := '11200000-0000-0000-0000-0000000000e3';
  ev_b_venda    uuid := '11200000-0000-0000-0000-0000000000e4';

  -- Id fixo, como o resto do fixture: rodar o arquivo duas vezes no mesmo banco
  -- (`--keep`) não pode criar um segundo negócio e dobrar o VGV da temporada.
  v_deal uuid := '11200000-0000-0000-0000-0000000000d1';

  n_rank   int;
  n_frozen int;
  n_ev     int;
  n_venda  int;
  v_sales  int;
  v_vgv    numeric;
begin
  -- ---------------------------------------------------------------------------
  -- Fixture. Tudo como `postgres`: montar o cenário não é o que está sob teste.
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,    'admin@t112.test', '{"full_name":"Admin T112"}'),
    (socio,  'socio@t112.test', '{"full_name":"Sócio T112"}'),
    (dir_a,  'dira@t112.test',  '{"full_name":"Diretor A T112"}'),
    (dir_b,  'dirb@t112.test',  '{"full_name":"Diretor B T112"}'),
    (ger_a,  'gera@t112.test',  '{"full_name":"Gerente A T112"}'),
    (cor_a1, 'cora1@t112.test', '{"full_name":"Corretor A1 T112"}'),
    (cor_a2, 'cora2@t112.test', '{"full_name":"Corretor A2 T112"}'),
    (cor_b,  'corb@t112.test',  '{"full_name":"Corretor B T112"}')
  on conflict do nothing;

  -- O gatilho de `auth.users` já dá `broker` a todos: é de propósito. Papel é
  -- N:N e o diretor real também carrega o de corretor — é justamente por isso
  -- que o recorte não pode sair do papel de maior precedência na tela.
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (socio, 'partner'),
    (dir_a, 'director'), (dir_b, 'director'),
    (ger_a, 'manager')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id, active) values
    (team_a, 'Equipe A · 0112', 'equipe-a-0112', dir_a, ger_a, true),
    (team_b, 'Equipe B · 0112', 'equipe-b-0112', dir_b, null,  true)
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id) values
    (team_a, cor_a1), (team_a, cor_a2), (team_b, cor_b)
  on conflict do nothing;

  insert into public.game_seasons (id, label, period_start, period_end, closed_at) values
    (v_season, 'Temporada Recorte 0112', date '2026-08-24', date '2026-09-13', now())
  on conflict do nothing;

  -- O negócio nasce GANHO e sem rateio: com `deal_participants` vazio, o gatilho
  -- `deals_award_points` não acha corretor e não pontua nada. É o que permite
  -- gravar o evento de venda com a data que este teste precisa.
  --
  -- A etapa é 'proposal' (a mesma de `78_gamificacao.sql`) porque para o VGV do
  -- ranking só contam `outcome`, `closed_at` e `vgv_net` — a coluna do funil não
  -- entra na conta. O catálogo de etapas vem de `supabase/seed.sql`: sem ele o
  -- insert acharia zero linhas e o erro cairia lá na frente, no rateio.
  if not exists (select 1 from public.pipeline_stages where code = 'proposal') then
    raise exception 'FALHOU: catálogo de etapas ausente — rode com --seed (ou --all)';
  end if;

  insert into public.deals (id, stage_id, vgv_gross, month_base, unit,
                            document_review_status, outcome, closed_at)
  select v_deal, id, 500000, date '2026-09-01', 'T0112-A', 'approved', 'won',
         timestamptz '2026-09-08 15:00-03'   -- fechamento na SEMANA 2
  from public.pipeline_stages where code = 'proposal'
  on conflict (id) do nothing;

  insert into public.game_events (id, season_id, profile_id, event_code, points,
                                  ref_type, ref_id, occurred_at) values
    (ev_a1_esteira, v_season, cor_a1, 'esteira',  10, null, null,
     timestamptz '2026-09-02 10:00-03'),
    (ev_b_esteira,  v_season, cor_b,  'esteira',  10, null, null,
     timestamptz '2026-09-02 10:00-03'),
    -- O par do defeito: a venda PONTUOU na semana 1, o negócio FECHOU na 2.
    -- Acontece sempre que o fechamento é lançado dias depois, ou quando o
    -- corretor entra no rateio de um negócio já ganho.
    (ev_a1_venda,   v_season, cor_a1, 'venda',   600, 'deal', v_deal,
     timestamptz '2026-09-02 16:00-03'),
    -- Venda sem negócio: é o ponto lançado à mão pelo admin. Serve ao bloco da
    -- fanfarra e é o único caso em que "1 venda, R$ 0" continua correto.
    (ev_b_venda,    v_season, cor_b,  'venda',   600, null, null,
     timestamptz '2026-09-02 16:00-03')
  on conflict do nothing;

  -- O rateio entra por último: o gatilho pontua na temporada ABERTA (esta está
  -- fechada), então ele não interfere no cenário acima.
  insert into public.deal_participants (deal_id, profile_id, role, share_pct)
  values (v_deal, cor_a1, 'broker', 100)
  on conflict do nothing;

  insert into public.game_season_results (season_id, profile_id, rank, points) values
    (v_season, cor_a1, 1, 610),
    (v_season, cor_a2, 2, 0),
    (v_season, cor_b,  3, 610)
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- 1. DIRETOR A: a diretoria dele, e só ela.
  --    Antes da 0112 este bloco devolvia 3, 3 e 2 — a casa inteira.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(dir_a);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_frozen from public.game_season_results
   where season_id = v_season and profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_ev from public.game_events
   where id in (ev_a1_esteira, ev_b_esteira);
  select count(*) into n_venda from public.game_events
   where id in (ev_a1_venda, ev_b_venda);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 2, 'diretor A vê no ranking os 2 corretores das equipes que dirige');
  perform pg_temp.assert_eq112(n_frozen, 2, 'diretor A lê o congelado da diretoria dele, não o da casa');
  perform pg_temp.assert_eq112(n_ev, 1, 'diretor A NÃO lê o log de pontos de corretor de outro diretor');
  perform pg_temp.assert_eq112(n_venda, 2,
    'a VENDA segue legível por toda a casa (ramo event_code = venda da 0060, é dela que sai a fanfarra)');

  -- ---------------------------------------------------------------------------
  -- 2. DIRETOR B: o espelho. Sem ele, uma função que devolvesse "todo mundo
  --    menos ninguém" passaria no bloco 1.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(dir_b);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_frozen from public.game_season_results
   where season_id = v_season and profile_id in (cor_a1, cor_a2);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 1, 'diretor B vê só o corretor da equipe que ele dirige');
  perform pg_temp.assert_eq112(n_frozen, 0, 'diretor B NÃO lê o congelado da diretoria do diretor A');

  -- ---------------------------------------------------------------------------
  -- 3. ADMIN e SÓCIO: a casa inteira. O sócio também carrega `broker` (é assim
  --    no banco real), então quem abre a porta aqui é o papel `partner`.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(adm);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_frozen from public.game_season_results
   where season_id = v_season and profile_id in (cor_a1, cor_a2, cor_b);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 3, 'admin vê o ranking da casa');
  perform pg_temp.assert_eq112(n_frozen, 3, 'admin lê o congelado da casa');

  perform pg_temp.become112(socio);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_frozen from public.game_season_results
   where season_id = v_season and profile_id in (cor_a1, cor_a2, cor_b);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 3, 'sócio vê o ranking da casa, como o administrador (0099)');
  perform pg_temp.assert_eq112(n_frozen, 3, 'sócio lê o congelado da casa');

  -- ---------------------------------------------------------------------------
  -- 4. GERENTE da equipe A: quem ele lidera.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(ger_a);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_ev from public.game_events
   where id in (ev_a1_esteira, ev_b_esteira);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 2, 'gerente vê os 2 corretores da equipe dele');
  perform pg_temp.assert_eq112(n_ev, 1, 'gerente NÃO lê o log de pontos de outra equipe');

  -- ---------------------------------------------------------------------------
  -- 5. CORRETOR A1: a equipe ativa dele — é o que o Painel mostra em
  --    "Destaques" (print do cliente, 10/09/2026). O card do Pipeline mostra a
  --    própria colocação: desenho da tela, mesmo dado.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(cor_a1);
  set local role authenticated;
  select count(*) into n_rank from public.visible_game_ranking(v_season) r
   where r.profile_id in (cor_a1, cor_a2, cor_b);
  select count(*) into n_frozen from public.game_season_results
   where season_id = v_season and profile_id = cor_b;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(n_rank, 2, 'corretor vê a equipe ativa dele (ele e o colega)');
  perform pg_temp.assert_eq112(n_frozen, 0, 'corretor NÃO lê o congelado de quem não é da equipe dele');

  -- ---------------------------------------------------------------------------
  -- 6. A âncora da semana: vendas e VGV contam o MESMO fato.
  --
  --    O negócio fechou em 08/09 (semana 2) e pontuou em 02/09 (semana 1).
  --    Antes da 0112 a semana 1 mostrava "1 venda, R$ 0" e a semana 2 mostrava
  --    "0 venda, R$ 500.000" — a mesma venda, partida em duas linhas.
  --    Como admin, para isolar a âncora do recorte por papel.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become112(adm);
  set local role authenticated;
  select r.sales, r.vgv into v_sales, v_vgv
    from public.visible_game_ranking(v_season, date '2026-08-31', date '2026-09-06') r
   where r.profile_id = cor_a1;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(v_sales, 1, 'semana 1: a venda pontuada nela é contada');
  perform pg_temp.assert_eq112(v_vgv, 500000::numeric, 'semana 1: o VGV acompanha a venda que pontuou nela');

  perform pg_temp.become112(adm);
  set local role authenticated;
  select r.sales, r.vgv into v_sales, v_vgv
    from public.visible_game_ranking(v_season, date '2026-09-07', date '2026-09-13') r
   where r.profile_id = cor_a1;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(v_sales, 0, 'semana 2: nenhuma venda pontuou nela');
  perform pg_temp.assert_eq112(v_vgv, 0::numeric,
    'semana 2: o VGV não aparece sozinho só porque o fechamento caiu aqui');

  -- A temporada inteira continua somando por `closed_at`: a 0112 não reescreve
  -- VGV de temporada já fechada.
  perform pg_temp.become112(adm);
  set local role authenticated;
  select r.sales, r.vgv into v_sales, v_vgv
    from public.visible_game_ranking(v_season) r
   where r.profile_id = cor_a1;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq112(v_sales, 1, 'temporada: a venda continua contada');
  perform pg_temp.assert_eq112(v_vgv, 500000::numeric, 'temporada: o VGV do negócio fechado no período continua somado');
end
$$;

\echo '== 98 · recorte do placar: ok =='
