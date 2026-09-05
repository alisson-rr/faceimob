-- =============================================================================
-- 0076 — realtime de `deals`, registro da reabertura de mês e a lista de
--        corretores selecionáveis.
--
-- 1. `useDealsRealtime` assina `deals` desde a 0020 e a publication nunca teve
--    a tabela: o canal abria e nenhum evento chegava. Um assert em
--    `pg_publication_tables` é o único jeito de essa regressão aparecer — do
--    lado do front, "não chegou evento" é indistinguível de "ninguém mexeu".
--
-- 2. Reabrir mês apaga a linha de `closed_months`. O gatilho precisa deixar o
--    rastro (período, quem tinha fechado, quem reabriu) SEM depender de a tela
--    lembrar de registrar — a reabertura por SQL também tem que aparecer.
--
-- 3. `selectable_brokers()` existe porque o corretor só enxerga o próprio
--    perfil e não conseguia montar negócio rateado. Ela não pode virar uma
--    porta para `profiles`: sem sessão, zero linhas; só corretor ativo sai; e
--    só quem o banco deixa GRAVAR negócio pergunta. O assert do sócio é o que
--    mede essa largura: `handle_new_auth_user` dá `broker` a todo perfil novo,
--    então um recorte por `has_role('broker')` passaria por ele — quem separa é
--    `auth_effective_role`, o mesmo predicado de `deals_insert`.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check76(cond boolean, label text)
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

create or replace function pg_temp.become76(user_id uuid)
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

\echo '== pipeline 0076: realtime, reabertura de mês e corretores selecionáveis =='

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-000000007601';
  cor    uuid := '00000000-0000-0000-0000-000000007602';
  inativo uuid := '00000000-0000-0000-0000-000000007603';
  socio  uuid := '00000000-0000-0000-0000-000000007604';
  v_period date := date '2031-03-01';
  v_count int;
  v_by   uuid;
  v_closed timestamptz;
begin
  -- ---------------------------------------------------------------------------
  -- 1. `deals` publicada no realtime
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('deals', 'stage_permissions', 'closed_months');
  perform pg_temp.check76(v_count = 3,
    'deals, stage_permissions e closed_months no realtime (senão o canal do Pipeline é código morto)');

  -- ---------------------------------------------------------------------------
  -- 2. Reabertura de mês deixa rastro
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,     'adm.76@pipeline.test',     '{"full_name":"Admin 76"}'),
    (cor,     'cor.76@pipeline.test',     '{"full_name":"Corretor 76"}'),
    (inativo, 'inativo.76@pipeline.test', '{"full_name":"Corretor Inativo 76"}'),
    (socio,   'socio.76@pipeline.test',   '{"full_name":"Socio 76"}');

  insert into public.user_roles (profile_id, role) values (adm, 'admin')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (cor, 'broker')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (inativo, 'broker')
  on conflict do nothing;
  -- O sócio fica COM o `broker` que o gatilho concedeu: é assim que ele existe
  -- em produção, e é o caso que separa `has_role` de `auth_effective_role`.
  insert into public.user_roles (profile_id, role) values (socio, 'partner')
  on conflict do nothing;
  -- Suspender perfil é coluna administrativa (`profiles_guard_admin_columns`,
  -- 0012): sem sessão de admin o próprio gatilho recusa.
  perform pg_temp.become76(adm);
  update public.profiles set status = 'suspended' where id = inativo;
  perform set_config('request.jwt.claims', '', false);

  delete from public.closed_months where period = v_period;
  insert into public.closed_months (period, closed_at, closed_by)
  values (v_period, now() - interval '1 day', adm);

  select closed_at into v_closed from public.closed_months where period = v_period;

  -- A reabertura vem com sessão: é o admin apertando o botão.
  perform pg_temp.become76(adm);
  delete from public.closed_months where period = v_period;
  perform set_config('request.jwt.claims', '', false);

  select count(*) into v_count from public.closed_months where period = v_period;
  perform pg_temp.check76(v_count = 0, 'o mês saiu de closed_months e volta a aceitar edição');

  select count(*) into v_count from public.month_reopenings where period = v_period;
  perform pg_temp.check76(v_count = 1, 'a reabertura ficou registrada');

  select reopened_by into v_by from public.month_reopenings where period = v_period;
  perform pg_temp.check76(v_by = adm, 'o registro guarda QUEM reabriu');

  select closed_by into v_by from public.month_reopenings where period = v_period;
  perform pg_temp.check76(v_by = adm, 'o registro preserva quem tinha fechado');

  select closed_at into v_closed from public.month_reopenings where period = v_period;
  perform pg_temp.check76(v_closed is not null, 'o registro preserva quando tinha sido fechado');

  -- Reabrir por SQL, sem sessão, também precisa aparecer: o rastro não pode
  -- depender de a tela lembrar de registrar.
  insert into public.closed_months (period, closed_by) values (v_period, adm);
  delete from public.closed_months where period = v_period;
  select count(*) into v_count from public.month_reopenings where period = v_period;
  perform pg_temp.check76(v_count = 2, 'reabertura por SQL também é registrada');

  -- Ninguém escreve na tabela de registro pela API: só o gatilho.
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'month_reopenings' and cmd <> 'SELECT';
  perform pg_temp.check76(v_count = 0,
    'month_reopenings não tem policy de escrita — a linha nasce do gatilho');

  select count(*) into v_count
    from pg_tables where schemaname = 'public' and tablename = 'month_reopenings' and rowsecurity;
  perform pg_temp.check76(v_count = 1, 'month_reopenings está com RLS ligada');

  -- ---------------------------------------------------------------------------
  -- 3. selectable_brokers(): sem sessão não devolve nada; com sessão, corretor
  --    ATIVO — e nada além de id e nome.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', false);
  select count(*) into v_count from public.selectable_brokers();
  perform pg_temp.check76(v_count = 0,
    'sem sessão a função não vira porta para profiles');

  perform pg_temp.become76(cor);
  select count(*) into v_count from public.selectable_brokers() where id = cor;
  perform pg_temp.check76(v_count = 1,
    'o corretor logado enxerga corretor ativo (é o que permite montar o rateio)');

  select count(*) into v_count from public.selectable_brokers() where id = inativo;
  perform pg_temp.check76(v_count = 0, 'corretor inativo não é oferecido');

  -- O sócio enxerga o pipeline (`menu.pipeline`) mas o banco recusa a escrita
  -- de negócio: a lista de corretores não é dele. Sem este recorte, qualquer
  -- autenticado enumerava id + nome de toda a corretagem.
  perform pg_temp.become76(socio);
  select count(*) into v_count from public.selectable_brokers();
  perform pg_temp.check76(v_count = 0,
    'sócio (que também carrega o broker do cadastro) não enumera a corretagem');

  -- E quem escreve negócio continua enxergando: o admin monta rateio pela tela.
  perform pg_temp.become76(adm);
  select count(*) into v_count from public.selectable_brokers() where id = cor;
  perform pg_temp.check76(v_count = 1, 'quem grava negócio enxerga a lista do rateio');
  perform set_config('request.jwt.claims', '', false);

  -- Limpeza: o registro do cenário não pode sobrar para os asserts seguintes.
  delete from public.month_reopenings where period = v_period;
end;
$$;

\echo '== pipeline 0076: ok =='
