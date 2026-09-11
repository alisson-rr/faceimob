-- =============================================================================
-- 97 · Hierarquia do diário, provada com RLS ligada (migration 0109)
--
-- POR QUE ESTE ARQUIVO EXISTE. Nenhuma asserção do repositório provava a
-- visibilidade do diário. `80_diario.sql` troca `request.jwt.claims` mas
-- continua rodando como `postgres` — dono das tabelas, portanto ISENTO de RLS.
-- Isso prova o que as RPCs SECURITY DEFINER gravam (que é o assunto de lá) e
-- NADA sobre quem lê o quê. Aqui toda leitura acontece depois de
-- `set local role authenticated`, que é o papel com que o PostgREST chega ao
-- banco — sem isso, o teste passaria com as policies apagadas.
--
-- O que cada asserção defende:
--   · GERENTE não lê equipe que não é dele — nem o cabeçalho, nem as linhas.
--   · GERENTE não lê a linha de um corretor DELE quando ela pende do relatório
--     de OUTRA equipe (corretor que trocou de equipe). Era o último caminho
--     cross-team que sobrava, por `auth_visible_profiles()` recortar PESSOA
--     enquanto a linha pende de EQUIPE.
--   · DIRETOR lê as equipes que dirige e NÃO lê as de outro diretor. É a regra
--     do cliente ("o diretor vê só o dele e o dos gerentes dele") cobrada no
--     banco: antes da 0109 ela existia só no React, e o dado da casa inteira
--     trafegava até o navegador dele.
--   · ADMIN e SÓCIO leem tudo (0099: sócio tem a permissão do administrador).
--   · CORRETOR lê o cabeçalho da própria equipe e SÓ a própria linha — nem a do
--     colega da mesma equipe. Sem esse lado, uma policy que devolvesse tudo
--     para todo mundo passaria nas asserções acima.
--   · O diário PÚBLICO com PIN continua funcionando: as RPCs do Diário são
--     SECURITY DEFINER e não podem ter sido alcançadas pelo estreitamento. São
--     DUAS desde a 0103, que tirou `public_director_checkpoint` de `anon`.
--
-- UUIDs na faixa `…-000001090001+`, exclusiva deste arquivo. As contagens são
-- sempre escopadas nos ids do próprio fixture: o harness roda os arquivos no
-- mesmo banco, e um `count(*)` solto mediria o resto da suíte.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check109(cond boolean, label text)
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

create or replace function pg_temp.assert_eq109(got anyelement, want anyelement, label text)
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
create or replace function pg_temp.become109(user_id uuid)
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
  adm    uuid := '00000000-0000-0000-0000-000001090001';
  socio  uuid := '00000000-0000-0000-0000-000001090002';
  dir_a  uuid := '00000000-0000-0000-0000-000001090003';
  dir_b  uuid := '00000000-0000-0000-0000-000001090004';
  ger_a  uuid := '00000000-0000-0000-0000-000001090005';
  ger_b  uuid := '00000000-0000-0000-0000-000001090006';
  cor_a  uuid := '00000000-0000-0000-0000-000001090007';
  cor_a2 uuid := '00000000-0000-0000-0000-000001090008';
  cor_b  uuid := '00000000-0000-0000-0000-000001090009';

  team_a1 uuid := '10900000-0000-0000-0000-000000000001';
  team_a2 uuid := '10900000-0000-0000-0000-000000000002';
  team_b1 uuid := '10900000-0000-0000-0000-000000000003';

  rep_a1 uuid := '10900000-0000-0000-0000-00000000000a';
  rep_a2 uuid := '10900000-0000-0000-0000-00000000000b';
  rep_b1 uuid := '10900000-0000-0000-0000-00000000000c';

  -- Linhas nomeadas: cada asserção diz QUAL linha o papel lê, não só quantas.
  ent_a1_cor_a  uuid := '10900000-0000-0000-0000-0000000000a1';
  ent_a1_cor_a2 uuid := '10900000-0000-0000-0000-0000000000a2';
  ent_b1_cor_b  uuid := '10900000-0000-0000-0000-0000000000b1';
  -- A linha do problema: é do corretor de A1, mas pende do relatório de B1.
  ent_b1_cor_a  uuid := '10900000-0000-0000-0000-0000000000b2';

  v_dia  date := current_date - 5;
  v_slug text;
  v_out  jsonb;
  n_rep  int;
  n_ent  int;
