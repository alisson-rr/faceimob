-- =============================================================================
-- Regressão da 0015 — acesso ao menu como permissão de verdade.
--
-- Antes da 0015 a tela `AdminPermissions` não gravava nada e a visibilidade do
-- menu era uma lista de papéis hardcoded no `AppSidebar.tsx`. O teste prova as
-- duas metades do contrato que o frontend passou a assumir:
--   1. os códigos `menu.*` existem e têm as concessões iniciais corretas;
--   2. `has_permission()` responde por eles, inclusive o curto-circuito de admin;
--   3. só admin grava na matriz — a tela esconder o switch é conveniência.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check5(cond boolean, label text)
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

-- -----------------------------------------------------------------------------
-- Cenário: um admin e um corretor
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000bb01';
  cor uuid := '00000000-0000-0000-0000-00000000bb02';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@menu.test', '{"full_name":"Admin Menu"}'),
    (cor, 'cor@menu.test', '{"full_name":"Corretor Menu"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;
end;
$$;

-- A partir daqui roda como `authenticated`: o psql do harness é superusuário e
-- superusuário ignora RLS, então sem isto o teste de escrita passaria sempre.
set role authenticated;

\echo '== catálogo de menu =='

do $$
declare n int;
begin
  -- Tripwire de propósito: item de menu novo tem que vir com a decisão de quem
  -- o enxerga. Se este assert quebrar, atualize o número E revise as concessões.
  select count(*) into n from public.permissions where category = 'menu';
  perform pg_temp.check5(n = 20, format('catálogo tem os 20 códigos menu.* (tem %s)', n));

  perform pg_temp.check5(
    exists (select 1 from public.permissions where code = 'menu.dashboard'),
    'menu.dashboard existe no catálogo');

  perform pg_temp.check5(
    exists (select 1 from public.permissions where code = 'menu.admin_integrations'),
    'menu.admin_integrations existe (cofre de tokens, 0016)');

  -- Toda rota protegida no front precisa de código; se alguém adicionar item de
  -- menu sem código, a tela some para todo mundo menos admin e ninguém entende.
  perform pg_temp.check5(
    not exists (
      select 1 from public.role_permissions rp
      left join public.permissions p on p.code = rp.permission
      where p.code is null),
    'nenhuma concessão aponta para código inexistente');
end;
$$;

\echo '== concessões iniciais preservam o menu anterior =='

do $$
begin
  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'broker' and permission = 'menu.dashboard' and allowed),
    'corretor mantém Dashboard');

  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'broker' and permission = 'menu.checkin' and allowed),
    'corretor mantém Check-in');

  perform pg_temp.check5(
    not exists (select 1 from public.role_permissions
                where role = 'broker' and permission = 'menu.admin_permissions'),
    'corretor não recebe o menu de administração');

  perform pg_temp.check5(
    not exists (select 1 from public.role_permissions
                where role = 'broker' and permission = 'menu.resultados'),
    'corretor continua sem Resultados');

  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'cca' and permission = 'menu.cca' and allowed),
    'CCA mantém o pipeline de crédito');

  -- Antes da 0015 quem tinha só o papel sdr abria o sistema com o menu vazio.
  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'sdr' and permission = 'menu.sdr' and allowed),
    'SDR deixa de abrir o sistema com menu vazio');
end;
$$;

\echo '== has_permission responde pelos códigos de menu =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000bb01';
  cor uuid := '00000000-0000-0000-0000-00000000bb02';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  perform pg_temp.check5(public.has_permission('menu.dashboard'),
    'corretor tem has_permission(menu.dashboard)');
  perform pg_temp.check5(not public.has_permission('menu.admin_permissions'),
    'corretor não tem has_permission(menu.admin_permissions)');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);

  -- O front espelha esse curto-circuito em `can()`. Se um lado mudar sem o
  -- outro, a tela some com botão que o banco aceita (ou o contrário).
  perform pg_temp.check5(public.has_permission('menu.admin_permissions'),
    'admin tem tudo por is_admin(), sem precisar de linha na matriz');
end;
$$;

\echo '== só admin edita a matriz =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000bb01';
  cor uuid := '00000000-0000-0000-0000-00000000bb02';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  begin
    insert into public.role_permissions (role, permission, allowed)
    values ('broker', 'menu.admin_permissions', true);
    raise exception 'FALHOU: corretor concedeu permissão a si mesmo';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não grava em role_permissions';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);

  insert into public.role_permissions (role, permission, allowed)
  values ('broker', 'menu.resultados', true)
  on conflict (role, permission) do update set allowed = excluded.allowed;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);

  perform pg_temp.check5(public.has_permission('menu.resultados'),
    'concessão do admin passa a valer para o corretor');

  -- volta ao estado inicial para não contaminar testes seguintes
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);
  delete from public.role_permissions
   where role = 'broker' and permission = 'menu.resultados';
end;
$$;

\echo '== cofre só responde a service_role (0016) =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000bb02';
  v_secret text;
begin
  -- Grava uma credencial como admin, pela RPC que a tela usa.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-00000000bb01'::text, 'role','authenticated')::text, false);
  perform public.set_integration_secret('openai', 'api_key', 'sk-teste-nao-e-real', '{}'::jsonb);

  perform pg_temp.check5(
    exists (select 1 from public.list_integrations() where provider = 'openai' and has_secret),
    'list_integrations mostra que existe segredo');

  perform pg_temp.check5(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and column_name = 'secret'),
    'nenhuma coluna "secret" exposta em public');

  -- Usuário comum não lê o cofre nem pela porta nova.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role','authenticated')::text, false);
  begin
    perform public.get_integration_secret('openai', 'api_key');
    raise exception 'FALHOU: usuário autenticado leu o cofre';
  exception
    when insufficient_privilege then
      raise notice '  ok  authenticated não lê o cofre';
  end;
end;
$$;

reset role;

-- Como service_role: é a porta que a edge function usa.
do $$
declare v_secret text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, false);
  v_secret := public.get_integration_secret('openai', 'api_key');
  perform pg_temp.check5(v_secret = 'sk-teste-nao-e-real',
    'service_role lê o segredo pela porta da 0016');
end;
$$;

select set_config('request.jwt.claims', null, false);

\echo 'permissões de menu ok'
