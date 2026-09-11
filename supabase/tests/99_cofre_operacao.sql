-- =============================================================================
-- 99 · Cofre de credenciais da operação (migration 0105)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`; a migration coberta é a 0105.
--
-- O que cada asserção defende, e o que quebra sem ela:
--   · O cofre guarda senha de e-mail, de pipeline e de painel de construtora,
--     mais a senha de acesso do colaborador. Quem não é administrador nem sócio
--     NÃO lê a tabela (não tem usage em `private`), NÃO lista, NÃO revela, NÃO
--     grava e NÃO apaga. Cada porta é cobrada separadamente: uma delas aberta
--     entrega o cofre inteiro.
--   · SÓCIO passa onde administrador passa (decisão do cliente em 10/09/2026,
--     `is_admin()` desde a 0097). E o corretor continua recusado nos mesmos
--     gates — sem esse segundo lado, um `is_admin()` que devolvesse `true` para
--     todo mundo passaria no teste.
--   · LISTAR não devolve segredo. É cobrado na ASSINATURA da função, não no
--     dado: uma coluna `secret` acrescentada ali vazaria todas as senhas de uma
--     vez para o browser de quem apenas abriu a aba.
--   · REVELAR grava a auditoria na MESMA transação. Se o registro puder falhar
--     e o valor sair mesmo assim, a auditoria é decorativa.
--   · A tabela não é alcançável pelo PostgREST: `private` sem usage para
--     `anon`/`authenticated` e sem grant de tabela para eles. É o que impede um
--     `GET /rest/v1/operation_credentials` de existir.
--   · Validação de fronteira: rótulo/login com tamanho máximo e link que
--     precisa ser URL absoluta (mesma regra de `useful_links`, 0063).
--   · Senha de PESSOA não se edita por `set_operation_credential`: o cofre
--     passaria a afirmar uma senha que o Auth não tem.
--   · `store_broker_password` é exclusiva da service role — é a porta da edge
--     function, e o browser não pode alcançá-la.
--
-- UUIDs na faixa `…-000001050001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check105(cond boolean, label text)
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

