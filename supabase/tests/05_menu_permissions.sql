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
-- Cenário: um admin, um corretor, um gerente e um analista de CCA; uma
-- construtora com um aporte e uma campanha (para a 0045).
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000bb01';
  cor uuid := '00000000-0000-0000-0000-00000000bb02';
  ger uuid := '00000000-0000-0000-0000-00000000bb03';
  cca uuid := '00000000-0000-0000-0000-00000000bb04';
  dev uuid := '00000000-0000-0000-0000-00000000bb10';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@menu.test', '{"full_name":"Admin Menu"}'),
    (cor, 'cor@menu.test', '{"full_name":"Corretor Menu"}'),
    (ger, 'ger@menu.test', '{"full_name":"Gerente Menu"}'),
    (cca, 'cca@menu.test', '{"full_name":"CCA Menu"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker'), (ger, 'manager'), (cca, 'cca')
  on conflict do nothing;

  insert into public.developers (id, name, slug) values
    (dev, 'Construtora Menu', 'construtora-menu')
  on conflict do nothing;

  insert into public.marketing_investments (developer_id, period, amount, notes) values
    (dev, public.month_start(current_date), 1500, 'aporte menu.test')
  on conflict do nothing;

  insert into public.ad_campaigns (external_id, platform, name, total_spend) values
    ('menu-test-001', 'meta', 'Campanha Menu', 300)
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
  -- 19 da 0015 + admin_integrations (0016) + atividades (0036).
  select count(*) into n from public.permissions where category = 'menu';
  -- 20 e não 21: a 0072 aposentou `menu.settings`. Ele estava no catálogo,
  -- tinha 7 concessões e NENHUMA policy o consultava — interruptor que a tela
  -- de Permissões oferecia e que não mudava nada. `/settings` mexe só no
  -- próprio perfil e na própria sessão, e quem autoriza é a RLS.
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

\echo '== 0045: gerente enxerga marketing; Dados só para quem lê aporte =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000bb01';
  ger uuid := '00000000-0000-0000-0000-00000000bb03';
  cca uuid := '00000000-0000-0000-0000-00000000bb04';
  n int;
begin
  -- A matriz: o gerente mantém o item, e ele agora abre de verdade.
  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'manager' and permission = 'menu.marketing' and allowed),
    'gerente mantém menu.marketing');

  -- Uma fonte de verdade: quem lê aporte e custo é quem tem o código da matriz.
  -- Sem esta linha o gerente lia o número com o switch "Ver dados financeiros"
  -- desligado na tela de permissões.
  perform pg_temp.check5(
    exists (select 1 from public.role_permissions
            where role = 'manager' and permission = 'reports.view_finance' and allowed),
    'gerente entra em reports.view_finance');

  select count(*) into n from public.role_permissions
   where permission = 'reports.view_finance' and allowed;
  perform pg_temp.check5(n = 4,
    format('financeiro fica com director, marketing, partner e manager (tem %s)', n));

  perform pg_temp.check5(
    not exists (select 1 from public.role_permissions
                where permission = 'menu.data' and role in ('broker','cca','sdr') and allowed),
    'corretor, CCA e SDR deixam de ver Dados');

  select count(*) into n from public.role_permissions
   where permission = 'menu.data' and allowed;
  perform pg_temp.check5(n = 4,
    format('Dados fica com partner, director, manager e marketing (tem %s)', n));

  -- Gerente: menu + as duas leituras + a RPC. Antes da 0045 só o menu passava.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role','authenticated')::text, false);

  perform pg_temp.check5(public.has_permission('menu.marketing'),
    'gerente tem has_permission(menu.marketing)');

  select count(*) into n from public.marketing_investments where notes = 'aporte menu.test';
  perform pg_temp.check5(n = 1, 'gerente lê marketing_investments');

  select count(*) into n from public.ad_campaigns where external_id = 'menu-test-001';
  perform pg_temp.check5(n = 1, 'gerente lê ad_campaigns');

  perform public.marketing_campaign_stats();
  raise notice '  ok  gerente chama marketing_campaign_stats sem 42501';

  -- Escrita continua com admin e marketing: o gerente só lê.
  begin
    insert into public.marketing_investments (developer_id, period, amount)
    values ('00000000-0000-0000-0000-00000000bb10', public.month_start((current_date - interval '1 month')::date), 10);
    raise exception 'FALHOU: gerente gravou aporte';
  exception
    when insufficient_privilege then
      raise notice '  ok  gerente não grava aporte';
  end;

  -- Desligar o switch na tela de permissões tem de fechar a porta de verdade:
  -- se a policy voltasse a decidir por papel cru, o admin desligaria e o gerente
  -- continuaria lendo — que é o defeito que a 0045 fecha.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);
  update public.role_permissions set allowed = false
   where role = 'manager' and permission = 'reports.view_finance';

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role','authenticated')::text, false);

  select count(*) into n from public.marketing_investments;
  perform pg_temp.check5(n = 0, 'switch desligado tira o aporte do gerente');

  select count(*) into n from public.ad_campaigns;
  perform pg_temp.check5(n = 0, 'switch desligado tira a campanha do gerente');

  begin
    perform public.marketing_campaign_stats();
    raise exception 'FALHOU: gerente leu métricas com o switch desligado';
  exception
    when insufficient_privilege then
      raise notice '  ok  switch desligado barra a RPC do gerente';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role','authenticated')::text, false);
  update public.role_permissions set allowed = true
   where role = 'manager' and permission = 'reports.view_finance';

  -- CCA: sem item, sem linha, sem RPC — é o que a tela "Acesso não liberado" reflete.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role','authenticated')::text, false);

  perform pg_temp.check5(not public.has_permission('menu.data'),
    'CCA não tem has_permission(menu.data)');

  select count(*) into n from public.marketing_investments;
  perform pg_temp.check5(n = 0, 'CCA não lê aporte nenhum');

  begin
    perform public.marketing_campaign_stats();
    raise exception 'FALHOU: CCA leu métricas de marketing';
  exception
    when insufficient_privilege then
      raise notice '  ok  CCA continua barrado na RPC';
  end;
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
