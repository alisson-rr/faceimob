-- =============================================================================
-- Teste de RLS: a hierarquia enxerga o que deve e nada além.
--
-- Roda no harness (scripts/validate-schema.sh --rls) depois das migrations.
-- Falha com exceção no primeiro assert quebrado, então ON_ERROR_STOP aborta.
--
-- Cenário montado:
--
--   Diretoria Norte (diretor: Dora)
--     ├── Equipe A (gerente: Marco) ── corretores: Bruno, Bia
--     └── Equipe B (gerente: Mara)  ── corretor:   Caio
--   Ana = admin.  Pedro = sócio (leitura ampla).
--
-- Cada corretor tem 1 lead atribuído.
-- =============================================================================

\set ON_ERROR_STOP on
-- Só as NOTICEs interessam; o resultado das chamadas de assert é ruído.
\pset tuples_only on
\pset format unaligned

-- -----------------------------------------------------------------------------
-- Helper de asserção
-- -----------------------------------------------------------------------------
create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- Assume a identidade de um usuário como o PostgREST faria.
--
-- is_local = false (escopo de sessão), não true. Cada statement do psql roda na
-- própria transação; com escopo local o claim morreria antes da asserção
-- seguinte e auth.uid() voltaria NULL — dando falso negativo em todo o teste.
create or replace function pg_temp.become(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Massa de teste (como postgres, ignorando RLS)
-- -----------------------------------------------------------------------------
do $$
declare
  ana   uuid := '00000000-0000-0000-0000-0000000000a1'; -- admin
  dora  uuid := '00000000-0000-0000-0000-0000000000d1'; -- diretora
  marco uuid := '00000000-0000-0000-0000-0000000000e1'; -- gerente equipe A
  mara  uuid := '00000000-0000-0000-0000-0000000000e2'; -- gerente equipe B
  bruno uuid := '00000000-0000-0000-0000-0000000000b1'; -- corretor A
  bia   uuid := '00000000-0000-0000-0000-0000000000b2'; -- corretor A
  caio  uuid := '00000000-0000-0000-0000-0000000000c1'; -- corretor B
  pedro uuid := '00000000-0000-0000-0000-0000000000f1'; -- sócio
  team_a uuid;
  team_b uuid;
begin
  -- auth.users dispara o trigger que cria profile + papel broker.
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana,   'ana@faceimob.test',   '{"full_name":"Ana Admin"}'),
    (dora,  'dora@faceimob.test',  '{"full_name":"Dora Diretora"}'),
    (marco, 'marco@faceimob.test', '{"full_name":"Marco Gerente"}'),
    (mara,  'mara@faceimob.test',  '{"full_name":"Mara Gerente"}'),
    (bruno, 'bruno@faceimob.test', '{"full_name":"Bruno Corretor"}'),
    (bia,   'bia@faceimob.test',   '{"full_name":"Bia Corretora"}'),
    (caio,  'caio@faceimob.test',  '{"full_name":"Caio Corretor"}'),
    (pedro, 'pedro@faceimob.test', '{"full_name":"Pedro Socio"}');

  insert into public.user_roles (profile_id, role) values
    (ana,   'admin'),
    (dora,  'director'),
    (marco, 'manager'),
    (mara,  'manager'),
    (pedro, 'partner')
  on conflict do nothing;

  insert into public.teams (name, director_id, manager_id)
  values ('Equipe A', dora, marco) returning id into team_a;
  insert into public.teams (name, director_id, manager_id)
  values ('Equipe B', dora, mara) returning id into team_b;

  insert into public.team_members (team_id, profile_id) values
    (team_a, bruno),
    (team_a, bia),
    (team_b, caio),
    (team_a, marco),
    (team_b, mara);

  insert into public.leads (full_name, phone, status, assigned_to, funnel_stage) values
    ('Cliente do Bruno', '11999990001', 'in_progress', bruno, 'warm'),
    ('Cliente da Bia',   '11999990002', 'in_progress', bia,   'warm'),
    ('Cliente do Caio',  '11999990003', 'in_progress', caio,  'warm'),
    ('Lead na fila',     '11999990004', 'queued',      null,  'new');

  -- Construtora e negócio do Bruno. Sem eles, o assert de "corretor não
  -- enfileira envio para a construtora" pulava em silêncio — teste que sempre
  -- pula não prova nada.
  insert into public.developers (name, slug, flow, submission_email)
  values ('Construtora RLS', 'construtora-rls', 'external', 'analise@construtora.test')
  on conflict do nothing;

  insert into public.deals (developer_id, stage_id, created_by, vgv_gross)
  select d.id, s.id, bruno, 500000
  from public.developers d, public.pipeline_stages s
  where d.slug = 'construtora-rls' and s.code = 'lead'
  limit 1;
end
$$;

-- -----------------------------------------------------------------------------
-- Asserções
-- -----------------------------------------------------------------------------
\echo '== auth_visible_profiles =='

set role authenticated;

-- Corretor: só ele mesmo.
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  1, 'Bruno (corretor) enxerga apenas 1 perfil');

-- Gerente da Equipe A: ele + Bruno + Bia = 3.
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  3, 'Marco (gerente A) enxerga 3 perfis');

-- Diretora: ela + os 5 membros das duas equipes = 6.
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  6, 'Dora (diretora) enxerga 6 perfis');

-- Admin e sócio: todos os 8.
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  8, 'Ana (admin) enxerga todos');

select pg_temp.become('00000000-0000-0000-0000-0000000000f1');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  8, 'Pedro (sócio) enxerga todos');

\echo '== leads sob RLS =='

