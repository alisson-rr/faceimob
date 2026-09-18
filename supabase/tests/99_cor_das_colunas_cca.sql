-- =============================================================================
-- 0153 · Cor das colunas da CCA
--
-- O que este arquivo cobra:
--   1. o CHECK aceita `#RRGGBB` (maiúscula e minúscula) e as seis chaves
--      antigas, e não é ele quem recusa `null`;
--   2. formato fora disso é recusado pelo banco — o valor vai direto para o
--      `style` do cabeçalho da coluna;
--   3. admin grava a cor; corretor não (`cca_stages_write` é `is_admin()`
--      desde a 0151);
--   4. anon sem acesso.
--
-- Prefixo 99 e não 153: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`.
-- UUIDs na faixa `…-000001530001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check153(cond boolean, label text)
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

create or replace function pg_temp.become153(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

create or replace function pg_temp.cor153()
returns text
language sql
as $$
  select color from public.cca_stages where id = '00000000-0000-0000-0000-000001530010';
$$;

-- Grava como admin e devolve o SQLSTATE da recusa (null = gravou).
create or replace function pg_temp.grava153(valor text)
returns text
language plpgsql
as $$
declare
  v_estado text;
begin
  perform pg_temp.become153('00000000-0000-0000-0000-000001530001');
  set local role authenticated;
  begin
    update public.cca_stages set color = valor where id = '00000000-0000-0000-0000-000001530010';
  exception when others then
    v_estado := sqlstate;
  end;
  reset role;
  return v_estado;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001530001';
  cor uuid := '00000000-0000-0000-0000-000001530002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@cor153.test', '{"full_name":"Admin 153"}'),
    (cor, 'cor@cor153.test', '{"full_name":"Corretor 153"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  -- Inativa e no fim da fila: não aparece em quadro nenhum.
  insert into public.cca_stages (id, name, color, position, status, active)
  values ('00000000-0000-0000-0000-000001530010', 'Coluna Cor 153', 'info', 999, 'under_review', false)
  on conflict do nothing;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. o que o CHECK aceita =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check153(
    exists (select 1 from pg_constraint
             where conname = 'cca_stages_color_format' and conrelid = 'public.cca_stages'::regclass),
    'cca_stages_color_format existe');

  perform pg_temp.check153(pg_temp.grava153('#AABBCC') is null and pg_temp.cor153() = '#AABBCC',
    'admin grava #AABBCC');
  perform pg_temp.check153(pg_temp.grava153('#a1b2c3') is null and pg_temp.cor153() = '#a1b2c3',
    'minúscula também vale (é o que o seletor do navegador devolve)');
  perform pg_temp.check153(pg_temp.grava153('warning') is null and pg_temp.cor153() = 'warning',
    'chave antiga continua valendo');
  perform pg_temp.check153(pg_temp.grava153('neutral') is null and pg_temp.cor153() = 'neutral',
    '"Sem cor" da tela grava neutral');

  -- A coluna é NOT NULL desde a 0012: quem barra o null é ele (23502), não o
  -- CHECK (23514). Por isso a tela grava `neutral` em "Sem cor".
  perform pg_temp.check153(pg_temp.grava153(null) is distinct from '23514',
    'null não é recusado pelo CHECK');
  perform pg_temp.check153(pg_temp.cor153() = 'neutral', 'e a cor anterior continua lá');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. formato recusado =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_valor text;
begin
  foreach v_valor in array array[
    'red', 'text-amber-400', '#abc', 'url(x)', '#12345', '#1234567', '#GGGGGG', ' #123456', 'WARNING', ''
  ] loop
    perform pg_temp.check153(pg_temp.grava153(v_valor) = '23514' and pg_temp.cor153() = 'neutral',
      format('formato %L recusado', v_valor));
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. quem grava a cor =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_linhas int;
begin
  perform pg_temp.become153('00000000-0000-0000-0000-000001530002');
  set local role authenticated;
  update public.cca_stages set color = '#123ABC' where id = '00000000-0000-0000-0000-000001530010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check153(v_linhas = 0 and pg_temp.cor153() = 'neutral',
    'corretor não grava a cor (RLS não casa linha)');

  perform pg_temp.become153('00000000-0000-0000-0000-000001530001');
  set local role authenticated;
  update public.cca_stages set color = '#123ABC' where id = '00000000-0000-0000-0000-000001530010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check153(v_linhas = 1 and pg_temp.cor153() = '#123ABC', 'admin grava #123ABC');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. anon sem acesso =='
-- -----------------------------------------------------------------------------
-- A tabela tem o grant de tabela da 0023 para anon; quem barra é a RLS, sem
-- policy nenhuma para anon ou public em `cca_stages`.
do $$
declare
  v_lidas int;
  v_linhas int;
begin
  perform pg_temp.check153(
    not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'cca_stages'
                   and roles && array['anon', 'public']::name[]),
    'nenhuma policy de cca_stages vale para anon');

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  set local role anon;
  select count(*) into v_lidas from public.cca_stages where id = '00000000-0000-0000-0000-000001530010';
  update public.cca_stages set color = '#ABCDEF' where id = '00000000-0000-0000-0000-000001530010';
  get diagnostics v_linhas = row_count;
  reset role;

  perform pg_temp.check153(v_lidas = 0 and v_linhas = 0 and pg_temp.cor153() = '#123ABC',
    'anon não lê nem grava a cor');
end
$$;

delete from public.cca_stages where id = '00000000-0000-0000-0000-000001530010';

\echo 'cor das colunas da CCA ok'
