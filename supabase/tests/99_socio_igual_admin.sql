\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- =============================================================================
-- 99 · Sócio é administrador — a regra, cobrada direto na origem
--
-- Decisão do cliente em 10/09/2026, literal: "sempre que eu falar
-- administrador, eu tô falando sobre o sócio também. os dois têm o mesmo nível
-- de permissão. Ponto."
--
-- Ela chegou ao banco em dois pontos, e é por isso que este arquivo existe: as
-- permissões do sócio deixaram de ser um dado (a linha dele em
-- `role_permissions`) e viraram uma resposta de FUNÇÃO. Sem um teste na
-- função, a regra só apareceria de lado, espalhada por asserções de tela, e
-- reverter uma das duas por engano passaria despercebido.
--
--   · 0097 → `is_admin()` responde sim para `partner`;
--   · 0099 → `has_any_role('admin', …)` responde sim para `partner` sempre que
--            `'admin'` está entre os papéis pedidos.
--
-- Os dois lados são cobrados aqui: o sócio PASSA onde o administrador passa, e
-- o corretor comum continua RECUSADO nos mesmos gates. Sem o segundo lado o
-- teste passaria com uma função que devolvesse `true` para todo mundo.
--
-- Também é cobrado o que a regra NÃO é: ninguém foi promovido (a 0093 fazia
-- isso por gatilho e a 0094 desfez, porque mexia em dado), e `has_any_role`
-- sem `'admin'` na lista continua recusando o sócio — a equivalência é com
-- administrador, não um coringa que abre qualquer gate de qualquer papel.
--
-- UUIDs na faixa `…-000000990001+`, exclusiva deste arquivo.
-- =============================================================================

create or replace function pg_temp.check99(cond boolean, label text)
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

create or replace function pg_temp.become99(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário: um sócio e um corretor comum. O gatilho de `auth.users` dá `broker`
-- aos dois no cadastro — é de propósito: o sócio real também carrega esse
-- papel, e o teste tem de provar que quem abre a porta é o `partner`, não ele.
-- -----------------------------------------------------------------------------
do $$
declare
  soc uuid := '00000000-0000-0000-0000-000000990001';
  cor uuid := '00000000-0000-0000-0000-000000990002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (soc, 'socio@igualadmin99.test',    '{"full_name":"Socio 99"}'),
    (cor, 'corretor@igualadmin99.test', '{"full_name":"Corretor 99"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values (soc, 'partner')
  on conflict do nothing;
end
$$;

\echo '== 1. has_any_role: pedir admin alcança o sócio, não o corretor =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000000990001';
  cor uuid := '00000000-0000-0000-0000-000000990002';
begin
  perform pg_temp.become99(soc);

  perform pg_temp.check99(public.has_any_role('admin'::app_role),
    'has_any_role(admin) aceita o sócio');
  perform pg_temp.check99(public.has_any_role('admin', 'cca'),
    'has_any_role(admin, …) aceita o sócio também na forma com outro papel junto');
  perform pg_temp.check99(public.is_admin(),
    'is_admin() aceita o sócio');

  -- O outro lado da mesma regra: a equivalência é com ADMINISTRADOR. Um gate
  -- que pede outro papel continua fechado — senão `has_any_role` teria virado
  -- um "sim" universal para o sócio.
  perform pg_temp.check99(not public.has_any_role('cca', 'sdr'),
    'has_any_role sem admin na lista continua recusando o sócio');

  perform pg_temp.become99(cor);

  perform pg_temp.check99(not public.has_any_role('admin'::app_role),
    'has_any_role(admin) recusa o corretor comum');
  perform pg_temp.check99(not public.has_any_role('admin', 'cca'),
    'has_any_role(admin, …) recusa o corretor comum');
  perform pg_temp.check99(not public.is_admin(),
    'is_admin() recusa o corretor comum');
end
$$;

\echo '== 2. o que a regra NÃO é: promoção de papel =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000000990001';
begin
  -- A 0093 dava o papel `admin` ao sócio por gatilho e a 0094 desfez, porque a
  -- promoção mexia em DADO: aparecia no `role_change_log` como concessão e um
  -- `delete` na linha desmontava a equivalência sem aviso. Se alguém reintroduzir
  -- o gatilho, este assert cai — e é para cair.
  perform pg_temp.check99(
    not exists (select 1 from public.user_roles
                 where profile_id = soc and role = 'admin'),
    'o sócio continua sem a linha admin em user_roles: a regra é autorização, não promoção');

  perform pg_temp.check99(
    exists (select 1 from public.user_roles
             where profile_id = soc and role = 'partner'),
    'e continua sendo partner, que é o papel que a tela mostra');
end
$$;

\echo '== 3. a matriz de permissões do sócio virou decorativa =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000000990001';
  cor uuid := '00000000-0000-0000-0000-000000990002';
begin
  -- Premissa do assert seguinte: sem esta linha ele passaria pelo motivo errado.
  perform pg_temp.check99(
    not exists (select 1 from public.role_permissions
                 where role = 'partner' and permission = 'cca.review' and allowed),
    'cenário: a matriz não concede cca.review ao sócio');

  perform pg_temp.become99(soc);
  perform pg_temp.check99(public.has_permission('cca.review'),
    'has_permission responde sim ao sócio sem linha na matriz (curto-circuito em is_admin)');

  perform pg_temp.become99(cor);
  perform pg_temp.check99(not public.has_permission('cca.review'),
    'e continua respondendo não ao corretor comum, que também não tem a linha');
end
$$;

select set_config('request.jwt.claims', '', false);

\echo 'sócio igual administrador: ok'
