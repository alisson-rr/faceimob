\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- =============================================================================
-- 0151 — configuração da CCA só para admin e sócio; contador de envios por ids.
--
--   · o CCA não escreve em `cca_stages` nem em `document_types`;
--   · admin e sócio escrevem nas duas;
--   · anon não escreve nelas nem executa o contador;
--   · `cca_send_counts(ids)` devolve só esses negócios, somando o CPF inteiro.
--
-- UUIDs na faixa `…-000000151001+`, exclusiva deste arquivo.
-- =============================================================================

create or replace function pg_temp.check151(cond boolean, label text)
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
  adm uuid := '00000000-0000-0000-0000-000000151001';
  soc uuid := '00000000-0000-0000-0000-000000151002';
  ana uuid := '00000000-0000-0000-0000-000000151003';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@ccaconfig151.test', '{"full_name":"Admin 151"}'),
    (soc, 'soc@ccaconfig151.test', '{"full_name":"Socio 151"}'),
    (ana, 'ana@ccaconfig151.test', '{"full_name":"Analista 151"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (soc, 'partner'), (ana, 'cca')
  on conflict do nothing;
end;
$$;

\echo '== 0151: estágios e tipos de documento só admin e sócio escrevem =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000151001';
  soc uuid := '00000000-0000-0000-0000-000000151002';
  ana uuid := '00000000-0000-0000-0000-000000151003';
  v_col    uuid;
  v_tipo   uuid;
  v_novo   uuid;
  v_linhas int;
  v_n      int;
  v_passou text := '';
  quem     uuid;
begin
  -- Inativos: não entram no quadro nem nos documentos exigidos de outro teste.
  insert into public.cca_stages (name, color, position, status, active)
  values ('Coluna 151', '#000000', 151, 'under_review', false)
  returning id into v_col;
  insert into public.document_types (code, label, active)
  values ('tipo_151', 'Tipo 151', false)
  returning id into v_tipo;

  -- ── CCA ───────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  update public.cca_stages set name = 'Coluna 151 CCA' where id = v_col;
  get diagnostics v_linhas = row_count;
  if v_linhas > 0 then v_passou := v_passou || 'update estágio;'; end if;

  delete from public.cca_stages where id = v_col;
  get diagnostics v_linhas = row_count;
  if v_linhas > 0 then v_passou := v_passou || 'delete estágio;'; end if;

  begin
    insert into public.cca_stages (name, color, position, status, active)
    values ('Coluna 151 nova CCA', '#000000', 152, 'under_review', false);
    v_passou := v_passou || 'insert estágio;';
  exception when insufficient_privilege then null;
  end;

  update public.document_types set label = 'Tipo 151 CCA' where id = v_tipo;
  get diagnostics v_linhas = row_count;
  if v_linhas > 0 then v_passou := v_passou || 'update tipo;'; end if;

  delete from public.document_types where id = v_tipo;
  get diagnostics v_linhas = row_count;
  if v_linhas > 0 then v_passou := v_passou || 'delete tipo;'; end if;

  begin
    insert into public.document_types (code, label, active)
    values ('tipo_151_cca', 'Tipo 151 CCA', false);
    v_passou := v_passou || 'insert tipo;';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.check151(
    exists (select 1 from public.role_permissions
             where role = 'cca' and permission = 'cca.review' and allowed)
    and v_passou = ''
    and (select name from public.cca_stages where id = v_col) = 'Coluna 151'
    and (select label from public.document_types where id = v_tipo) = 'Tipo 151',
    format('o CCA não cria, edita nem apaga estágio ou tipo de documento (%s)', nullif(v_passou, '')));

  -- ── anon ──────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '', false);
  set local role anon;
  begin
    update public.cca_stages set name = 'Coluna 151 anon' where id = v_col;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.document_types set label = 'Tipo 151 anon' where id = v_tipo;
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.check151(
    (select name from public.cca_stages where id = v_col) = 'Coluna 151'
    and (select label from public.document_types where id = v_tipo) = 'Tipo 151',
    'anon não escreve em estágio nem em tipo de documento');

  -- ── admin e sócio ─────────────────────────────────────────────────────────
  foreach quem in array array[adm, soc] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', quem::text, 'role', 'authenticated')::text, false);
    set local role authenticated;

    update public.cca_stages set name = 'Coluna 151 ' || quem where id = v_col;
    get diagnostics v_linhas = row_count;
    insert into public.cca_stages (name, color, position, status, active)
    values ('Coluna 151 nova', '#000000', 152, 'under_review', false)
    returning id into v_novo;
    delete from public.cca_stages where id = v_novo;
    get diagnostics v_n = row_count;
    v_linhas := v_linhas + v_n;

    update public.document_types set label = 'Tipo 151 ' || quem where id = v_tipo;
    get diagnostics v_n = row_count;
    v_linhas := v_linhas + v_n;
    insert into public.document_types (code, label, active)
    values ('tipo_151_novo', 'Tipo 151 novo', false)
    returning id into v_novo;
    delete from public.document_types where id = v_novo;
    get diagnostics v_n = row_count;
    v_linhas := v_linhas + v_n;
    reset role;

    perform pg_temp.check151(
      v_linhas = 4
      and (select name from public.cca_stages where id = v_col) = 'Coluna 151 ' || quem
      and (select label from public.document_types where id = v_tipo) = 'Tipo 151 ' || quem,
      format('%s cria, edita e apaga estágio e tipo de documento',
             case quem when adm then 'admin' else 'sócio' end));
  end loop;

  delete from public.cca_stages where id = v_col;
  delete from public.document_types where id = v_tipo;