create or replace function pg_temp.assert_eq105(got anyelement, want anyelement, label text)
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
create or replace function pg_temp.become105(user_id uuid)
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
  admin_id   uuid := '00000000-0000-0000-0000-000001050001';
  socio_id   uuid := '00000000-0000-0000-0000-000001050002';
  broker_id  uuid := '00000000-0000-0000-0000-000001050003';
  v_id       uuid;
  v_pessoa   uuid;
  v_secret   text;
  v_ok       boolean;
  v_args     text[];
  n          int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (admin_id,  'admin@t105.test',  '{"full_name":"Admin T105"}'),
    (socio_id,  'socio@t105.test',  '{"full_name":"Sócio T105"}'),
    (broker_id, 'broker@t105.test', '{"full_name":"Corretor T105"}')
  on conflict do nothing;
  -- O gatilho de `auth.users` já dá `broker` aos três: é de propósito. O sócio
  -- real também carrega esse papel, e o teste precisa provar que quem abre a
  -- porta é o `partner`, não ele.
  insert into public.user_roles (profile_id, role) values
    (admin_id, 'admin'), (socio_id, 'partner')
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- 1. O administrador cadastra uma credencial da operação.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(admin_id);
  set local role authenticated;
  v_id := public.set_operation_credential(
    'Painel da construtora Alfa', 'imobiliaria@alfa.com.br',
    'senha-do-painel-105', 'https://painel.alfa.com.br');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check105(v_id is not null, 'admin cadastra credencial no cofre');
  perform pg_temp.check105(
    exists (select 1 from private.operation_credentials
             where id = v_id and created_by = admin_id
               and created_by_email = 'admin@t105.test'),
    'a linha guarda quem cadastrou e quando');

  -- ---------------------------------------------------------------------------
  -- 2. Corretor não chega ao cofre por porta nenhuma.
  --
  -- Cinco tentativas, cada uma cobrada em separado: a leitura direta da tabela
  -- (a que existiria se `private` tivesse usage), listar, revelar, gravar e
  -- apagar.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(broker_id);
  set local role authenticated;

  begin
    perform 1 from private.operation_credentials;
    raise exception 'FALHOU: corretor leu private.operation_credentials direto';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não tem usage em private: leitura direta é 42501';
  end;

  begin
    perform * from public.list_operation_credentials();
    raise exception 'FALHOU: corretor listou o cofre';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao listar o cofre';
  end;

  begin
    perform public.reveal_operation_credential(v_id);
    raise exception 'FALHOU: corretor revelou segredo do cofre';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao revelar credencial';
  end;

  begin
    perform public.set_operation_credential('x', 'y', 'z');
    raise exception 'FALHOU: corretor gravou no cofre';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao gravar no cofre';
  end;

  begin
    perform public.delete_operation_credential(v_id);
    raise exception 'FALHOU: corretor apagou credencial do cofre';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao apagar credencial';
  end;

  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- ---------------------------------------------------------------------------
  -- 3. Listar não devolve segredo — cobrado na assinatura da função.
  -- ---------------------------------------------------------------------------
  select coalesce(p.proargnames, array[]::text[]) into v_args
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'list_operation_credentials';

  perform pg_temp.check105(
    array_length(v_args, 1) > 0 and not ('secret' = any (v_args)),
    'list_operation_credentials não tem coluna de segredo na saída');

  -- ---------------------------------------------------------------------------
  -- 4. Administrador lista e revela; revelar deixa rastro.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(admin_id);
  set local role authenticated;
  select count(*) into n from public.list_operation_credentials();
  v_secret := public.reveal_operation_credential(v_id);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check105(n >= 1, 'admin lista o cofre');
  perform pg_temp.assert_eq105(v_secret, 'senha-do-painel-105', 'admin revela o segredo');
  perform pg_temp.check105(
    exists (select 1 from public.credential_reveal_log
             where credential_id = v_id and actor_id = admin_id
               and actor_email = 'admin@t105.test'
               and credential_label = 'Painel da construtora Alfa'),
    'revelar grava quem revelou, o que e quando');

  -- ---------------------------------------------------------------------------
  -- 5. Sócio passa onde o administrador passa (0097 + decisão de 10/09/2026).
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(socio_id);
  set local role authenticated;
  select count(*) into n from public.list_operation_credentials();
  v_secret := public.reveal_operation_credential(v_id);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check105(n >= 1, 'sócio lista o cofre igual ao administrador');
  perform pg_temp.assert_eq105(v_secret, 'senha-do-painel-105', 'sócio revela o segredo');
  perform pg_temp.check105(
    exists (select 1 from public.credential_reveal_log
             where credential_id = v_id and actor_id = socio_id),
    'a revelação do sócio também fica registrada');

  -- A auditoria de revelações é só de admin: ela cita rótulo de credencial e
  -- e-mail de quem administra. Cobrada AGORA, com linhas já existindo — antes
  -- das revelações a tabela estaria vazia para todo mundo e o teste passaria
  -- sem provar RLS nenhuma.
  perform pg_temp.become105(broker_id);
  set local role authenticated;
  select count(*) into n from public.credential_reveal_log;
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.assert_eq105(n, 0, 'corretor não lê credential_reveal_log (RLS)');

  -- ---------------------------------------------------------------------------
  -- 6. Validação de fronteira.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(admin_id);
  set local role authenticated;

  begin
    perform public.set_operation_credential('Portal X', 'login', 'senha', 'www.portal.com');
    raise exception 'FALHOU: link relativo aceito no cofre';
  exception when raise_exception then
    raise notice '  ok  link precisa ser URL absoluta (http/https)';
  end;

  begin
    perform public.set_operation_credential('   ', 'login', 'senha');
    raise exception 'FALHOU: rótulo vazio aceito no cofre';
  exception when raise_exception then
    raise notice '  ok  rótulo vazio é recusado';
  end;

  begin
    perform public.set_operation_credential(repeat('a', 121), 'login', 'senha');
    raise exception 'FALHOU: rótulo acima de 120 caracteres aceito';
  exception when raise_exception then
    raise notice '  ok  rótulo acima de 120 caracteres é recusado';
  end;

  begin
    perform public.set_operation_credential('Portal X', repeat('b', 201), 'senha');
    raise exception 'FALHOU: login acima de 200 caracteres aceito';
  exception when raise_exception then
    raise notice '  ok  login acima de 200 caracteres é recusado';
  end;

  -- Editar o que é da operação continua livre para o administrador.
  perform public.set_operation_credential(
    'Painel da construtora Alfa', 'imobiliaria@alfa.com.br',
    'senha-nova-105', 'https://painel.alfa.com.br', v_id);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check105(
    exists (select 1 from private.operation_credentials
             where id = v_id and secret = 'senha-nova-105'),
    'admin edita credencial da operação');

  -- ---------------------------------------------------------------------------
  -- 7. Senha de acesso do colaborador: só pela porta da service role, e não se
  --    edita pelo caminho da operação.
  --
  -- É a regra que impede o cofre de mentir: `set_operation_credential` trocaria
  -- só o valor guardado, e o Auth continuaria com a senha anterior — o
  -- administrador leria daqui uma senha que não entra em lugar nenhum.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(admin_id);
  set local role authenticated;
  begin
    perform public.store_broker_password(broker_id, 'broker@t105.test', 'senha-do-corretor');
    raise exception 'FALHOU: admin autenticado gravou senha de acesso direto no cofre';
  exception when insufficient_privilege then
    raise notice '  ok  store_broker_password recusa quem não é service role';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- A edge function, com service role: aplica no Auth (fora daqui) e grava.
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'service_role')::text, false);
  v_pessoa := public.store_broker_password(
    broker_id, 'broker@t105.test', 'senha-do-corretor', admin_id, 'admin@t105.test');
  -- Definir de novo SUBSTITUI: guardar a senha anterior seria manter viva uma
  -- credencial que já não vale.
  perform public.store_broker_password(
    broker_id, 'broker@t105.test', 'segunda-senha-do-corretor', admin_id, 'admin@t105.test');
  perform set_config('request.jwt.claims', '', false);

  select count(*) into n from private.operation_credentials where profile_id = broker_id;
  perform pg_temp.assert_eq105(n, 1, 'uma senha de sistema por pessoa: a nova substitui a anterior');
  perform pg_temp.check105(
    exists (select 1 from private.operation_credentials
             where id = v_pessoa and secret = 'segunda-senha-do-corretor'
               and created_by = admin_id),
    'a senha guardada é a última definida, com quem a definiu');

  perform pg_temp.become105(admin_id);
  set local role authenticated;
  begin
    perform public.set_operation_credential(
      'Acesso ao sistema', 'broker@t105.test', 'senha-inventada', null, v_pessoa);
    raise exception 'FALHOU: senha de pessoa editada pelo caminho da operação';
  exception when raise_exception then
    raise notice '  ok  senha de pessoa não se edita por set_operation_credential';
  end;

  -- Mas o administrador CONSULTA a senha que ele mesmo definiu — é o requisito
  -- "ver a senha do corretor", no único formato que o Auth permite.
  v_secret := public.reveal_operation_credential(v_pessoa);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.assert_eq105(v_secret, 'segunda-senha-do-corretor',
    'admin consulta a senha de acesso que definiu para o corretor');

  -- ---------------------------------------------------------------------------
  -- 8. Apagar: o caminho de tirar do ar uma credencial vazada.
  -- ---------------------------------------------------------------------------
  perform pg_temp.become105(admin_id);
  set local role authenticated;
  v_ok := public.delete_operation_credential(v_id);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq105(v_ok, true, 'admin apaga credencial do cofre');
  perform pg_temp.check105(
    not exists (select 1 from private.operation_credentials where id = v_id),
    'a credencial apagada some da tabela');
  -- A auditoria sobrevive à credencial: a pergunta "quem viu essa senha"
  -- costuma vir depois de ela ter sido apagada.
  perform pg_temp.check105(
    exists (select 1 from public.credential_reveal_log
             where credential_label = 'Painel da construtora Alfa'),
    'o registro de quem revelou sobrevive ao apagar da credencial');

  -- ---------------------------------------------------------------------------
  -- 9. `access_provision_log` aceita o ato novo: definir senha é
  --    provisionamento de acesso, e a trilha de Equipes lê essa tabela.
  -- ---------------------------------------------------------------------------
  insert into public.access_provision_log (actor_id, actor_email, profile_id, action, email)
  values (admin_id, 'admin@t105.test', broker_id, 'password', 'broker@t105.test');
  perform pg_temp.check105(
    exists (select 1 from public.access_provision_log
             where profile_id = broker_id and action = 'password'),
    'access_provision_log registra a definição de senha');
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. A tabela não é alcançável pelo PostgREST.
--
-- O PostgREST expõe `public` e `graphql_public`; `private` não está lá e nem
-- `anon` nem `authenticated` têm usage no schema. Sem essas duas condições
-- existiria um `GET /rest/v1/operation_credentials` devolvendo todas as senhas
-- da operação para qualquer pessoa logada.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check105(
    not has_schema_privilege('anon', 'private', 'usage')
    and not has_schema_privilege('authenticated', 'private', 'usage'),
    'schema private sem usage para anon e authenticated');

  perform pg_temp.check105(
    not has_table_privilege('anon', 'private.operation_credentials', 'select')
    and not has_table_privilege('authenticated', 'private.operation_credentials', 'select')
    and not has_table_privilege('anon', 'private.operation_credentials', 'insert')
    and not has_table_privilege('authenticated', 'private.operation_credentials', 'insert'),
    'operation_credentials sem grant de tabela para anon e authenticated');

  perform pg_temp.check105(
    not has_function_privilege('anon', 'public.list_operation_credentials()', 'execute')
    and not has_function_privilege('anon', 'public.reveal_operation_credential(uuid)', 'execute')
    and not has_function_privilege('authenticated',
          'public.store_broker_password(uuid, text, text, uuid, text)', 'execute'),
    'anon não executa as RPCs do cofre e o browser não alcança store_broker_password');

  perform pg_temp.check105(
    not has_table_privilege('anon', 'public.credential_reveal_log', 'select'),
    'anon não lê a auditoria de revelações');
end;
$$;

\echo 'cofre da operação ok'
