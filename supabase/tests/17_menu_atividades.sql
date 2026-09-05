-- =============================================================================
-- Regressão da 0036 — menu "Atividades" como permissão.
--
-- O front barra a rota `/atividades` por `menu.atividades` (guard de rota e
-- item de menu saem do mesmo mapa). O teste prova que o código existe e que
-- `has_permission()` responde por ele: corretor entra, CCA não.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

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

-- -----------------------------------------------------------------------------
-- Cenário: um corretor e um analista de CCA
-- -----------------------------------------------------------------------------
do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000a701';
  cca uuid := '00000000-0000-0000-0000-00000000a702';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@atividades.test', '{"full_name":"Corretor Atividades"}'),
    (cca, 'cca@atividades.test', '{"full_name":"Analista Atividades"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (cor, 'broker'), (cca, 'cca')
  on conflict do nothing;
end;
$$;

\echo '== catálogo =='

select pg_temp.assert_eq(
  (select count(*)::int from public.permissions
    where code = 'menu.atividades' and category = 'menu'),
  1, 'menu.atividades existe no catálogo como item de menu');

select pg_temp.assert_eq(
  (select count(*)::int from public.role_permissions
    where permission = 'menu.atividades' and allowed),
  4, 'partner, director, manager e broker recebem Atividades');

select pg_temp.assert_eq(
  exists (select 1 from public.role_permissions
           where role = 'cca' and permission = 'menu.atividades'),
  false, 'CCA não recebe Atividades');

\echo '== has_permission responde por menu.atividades =='

-- A partir daqui roda como `authenticated`: superusuário ignora RLS e a
-- função lê `role_permissions` pelo caminho que o front usa.
set role authenticated;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000a701';
  cca uuid := '00000000-0000-0000-0000-00000000a702';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  perform pg_temp.assert_eq(public.has_permission('menu.atividades'), true,
    'corretor tem has_permission(menu.atividades)');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  perform pg_temp.assert_eq(public.has_permission('menu.atividades'), false,
    'CCA não tem has_permission(menu.atividades)');
end;
$$;

reset role;
select set_config('request.jwt.claims', null, false);

\echo 'menu atividades ok'