end;
$$;

\echo '== 0151: contador de envios só dos negócios pedidos =='

do $$
declare
  ana uuid := '00000000-0000-0000-0000-000000151003';
  v_stage uuid := (select id from public.pipeline_stages where code = 'proposal');
  v_a     uuid;
  v_b     uuid;
  v_c     uuid;
  v_ids   uuid[];
  v_agil  int;
  v_todos int;
begin
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.deals (stage_id) values (v_stage) returning id into v_a;
  insert into public.deals (stage_id) values (v_stage) returning id into v_b;
  insert into public.deals (stage_id) values (v_stage) returning id into v_c;

  -- A e B são o mesmo titular (com e sem máscara); o envio foi feito por B.
  insert into public.deal_clients (deal_id, ordinal, full_name, cpf) values
    (v_a, 1, 'Cliente 151 A', '111.222.333-44'),
    (v_b, 1, 'Cliente 151 B', '11122233344'),
    (v_c, 1, 'Cliente 151 C', '55566677788')
  on conflict (deal_id, ordinal) do update set cpf = excluded.cpf;

  insert into public.cca_cases (deal_id) values (v_a), (v_b), (v_c);
  insert into public.deal_history (deal_id, kind, detail)
  values (v_b, 'esteira_sent', '{"esteira":"agil"}');

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select array_agg(c.deal_id), max(c.agil) into v_ids, v_agil
    from public.cca_send_counts(array[v_a]) c;
  select count(*) into v_todos
    from public.cca_send_counts() c where c.deal_id in (v_a, v_b, v_c);
  reset role;

  perform pg_temp.check151(v_ids = array[v_a] and v_agil = 1,
    'com ids o contador devolve só esses negócios e soma o envio do mesmo CPF fora da lista');
  perform pg_temp.check151(v_todos = 3,
    'sem argumento o contador segue devolvendo todos os casos');

  perform pg_temp.check151(
    to_regprocedure('public.cca_send_counts()') is null
    and not has_function_privilege('anon', 'public.cca_send_counts(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.cca_send_counts(uuid[])', 'execute'),
    'uma função só (com default); anon não executa, a tela logada executa');
end;
$$;
