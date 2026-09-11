-- =============================================================================
-- 94 · O login do cofre segue a troca de e-mail (migration 0108)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`; a migration coberta é a 0108.
--
-- O que cada asserção defende, e o que quebra sem ela:
--   · `sync_broker_login` é exclusiva da service role. É a porta da edge
--     function `provision-broker-user`; aberta ao browser, qualquer pessoa
--     logada reescreveria o login de uma credencial do cofre sem passar pelo
--     Auth — e o cofre passaria a apontar para uma conta que não é a da pessoa.
--   · Trocar o login NÃO toca no segredo. Se tocasse, o cofre afirmaria uma
--     senha que o Auth não tem — o mesmo defeito que `set_operation_credential`
--     já recusa ao barrar edição de linha de pessoa.
--   · Pessoa sem senha definida não tem linha no cofre: a função devolve
--     `false` em vez de estourar. A troca de e-mail não pode falhar por isso.
--   · Login vazio é recusado: sem a checagem, a coluna aceitaria o branco e o
--     administrador leria um login em branco no lugar do antigo.
--
-- UUIDs na faixa `…-000001080001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check108(cond boolean, label text)
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

do $$
declare
  admin_id  uuid := '00000000-0000-0000-0000-000001080001';
  broker_id uuid := '00000000-0000-0000-0000-000001080002';
  sem_senha uuid := '00000000-0000-0000-0000-000001080003';
  v_ok      boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (admin_id,  'admin@t108.test',  '{"full_name":"Admin T108"}'),
    (broker_id, 'antigo@t108.test', '{"full_name":"Corretor T108"}'),
    (sem_senha, 'nunca@t108.test',  '{"full_name":"Sem Senha T108"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (admin_id, 'admin')
  on conflict do nothing;

  -- A edge function definiu a senha quando o e-mail ainda era o antigo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'service_role')::text, false);
  perform public.store_broker_password(
    broker_id, 'antigo@t108.test', 'senha-do-corretor-108', admin_id, 'admin@t108.test');
  perform set_config('request.jwt.claims', '', false);

  -- ---------------------------------------------------------------------------
  -- 1. Do browser, ninguém move o login — nem o administrador.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.sync_broker_login(broker_id, 'novo@t108.test');
    raise exception 'FALHOU: admin autenticado moveu o login do cofre pelo browser';
  exception when insufficient_privilege then
    raise notice '  ok  sync_broker_login recusa quem não é service role';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check108(
    exists (select 1 from private.operation_credentials
             where profile_id = broker_id and login = 'antigo@t108.test'),
    'a recusa não deixou nada gravado');

  -- ---------------------------------------------------------------------------
  -- 2. A edge function troca o e-mail: o login segue, o segredo fica.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'service_role')::text, false);
  v_ok := public.sync_broker_login(broker_id, 'novo@t108.test');
  perform pg_temp.check108(v_ok, 'a troca devolve true quando a pessoa tem linha no cofre');
  perform pg_temp.check108(
    exists (select 1 from private.operation_credentials
             where profile_id = broker_id
               and login = 'novo@t108.test'
               and secret = 'senha-do-corretor-108'),
    'o login virou o e-mail novo e a senha guardada continua a mesma');

  -- ---------------------------------------------------------------------------
  -- 3. Quem nunca teve senha definida não derruba a troca de e-mail.
  -- ---------------------------------------------------------------------------
  v_ok := public.sync_broker_login(sem_senha, 'outro@t108.test');
  perform pg_temp.check108(not v_ok, 'sem linha no cofre devolve false em vez de erro');

  -- ---------------------------------------------------------------------------
  -- 4. Login vazio é recusado na fronteira.
  -- ---------------------------------------------------------------------------
  begin
    perform public.sync_broker_login(broker_id, '   ');
    raise exception 'FALHOU: login em branco entrou no cofre';
  exception when raise_exception then
    if position('FALHOU' in sqlerrm) > 0 then raise; end if;
    raise notice '  ok  login em branco é recusado';
  end;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check108(
    exists (select 1 from private.operation_credentials
             where profile_id = broker_id and login = 'novo@t108.test'),
    'o login em branco não sobrescreveu o que estava lá');
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Os grants, cobrados fora da transação de cenário.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check108(
    not has_function_privilege('anon', 'public.sync_broker_login(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.sync_broker_login(uuid, text)', 'execute'),
    'anon e authenticated não executam sync_broker_login');

  perform pg_temp.check108(
    has_function_privilege('service_role', 'public.sync_broker_login(uuid, text)', 'execute'),
    'service_role executa sync_broker_login');
end;
$$;

\echo 'login do cofre segue a troca de e-mail ok'
