-- =============================================================================
-- 96 · Pré-requisitos da importação Bubble (migration 0096).
--
-- O que cada asserção defende:
--   · a PK de `import_bubble_map` é TRIPLA. O mesmo `bubble_id` de `pipelines`
--     vira linha em `deals` E em `cca_cases`; uma PK de duas colunas recusaria
--     o segundo destino e a carga pararia no meio (R-01). O teste grava os dois
--     destinos e cobra que os dois sobrevivam.
--   · a mesma tripla gravada duas vezes é absorvida por `on conflict do
--     nothing` — é o que torna a carga reexecutável.
--   · a tabela tem RLS ligada, com policy, e só admin lê ou grava. O de-para
--     decide de quem é cada negócio importado: um corretor que apontasse
--     `registro_id` para o próprio perfil se atribuiria o histórico do legado
--     na reexecução seguinte. `anon` não tem nem o grant.
--   · `authenticated` mantém SELECT e INSERT no grant — é o que
--     `06_anon_surface.sql` cobra de toda tabela de `public`; fechar demais
--     aqui quebraria aquele teste em outro arquivo.
--   · `team_members_import_key` cobre o vínculo ENCERRADO. O unique da 0002 é
--     parcial (`where left_at is null`), então antes da 0096 duas linhas
--     idênticas de vínculo fechado entravam as duas, sem erro e sem log (R-05).
--   · existe estágio de CCA com desfecho `cancelled`, achável pela mesma
--     consulta que a esteira usa (`status` + `active` + `order by position`).
--     Sem ele os 290 casos de DISTRATO/QUEDA caem no fallback da tela e
--     aparecem como "Pendência de Documentos" (N-19).
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check96(cond boolean, label text)
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

create or replace function pg_temp.assert_eq96(got anyelement, want anyelement, label text)
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

\echo '== forma da tabela de de-para (R-01) =='

do $$
declare
  cols text;
  n    int;
begin
  -- A PK, coluna a coluna e na ordem. Um "conserto" futuro que a reduza a
  -- (entidade, bubble_id) tem de quebrar aqui, não no meio da carga.
  select string_agg(a.attname, ',' order by k.ord)
    into cols
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.import_bubble_map'::regclass
    and c.contype = 'p';

  perform pg_temp.assert_eq96(cols, 'entidade,bubble_id,tabela_destino',
    'a PK de import_bubble_map é (entidade, bubble_id, tabela_destino)');

  perform pg_temp.check96(
    exists (select 1 from pg_indexes
             where schemaname = 'public' and indexname = 'import_bubble_map_alvo_idx'),
    'índice da consulta inversa (tabela_destino, registro_id) existe');

  select count(*) into n
  from pg_attribute
  where attrelid = 'public.import_bubble_map'::regclass
    and attname in ('registro_id', 'entidade', 'bubble_id', 'tabela_destino')
    and attnotnull;
  perform pg_temp.assert_eq96(n, 4, 'as quatro colunas de identidade são NOT NULL');
end;
$$;

\echo '== o mesmo registro do Bubble em dois destinos (R-01) =='

do $$
declare
  bubble text := '1780772620462x354212239768173300';
  n int;
begin
  insert into public.import_bubble_map (entidade, bubble_id, tabela_destino, registro_id) values
    ('pipelines', bubble, 'deals',      '00000000-0000-0000-0000-00000000f9d1'),
    ('pipelines', bubble, 'cca_cases',  '00000000-0000-0000-0000-00000000f9c1');

  select count(*) into n
  from public.import_bubble_map
  where entidade = 'pipelines' and bubble_id = bubble;
  perform pg_temp.assert_eq96(n, 2,
    'o mesmo bubble_id aponta para deals e cca_cases ao mesmo tempo');

  -- Reexecução da carga: a tripla repetida não duplica nem estoura.
  insert into public.import_bubble_map (entidade, bubble_id, tabela_destino, registro_id)
  values ('pipelines', bubble, 'deals', '00000000-0000-0000-0000-00000000f9d1')
  on conflict (entidade, bubble_id, tabela_destino) do nothing;

  select count(*) into n
  from public.import_bubble_map
  where entidade = 'pipelines' and bubble_id = bubble;
  perform pg_temp.assert_eq96(n, 2, 'gravar a mesma tripla de novo é no-op');

  delete from public.import_bubble_map where bubble_id = bubble;
end;
$$;

