-- =============================================================================
-- Regressão da 0046 — ficha do colaborador e troca de papéis.
--
-- O modal de Equipes mostrava nove campos sem coluna e "trocava" a função com
-- um upsert que só acumulava papel. O teste prova que as colunas existem com
-- os checks, e que `set_profile_roles()` substitui o conjunto de papéis de
-- verdade: rebaixar remove o antigo, acumular funciona, vazio é recusado, o
-- admin não se tranca para fora e quem não é admin não se promove.
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
-- Cenário: um admin e um gerente que também é corretor
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000a801';
  ger uuid := '00000000-0000-0000-0000-00000000a802';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@ficha.test', '{"full_name":"Admin Ficha"}'),
    (ger, 'ger@ficha.test', '{"full_name":"Gerente Ficha"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (ger, 'broker')
  on conflict do nothing;
end;
$$;

\echo '== colunas da ficha =='

select pg_temp.assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('cpf', 'creci', 'habilitation', 'birth_date', 'address',
                          'division', 'indication', 'badge_requested_at', 'badge_delivered_at')),
  9, 'as 9 colunas da ficha existem em profiles');

do $$
declare
  ger uuid := '00000000-0000-0000-0000-00000000a802';
  v_recusou boolean := false;
begin
  begin
    update public.profiles set cpf = '123' where id = ger;
  exception when check_violation then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'CPF fora de 11 dígitos é recusado');

  v_recusou := false;
  begin
    update public.profiles set habilitation = 'CRECI-PLENO' where id = ger;
  exception when check_violation then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'habilitação fora da lista é recusada');

  v_recusou := false;
  begin
    update public.profiles set badge_delivered_at = '2026-08-01' where id = ger;
  exception when check_violation then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'crachá entregue sem solicitação é recusado');

  update public.profiles
     set cpf = '12345678901', creci = '12345-F', habilitation = 'CRECI',
         birth_date = '1990-05-10', hired_at = '2026-01-05', address = 'Rua A, 1',
         division = 'Lançamentos', indication = 'Site',
         badge_requested_at = '2026-08-01', badge_delivered_at = '2026-08-10'
   where id = ger;
  perform pg_temp.assert_eq(
    (select cpf || '|' || habilitation || '|' || badge_delivered_at::text from public.profiles where id = ger),
    '12345678901|CRECI|2026-08-10', 'ficha completa grava');
end;
$$;

\echo '== set_profile_roles =='

select pg_temp.assert_eq(
  has_function_privilege('anon', 'public.set_profile_roles(uuid, app_role[])', 'execute'),
  false, 'anon não executa set_profile_roles');

-- A partir daqui roda como `authenticated`, pelo caminho que o front usa.
set role authenticated;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000a801';
  ger uuid := '00000000-0000-0000-0000-00000000a802';
  v_roles app_role[];
  v_recusou boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  -- rebaixar: gerente+corretor -> só corretor
  v_roles := public.set_profile_roles(ger, array['broker']::app_role[]);
  perform pg_temp.assert_eq(v_roles, array['broker']::app_role[],
    'rebaixar para corretor remove manager');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.user_roles where profile_id = ger),
    1, 'sobra uma linha em user_roles');

  -- acumular: diretor+gerente (duplicata na entrada não vira linha dupla)
  v_roles := public.set_profile_roles(ger, array['director', 'manager', 'manager']::app_role[]);
  perform pg_temp.assert_eq(v_roles, array['director', 'manager']::app_role[],
    'acumular diretor+gerente insere os dois e tira broker');

  -- vazio: recusado, e o que existia fica
  v_recusou := false;
  begin
    perform public.set_profile_roles(ger, '{}'::app_role[]);
  exception when raise_exception then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'conjunto vazio é recusado');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.user_roles where profile_id = ger),
    2, 'e os papéis anteriores ficam intactos');

  -- o admin não tira o próprio admin
  v_recusou := false;
  begin
    perform public.set_profile_roles(adm, array['broker']::app_role[]);
  exception when raise_exception then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'admin não remove a própria função de admin');
  perform pg_temp.assert_eq(
    exists (select 1 from public.user_roles where profile_id = adm and role = 'admin'),
    true, 'e segue admin');

  -- mas acumula corretor mantendo admin
  v_roles := public.set_profile_roles(adm, array['admin', 'broker']::app_role[]);
  perform pg_temp.assert_eq(v_roles, array['admin', 'broker']::app_role[],
    'admin acumula corretor mantendo admin');

  -- quem não é admin não se promove
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  v_recusou := false;
  begin
    perform public.set_profile_roles(ger, array['admin']::app_role[]);
  exception when insufficient_privilege then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'gerente não se promove: 42501');
  perform pg_temp.assert_eq(
    exists (select 1 from public.user_roles where profile_id = ger and role = 'admin'),
    false, 'e nada foi gravado');
end;
$$;

reset role;
select set_config('request.jwt.claims', null, false);

\echo 'profile roles ok'