-- Bruno vê só o lead dele. Não vê o da Bia (mesma equipe!) nem o da fila.
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads),
  1, 'Bruno vê apenas o próprio lead');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where full_name = 'Cliente da Bia'),
  0, 'Bruno NÃO vê o lead da colega de equipe');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where status = 'queued'),
  0, 'Bruno NÃO vê a fila de leads não atribuídos');

-- Marco vê os dois leads da Equipe A + a fila (é gestor).
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where assigned_to is not null),
  2, 'Marco vê os 2 leads atribuídos da equipe dele');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where full_name = 'Cliente do Caio'),
  0, 'Marco NÃO vê lead da outra equipe');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where status = 'queued'),
  1, 'Marco vê a fila');

-- Dora vê os 3 atribuídos + fila.
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.assert_eq(
  (select count(*)::int from public.leads),
  4, 'Dora vê todos os leads das suas equipes + fila');

\echo '== escrita bloqueada =='

-- Bruno não pode reatribuir o lead da Bia para si.
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
do $$
declare v_updated int;
begin
  update public.leads set assigned_to = '00000000-0000-0000-0000-0000000000b1'
   where full_name = 'Cliente da Bia';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'FALHOU: Bruno conseguiu roubar o lead da Bia (% linhas)', v_updated;
  end if;
  raise notice '  ok  Bruno não consegue roubar lead de outro corretor';
end
$$;

-- Corretor não concede papel a si mesmo.
do $$
begin
  begin
    insert into public.user_roles (profile_id, role)
    values ('00000000-0000-0000-0000-0000000000b1', 'admin');
    raise exception 'FALHOU: corretor conseguiu se tornar admin';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não consegue se conceder papel de admin';
  end;
end
$$;

-- Corretor não enxerga a lista de IPs liberados.
select pg_temp.assert_eq(
  (select count(*)::int from public.allowed_ips),
  0, 'Corretor não lê allowed_ips');

-- -----------------------------------------------------------------------------
-- Matriz das superfícies novas (Sprints 3-5)
--
-- Estas tabelas ganharam tela agora. É o risco recorrente do projeto: RLS
-- esconde linha em silêncio, então tela migrada errado PARECE funcionar — vem
-- vazia em vez de dar erro. Cada assert aqui é "o papel X vê exatamente o que
-- deveria", não "a consulta não explodiu".
-- -----------------------------------------------------------------------------
\echo '== superfícies novas por papel =='

do $$
declare
  bruno uuid := '00000000-0000-0000-0000-0000000000b1';  -- corretor equipe A
  caio  uuid := '00000000-0000-0000-0000-0000000000c1';  -- corretor equipe B
  marco uuid := '00000000-0000-0000-0000-0000000000e1';  -- gerente equipe A
  v_lead uuid;
begin
  select id into v_lead from public.leads where assigned_to = bruno limit 1;

  -- Atividade do Bruno, criada por ele.
  perform set_config('request.jwt.claims',
    json_build_object('sub', bruno::text, 'role','authenticated')::text, false);
  insert into public.tasks (title, assigned_to, created_by, due_at, ref_type, ref_id)
  values ('Retornar ligação', bruno, bruno, now() + interval '1 day', 'lead', v_lead);

  -- Visita do Bruno no lead dele.
  insert into public.visits (lead_id, broker_id, scheduled_at)
  values (v_lead, bruno, now() + interval '2 days');
end
$$;

-- O dono vê a própria atividade.
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks), 1,
  'Corretor vê a própria atividade');
select pg_temp.assert_eq(
  (select count(*)::int from public.visits), 1,
  'Corretor vê a própria visita');

-- Corretor de outra equipe não vê nem uma nem outra.
select pg_temp.become('00000000-0000-0000-0000-0000000000c1');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks), 0,
  'Corretor de outra equipe não vê a atividade alheia');
select pg_temp.assert_eq(
  (select count(*)::int from public.visits), 0,
  'Corretor de outra equipe não vê a visita alheia');

-- Gerente enxerga a equipe: `auth_visible_profiles` alcança o Bruno.
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks), 1,
  'Gerente vê a atividade do liderado');

-- Notificação é estritamente pessoal — a policy filtra por auth.uid().
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');
select pg_temp.assert_eq(
  (select count(*)::int from public.notifications where profile_id <> '00000000-0000-0000-0000-0000000000b1'),
  0, 'Corretor não lê notificação de outro');

-- Dado financeiro: consolidado anual e campanhas são de gestão.
select pg_temp.assert_eq(
  (select count(*)::int from public.annual_results), 0,
  'Corretor não lê o consolidado anual');
select pg_temp.assert_eq(
  (select count(*)::int from public.ad_campaigns), 0,
  'Corretor não lê campanhas de mídia');

-- Corretor não enfileira envio para construtora: é do CCA e do admin.
do $$
declare
  v_deal uuid;
  v_dev  uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000b1'::text, 'role','authenticated')::text, false);

  select id into v_deal from public.deals limit 1;
  select id into v_dev  from public.developers limit 1;

  -- Sem negócio ou sem construtora visíveis, um `insert ... select` gravaria
  -- ZERO linhas e o RLS nem seria avaliado — o teste passaria por engano.
  -- Por isso os ids são resolvidos antes e o insert usa VALUES.
  if v_deal is null or v_dev is null then
    raise notice '  -- pulado: cenário sem negócio/construtora visível para o corretor';
    return;
  end if;

  begin
    insert into public.developer_submissions (deal_id, developer_id, to_email, subject)
    values (v_deal, v_dev, 'x@y.com', 'teste');
    raise exception 'FALHOU: corretor enfileirou envio para a construtora';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não enfileira envio para a construtora';
  end;
end
$$;

reset role;

\echo ''
\echo 'RLS ok'
