-- =============================================================================
-- 0152 · Cor da construtora
--
-- O que este arquivo cobra:
--   1. a coluna nasce vazia e todo autenticado a lê (o Pipeline do corretor
--      pinta a bolinha com ela);
--   2. corretor não grava a cor; admin grava e limpa ("Sem cor");
--   3. formato fora de #RRGGBB é recusado pelo banco;
--   4. anon sem acesso.
--
-- Prefixo 99 e não 152: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`.
-- UUIDs na faixa `…-000001520001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check152(cond boolean, label text)
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

create or replace function pg_temp.become152(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

create or replace function pg_temp.cor152()
returns text
language sql
as $$
  select color from public.developers where id = '00000000-0000-0000-0000-000001520010';
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001520001';
  cor uuid := '00000000-0000-0000-0000-000001520002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@cor152.test', '{"full_name":"Admin 152"}'),
    (cor, 'cor@cor152.test', '{"full_name":"Corretor 152"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  insert into public.developers (id, name, slug)
  values ('00000000-0000-0000-0000-000001520010', 'Construtora Cor 152', 'construtora-cor-152')
  on conflict do nothing;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. coluna vazia e legível por autenticado =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_lida text := 'nada';
  v_linhas int;
begin
  perform pg_temp.check152(pg_temp.cor152() is null, 'construtora nasce sem cor');

  perform pg_temp.become152('00000000-0000-0000-0000-000001520002');
  set local role authenticated;
  select color into v_lida from public.developers where id = '00000000-0000-0000-0000-000001520010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check152(v_linhas = 1 and v_lida is null, 'corretor lê a construtora com a coluna color');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. quem grava a cor =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_linhas int;
begin
  perform pg_temp.become152('00000000-0000-0000-0000-000001520002');
  set local role authenticated;
  update public.developers set color = '#123ABC' where id = '00000000-0000-0000-0000-000001520010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check152(v_linhas = 0 and pg_temp.cor152() is null,
    'corretor não grava a cor (RLS não casa linha)');

  perform pg_temp.become152('00000000-0000-0000-0000-000001520001');
  set local role authenticated;
  update public.developers set color = '#123ABC' where id = '00000000-0000-0000-0000-000001520010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check152(v_linhas = 1 and pg_temp.cor152() = '#123ABC', 'admin grava #123ABC');

  perform pg_temp.become152('00000000-0000-0000-0000-000001520001');
  set local role authenticated;
  update public.developers set color = '#a1b2c3' where id = '00000000-0000-0000-0000-000001520010';
  reset role;

  perform pg_temp.check152(pg_temp.cor152() = '#a1b2c3', 'minúscula também vale (é o que o seletor do navegador devolve)');

  perform pg_temp.become152('00000000-0000-0000-0000-000001520001');
  set local role authenticated;
  update public.developers set color = null where id = '00000000-0000-0000-0000-000001520010';
  reset role;

  perform pg_temp.check152(pg_temp.cor152() is null, 'admin limpa a cor (Sem cor)');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. formato =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_valor text;
  v_estado text;
begin
  foreach v_valor in array array[
    'red', '#12345', '#1234567', '#GGGGGG', '123456', ' #123456', '#123456 ',
    'url(https://x.test/a.png)', ''
  ] loop
    v_estado := null;
    perform pg_temp.become152('00000000-0000-0000-0000-000001520001');
    set local role authenticated;
    begin
      update public.developers set color = v_valor where id = '00000000-0000-0000-0000-000001520010';
    exception when check_violation then
      v_estado := sqlstate;
    end;
    reset role;

    perform pg_temp.check152(v_estado = '23514' and pg_temp.cor152() is null,
      format('formato %L recusado', v_valor));
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. anon sem acesso =='
-- -----------------------------------------------------------------------------
-- A tabela tem o grant de tabela da 0023 para anon; quem barra é a RLS, sem
-- policy nenhuma para anon ou public em `developers`.
do $$
declare
  v_lidas int;
  v_linhas int;
begin
  perform pg_temp.check152(
    not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'developers'
                   and roles && array['anon', 'public']::name[]),
    'nenhuma policy de developers vale para anon');

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  set local role anon;
  select count(*) into v_lidas from public.developers where id = '00000000-0000-0000-0000-000001520010';
  update public.developers set color = '#ABCDEF' where id = '00000000-0000-0000-0000-000001520010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check152(v_lidas = 0 and v_linhas = 0 and pg_temp.cor152() is null,
    'anon não lê nem grava a cor');
end
$$;

delete from public.developers where id = '00000000-0000-0000-0000-000001520010';

\echo 'cor da construtora ok'