begin
  -- ---------------------------------------------------------------------------
  -- Fixture. Tudo como `postgres`: montar o cenário não é o que está sob teste.
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,    'admin@t109.test', '{"full_name":"Admin T109"}'),
    (socio,  'socio@t109.test', '{"full_name":"Sócio T109"}'),
    (dir_a,  'dira@t109.test',  '{"full_name":"Diretor A T109"}'),
    (dir_b,  'dirb@t109.test',  '{"full_name":"Diretor B T109"}'),
    (ger_a,  'gera@t109.test',  '{"full_name":"Gerente A1 T109"}'),
    (ger_b,  'gerb@t109.test',  '{"full_name":"Gerente B1 T109"}'),
    (cor_a,  'cora@t109.test',  '{"full_name":"Corretor A1 T109"}'),
    (cor_a2, 'cora2@t109.test', '{"full_name":"Corretor A1 bis T109"}'),
    (cor_b,  'corb@t109.test',  '{"full_name":"Corretor B1 T109"}')
  on conflict do nothing;

  -- O gatilho de `auth.users` já dá `broker` a todos: é de propósito. Papel é
  -- N:N e o diretor real também carrega o de corretor.
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (socio, 'partner'),
    (dir_a, 'director'), (dir_b, 'director'),
    (ger_a, 'manager'), (ger_b, 'manager')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id, active) values
    (team_a1, 'Equipe A1 · 0109', 'equipe-a1-0109', dir_a, ger_a, true),
    (team_a2, 'Equipe A2 · 0109', 'equipe-a2-0109', dir_a, null,  true),
    (team_b1, 'Equipe B1 · 0109', 'equipe-b1-0109', dir_b, ger_b, true)
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id, joined_at, left_at) values
    (team_a1, cor_a,  v_dia - 30, null),
    (team_a1, cor_a2, v_dia - 30, null),
    (team_b1, cor_b,  v_dia - 30, null),
    -- Corretor que veio de B1 para A1: o histórico dele fica em B1.
    (team_b1, cor_a,  v_dia - 90, v_dia - 31)
  on conflict do nothing;

  insert into public.daily_reports (id, team_id, report_date, submitted_at) values
    (rep_a1, team_a1, v_dia, now()),
    (rep_a2, team_a2, v_dia, now()),
    (rep_b1, team_b1, v_dia, now())
  on conflict do nothing;

  insert into public.daily_entries (id, report_id, profile_id, leads) values
    (ent_a1_cor_a,  rep_a1, cor_a,  7),
    (ent_a1_cor_a2, rep_a1, cor_a2, 5),
    (ent_b1_cor_b,  rep_b1, cor_b,  3),
    (ent_b1_cor_a,  rep_b1, cor_a,  9)
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- 1. GERENTE de A1: a equipe dele, e só ela.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become109(ger_a);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 1, 'gerente lê 1 relatório: só o da equipe dele');
  perform pg_temp.assert_eq109(n_ent, 2, 'gerente lê as 2 linhas do relatório dele e nada mais');

  perform pg_temp.become109(ger_a);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports where id = rep_b1;
  select count(*) into n_ent from public.daily_entries where id = ent_b1_cor_a;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 0, 'gerente NÃO lê o relatório de outra equipe');
  perform pg_temp.assert_eq109(n_ent, 0,
    'gerente NÃO lê a linha do corretor DELE quando ela pende do relatório de outra equipe');

  -- ---------------------------------------------------------------------------
  -- 2. DIRETOR A: as equipes que ele dirige, e não as do diretor B.
  --    É a regra do cliente. Antes da 0109 este bloco devolvia 3 e 4.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become109(dir_a);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 2, 'diretor lê os relatórios das 2 equipes que dirige');
  perform pg_temp.assert_eq109(n_ent, 2, 'e as linhas delas — nenhuma do outro diretor');

  perform pg_temp.become109(dir_b);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 1, 'o outro diretor lê só o relatório da equipe dele');
  perform pg_temp.assert_eq109(n_ent, 2,
    'e as 2 linhas do relatório dele, inclusive a do corretor que saiu da equipe');

  -- ---------------------------------------------------------------------------
  -- 3. ADMIN e SÓCIO leem tudo. O sócio junto do admin é a decisão de
  --    10/09/2026 (0099) — sem este par, "estreitou demais" passaria batido.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become109(adm);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 3, 'admin lê os relatórios das 3 equipes');
  perform pg_temp.assert_eq109(n_ent, 4, 'admin lê as 4 linhas');

  perform pg_temp.become109(socio);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 3, 'sócio lê os relatórios das 3 equipes, como o admin');
  perform pg_temp.assert_eq109(n_ent, 4, 'sócio lê as 4 linhas, como o admin');

  -- ---------------------------------------------------------------------------
  -- 4. CORRETOR: o cabeçalho da própria equipe e SÓ a própria linha.
  --    A linha dele em B1 é dele — número próprio não vira segredo por o
  --    corretor ter trocado de equipe. A do COLEGA de A1 não é.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become109(cor_a);
  set local role authenticated;
  select count(*) into n_rep from public.daily_reports
   where id in (rep_a1, rep_a2, rep_b1);
  select count(*) into n_ent from public.daily_entries
   where id in (ent_a1_cor_a, ent_a1_cor_a2, ent_b1_cor_b, ent_b1_cor_a);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_rep, 1,
    'corretor lê o cabeçalho da equipe de que é membro, e só ele');
  perform pg_temp.assert_eq109(n_ent, 2,
    'corretor lê só as próprias linhas — nem a do colega da mesma equipe');

  perform pg_temp.become109(cor_a);
  set local role authenticated;
  select count(*) into n_ent from public.daily_entries where id = ent_a1_cor_a2;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq109(n_ent, 0, 'a linha do colega de equipe é invisível ao corretor');

  -- ---------------------------------------------------------------------------
  -- 5. O diário PÚBLICO com PIN não pode ter sido alcançado pelo estreitamento:
  --    as RPCs são SECURITY DEFINER e não passam por RLS. Chamadas como `anon`,
  --    que é o papel real de quem abre /daily/:slug. A terceira RPC saiu dessa
  --    superfície na 0103 e é cobrada logo abaixo, pelo outro lado.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become109(adm);
  v_slug := public.create_public_link('daily_team', '135790', team_a1, null) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  set local role anon;
  v_out := public.public_daily_team(v_slug, '135790');
  reset role;

  perform pg_temp.check109(v_out ->> 'team_name' = 'Equipe A1 · 0109',
    'o diário público com PIN continua abrindo a equipe para o anônimo');
  perform pg_temp.check109(jsonb_array_length(v_out -> 'roster') >= 2,
    'e continua trazendo a escala da equipe');

  set local role anon;
  v_out := public.public_daily_submit(
    v_slug, '135790',
    jsonb_build_array(jsonb_build_object('profile_id', cor_a::text, 'leads', 4)),
    null, 'Gerente T109', current_date);
  reset role;

  perform pg_temp.assert_eq109((v_out ->> 'saved')::int, 1,
    'e o anônimo continua conseguindo lançar o diário do dia');

  perform pg_temp.become109(adm);
  v_slug := public.create_public_link('director_checkpoint', '246800', null, dir_a) ->> 'slug';
  perform set_config('request.jwt.claims', '', false);

  -- O checkpoint da diretoria SAIU da superfície anônima na 0103: virou tela
  -- logada (/checkpoint, com recorte por hierarquia) e `anon` perdeu o EXECUTE.
  -- Continua chamável por `authenticated`, e é assim que a tela o usa.
  begin
    set local role anon;
    v_out := public.public_director_checkpoint(v_slug, null, '246800');
    reset role;
    perform pg_temp.check109(false,
      'public_director_checkpoint segue fora do alcance do anônimo (0103)');
  exception when insufficient_privilege then
    reset role;
    perform pg_temp.check109(true,
      'public_director_checkpoint segue fora do alcance do anônimo (0103)');
  end;

  perform pg_temp.become109(dir_a);
  set local role authenticated;
  v_out := public.public_director_checkpoint(v_slug, null, '246800');
  reset role;

  perform pg_temp.assert_eq109(jsonb_array_length(v_out -> 'teams'), 2,
    'o checkpoint do diretor continua agregando as 2 equipes dele');

  raise notice 'OK 97_diario_hierarquia';
end;
$$;
