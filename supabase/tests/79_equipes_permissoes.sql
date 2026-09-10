-- =============================================================================
-- Regressão da 0079 — hierarquia que sobe, nome de líder e rastro de papel.
--
-- Todos os casos rodam com `request.jwt.claims` de um usuário real do cenário,
-- como o PostgREST faria: asserção rodando como superusuário não prova RLS
-- nenhum.
--
-- O cenário monta de propósito o caso que o schema PERMITE e o front evitava
-- por convenção: um gerente que NÃO é membro da equipe que lidera. Era assim
-- que o diretor abria /equipes e lia "Gerentes (0)".
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

/** Vira o usuário corrente do ponto de vista do RLS. */
create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, false);
$$;

-- -----------------------------------------------------------------------------
-- Cenário: uma diretoria com gerente FORA de team_members
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000d701';
  adm2 uuid := '00000000-0000-0000-0000-00000000d702';
  dir uuid := '00000000-0000-0000-0000-00000000d711';
  ger uuid := '00000000-0000-0000-0000-00000000d712';
  cor uuid := '00000000-0000-0000-0000-00000000d713';
  tim uuid := '00000000-0000-0000-0000-00000000d7a1';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm.0079@faceimob.test',  '{"full_name":"Admin 0079"}'),
    (adm2, 'adm2.0079@faceimob.test', '{"full_name":"Admin 0079 Dois"}'),
    (dir,  'dir.0079@faceimob.test',  '{"full_name":"Diretor 0079"}'),
    (ger,  'ger.0079@faceimob.test',  '{"full_name":"Gerente 0079"}'),
    (cor,  'cor.0079@faceimob.test',  '{"full_name":"Corretor 0079"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (adm2, 'admin'), (dir, 'director'), (ger, 'manager')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id)
  values (tim, 'Equipe 0079', 'equipe-0079', dir, ger)
  on conflict (id) do nothing;

  -- O corretor entra; o GERENTE não. É o estado que quebrava a tela.
  insert into public.team_members (team_id, profile_id)
  values (tim, cor)
  on conflict do nothing;
end
$$;

set role authenticated;

\echo '== 0079: o diretor enxerga o gerente da equipe que dirige =='

select pg_temp.como('00000000-0000-0000-0000-00000000d711');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()
     where auth_visible_profiles = '00000000-0000-0000-0000-00000000d712'),
  1, 'diretor enxerga o gerente mesmo com ele fora de team_members');

-- E continua enxergando o membro da equipe (o ramo antigo não foi perdido).
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()
     where auth_visible_profiles = '00000000-0000-0000-0000-00000000d713'),
  1, 'diretor continua enxergando o corretor membro');

-- Consequência prática: sem isto, `goals_write` recusava a meta do gerente.
select pg_temp.assert_eq(
  (select count(*)::int from public.profiles
     where id = '00000000-0000-0000-0000-00000000d712'),
  1, 'a linha de profiles do gerente abre para o diretor');

\echo '== 0079: o corretor NÃO ganhou acesso ao cadastro de ninguém =='

select pg_temp.como('00000000-0000-0000-0000-00000000d713');
select pg_temp.assert_eq(
  (select count(*)::int from public.auth_visible_profiles()),
  1, 'corretor continua enxergando apenas o próprio perfil');
select pg_temp.assert_eq(
  (select count(*)::int from public.profiles
     where id in ('00000000-0000-0000-0000-00000000d712',
                  '00000000-0000-0000-0000-00000000d711')),
  0, 'corretor não lê a ficha do gerente nem a do diretor');

\echo '== 0079: mas lê o NOME de quem lidera, que é o que a tela precisa =='

select pg_temp.assert_eq(
  (select full_name from public.team_leader_names
     where id = '00000000-0000-0000-0000-00000000d712'),
  'Gerente 0079', 'corretor resolve o nome do gerente pela view');
select pg_temp.assert_eq(
  (select full_name from public.team_leader_names
     where id = '00000000-0000-0000-0000-00000000d711'),
  'Diretor 0079', 'corretor resolve o nome do diretor pela view');
-- A view é de LÍDERES: quem não lidera nada não entra nela.
select pg_temp.assert_eq(
  (select count(*)::int from public.team_leader_names
     where id = '00000000-0000-0000-0000-00000000d713'),
  0, 'a view não é um diretório de todo mundo');

\echo '== 0079: troca de papel deixa rastro =='

select pg_temp.como('00000000-0000-0000-0000-00000000d701');
select public.set_profile_roles(
  '00000000-0000-0000-0000-00000000d713', array['broker','sdr']::app_role[]);