\echo '== quem enxerga e quem grava o de-para =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000f961';
  cor uuid := '00000000-0000-0000-0000-00000000f962';
  n   int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm.0096@faceimob.test', '{"full_name":"Admin 0096"}'),
    (cor, 'cor.0096@faceimob.test', '{"full_name":"Corretor 0096"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (adm, 'admin')
  on conflict do nothing;

  perform pg_temp.check96(
    (select relrowsecurity from pg_class where oid = 'public.import_bubble_map'::regclass),
    'import_bubble_map tem RLS ligada');
  perform pg_temp.check96(
    exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'import_bubble_map'),
    'import_bubble_map tem policy (RLS sem policy é tabela invisível)');

  -- Admin grava e lê.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.import_bubble_map (entidade, bubble_id, tabela_destino, registro_id)
  values ('users', 'bubble-t96', 'profiles', adm);
  select count(*) into n from public.import_bubble_map where bubble_id = 'bubble-t96';
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.assert_eq96(n, 1, 'admin grava e lê o de-para');

  -- Corretor não lê nada e não grava nada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into n from public.import_bubble_map;
  perform pg_temp.assert_eq96(n, 0, 'corretor não enxerga linha nenhuma do de-para');
  begin
    insert into public.import_bubble_map (entidade, bubble_id, tabela_destino, registro_id)
    values ('users', 'forjado-t96', 'profiles', cor);
    raise exception 'FALHOU: corretor gravou no de-para da importação';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao gravar no de-para';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- Grants: anon fora, authenticated dentro (a RLS é que recorta).
  perform pg_temp.check96(
    not has_table_privilege('anon', 'public.import_bubble_map', 'SELECT')
    and not has_table_privilege('anon', 'public.import_bubble_map', 'INSERT'),
    'anon não tem grant nenhum sobre o de-para');
  perform pg_temp.check96(
    has_table_privilege('authenticated', 'public.import_bubble_map', 'SELECT')
    and has_table_privilege('authenticated', 'public.import_bubble_map', 'INSERT'),
    'authenticated mantém os grants que 06_anon_surface cobra de toda tabela');

  -- A limpeza sai SÓ por `auth.users`: a cascata leva profiles e, com ele,
  -- user_roles. Um `delete from public.user_roles` explícito tropeçaria em
  -- `user_roles_guard_last_admin` (0061:178-215) quando `adm` for o único
  -- administrador do banco — que é o estado de um banco recém-migrado, sem os
  -- admins que os testes anteriores deixam para trás. O guard só isenta a
  -- cascata (`and exists (select 1 from public.profiles where id =
  -- old.profile_id)`, 0061:197), então este é o caminho que devolve o banco ao
  -- estado exato de antes do teste, rodando sozinho ou dentro do `--all`.
  delete from public.import_bubble_map where bubble_id in ('bubble-t96', 'forjado-t96');
  delete from auth.users where id in (adm, cor);
end;
$$;

\echo '== idempotência de team_members no vínculo encerrado (R-05) =='

do $$
declare
  pes  uuid := '00000000-0000-0000-0000-00000000f963';
  tim  uuid;
  n    int;
begin
  perform pg_temp.check96(
    exists (select 1 from pg_indexes
             where schemaname = 'public' and indexname = 'team_members_import_key'),
    'team_members_import_key existe');

  insert into auth.users (id, email, raw_user_meta_data)
  values (pes, 'ex.0096@faceimob.test', '{"full_name":"Desligado 0096"}')
  on conflict do nothing;
  insert into public.teams (name) values ('Equipe T96') returning id into tim;

  -- Vínculo ENCERRADO: é exatamente o que `team_members_one_active` (parcial,
  -- `where left_at is null`) deixa de fora. 179 das 267 linhas do legado são
  -- assim.
  insert into public.team_members (team_id, profile_id, joined_at, left_at)
  values (tim, pes, date '2023-03-01', date '2024-05-31');

  insert into public.team_members (team_id, profile_id, joined_at, left_at)
  values (tim, pes, date '2023-03-01', date '2024-05-31')
  on conflict (profile_id, team_id, joined_at) do nothing;

  select count(*) into n from public.team_members where profile_id = pes;
  perform pg_temp.assert_eq96(n, 1,
    'reimportar o mesmo vínculo encerrado não duplica a linha');

  -- A trava é do banco, não do `on conflict`: sem a cláusula, o insert estoura.
  begin
    insert into public.team_members (team_id, profile_id, joined_at, left_at)
    values (tim, pes, date '2023-03-01', date '2024-05-31');
    raise exception 'FALHOU: vínculo encerrado duplicado entrou sem erro';
  exception when unique_violation then
    raise notice '  ok  vínculo encerrado duplicado é recusado pelo banco';
  end;

  delete from public.team_members where profile_id = pes;
  delete from public.teams where id = tim;
  delete from public.user_roles where profile_id = pes;
  delete from auth.users where id = pes;
end;
$$;

\echo '== estágio de CCA para DISTRATO/QUEDA (N-19) =='

do $$
declare
  v_stage uuid;
  v_color text;
begin
  -- Desde a 0150 o estágio fica INATIVO: as 19 colunas do cliente (15/09/2026)
  -- não têm distrato/queda. Ele continua existindo porque é o estágio gravado
  -- dos casos cancelados. O contrato com a tela virou o inverso do de antes:
  -- não há coluna ativa de `cancelled`, então a esteira tira esses casos da
  -- tela em vez de procurar coluna para eles (o fallback de `loadCcaBoard`
  -- os jogaria na primeira coluna, EM ANÁLISE).
  select id, color into v_stage, v_color
  from public.cca_stages
  where status = 'cancelled'
  order by position
  limit 1;

  perform pg_temp.check96(v_stage is not null,
    'existe estágio com desfecho cancelled para os casos de distrato e queda');

  perform pg_temp.check96(
    not exists (select 1 from public.cca_stages where status = 'cancelled' and active)
    and not exists (
      select 1 from public.cca_cases c
        join public.cca_stages s on s.id = c.stage_id
       where c.status = 'cancelled' and s.status <> 'cancelled'),
    'nenhuma coluna ativa é de cancelled, e caso cancelled não fica em coluna de outro desfecho');

  -- `ccaStageTone` (ccaStage.ts:63-76) só entende chave semântica, token ou
  -- família de paleta. Hex cai em `neutral` calado — o valor gravado tem de ser
  -- uma das chaves que a tela oferece no seletor.
  perform pg_temp.check96(
    v_color in ('info', 'warning', 'success', 'danger', 'highlight', 'neutral'),
    'a cor do estágio novo é chave semântica, não hex');
end;
$$;

\echo 'OK 96 · de-para com PK tripla e RLS, team_members idempotente, esteira com estágio de cancelamento'