select pg_temp.assert_eq(
  (select roles_after from public.role_change_log
    where profile_id = '00000000-0000-0000-0000-00000000d713'
    order by created_at desc limit 1),
  array['broker','sdr']::app_role[], 'role_change_log guarda o conjunto novo');
select pg_temp.assert_eq(
  (select actor_email from public.role_change_log
    where profile_id = '00000000-0000-0000-0000-00000000d713'
    order by created_at desc limit 1),
  'adm.0079@faceimob.test', 'e quem fez a troca, como texto (a fk é set null)');

-- Repetir o MESMO conjunto não gera linha: a ficha salva o formulário inteiro a
-- cada clique, e registrar isso viraria ruído no lugar da auditoria.
select public.set_profile_roles(
  '00000000-0000-0000-0000-00000000d713', array['sdr','broker']::app_role[]);
select pg_temp.assert_eq(
  (select count(*)::int from public.role_change_log
    where profile_id = '00000000-0000-0000-0000-00000000d713'),
  1, 'conjunto idêntico não gera segunda linha de auditoria');

\echo '== 0079: a regra que impede a empresa de ficar sem administrador =='

-- A ficha afirma isso na tela. Quem chama a RPC é sempre um administrador
-- (`is_admin()` = papel do próprio chamador), então recusar o rebaixamento do
-- PRÓPRIO admin é o que garante que sobre pelo menos ele.
do $$
begin
  perform public.set_profile_roles(
    '00000000-0000-0000-0000-00000000d701', array['broker']::app_role[]);
  raise exception 'FALHOU: o admin conseguiu remover a própria função de administrador';
exception
  when sqlstate 'P0001' then
    if position('própria função' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  admin não remove a própria função de administrador';
end
$$;

-- Conjunto vazio continua recusado (regra da 0046, preservada).
do $$
begin
  perform public.set_profile_roles(
    '00000000-0000-0000-0000-00000000d713', array[]::app_role[]);
  raise exception 'FALHOU: conjunto vazio de papéis foi aceito';
exception
  when sqlstate 'P0001' then
    if position('ao menos uma função' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  conjunto vazio de papéis é recusado';
end
$$;

\echo '== 0079: a auditoria de acesso aceita a recusa e guarda quem provisionou =='

reset role;

insert into public.access_provision_log (actor_id, actor_email, profile_id, action, email)
values ('00000000-0000-0000-0000-00000000d713', 'cor.0079@faceimob.test',
        null, 'denied', 'invasor.0079@faceimob.test');

select pg_temp.assert_eq(
  (select count(*)::int from public.access_provision_log
    where action = 'denied' and email = 'invasor.0079@faceimob.test'),
  1, 'a recusa do endpoint de provisionamento cabe na trilha');

-- Bloqueio e devolução da ENTRADA. O desligamento passou a chamar a edge
-- function com `access: "revoke"` (e a reativação com `"restore"`): sem estes
-- dois valores no check, a auditoria do desligamento seria recusada pelo banco
-- e a função registraria erro num caminho que já tinha bloqueado a conta.
insert into public.access_provision_log (actor_id, actor_email, profile_id, action, email)
values ('00000000-0000-0000-0000-00000000d701', 'adm.0079@faceimob.test',
        '00000000-0000-0000-0000-00000000d713', 'revoked', 'cor.0079@faceimob.test'),
       ('00000000-0000-0000-0000-00000000d701', 'adm.0079@faceimob.test',
        '00000000-0000-0000-0000-00000000d713', 'restored', 'cor.0079@faceimob.test');

select pg_temp.assert_eq(
  (select count(*)::int from public.access_provision_log
    where action in ('revoked', 'restored')
      and profile_id = '00000000-0000-0000-0000-00000000d713'),
  2, 'bloquear e devolver a entrada deixam rastro');

-- E o check continua fechado: valor fora da lista é recusado, senão a coluna
-- viraria texto livre e a trilha deixaria de ser legível por máquina.
do $$
begin
  insert into public.access_provision_log (actor_id, profile_id, action, email)
  values ('00000000-0000-0000-0000-00000000d701', null, 'apagou', 'x@faceimob.test');
  raise exception 'FALHOU: a coluna action aceitou um valor fora da lista';
exception
  when check_violation then
    raise notice '  ok  action fora da lista é recusado';
end
$$;

set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000d713');
select pg_temp.assert_eq(
  (select count(*)::int from public.access_provision_log),
  0, 'a trilha de acesso continua só do administrador');
select pg_temp.assert_eq(
  (select count(*)::int from public.role_change_log),
  0, 'a trilha de papel também');

reset role;
select set_config('request.jwt.claims', null, false);
