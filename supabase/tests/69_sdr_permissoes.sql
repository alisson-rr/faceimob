-- =============================================================================
-- 69 · SDR (migration 0069): a matriz de papéis não pode se contradizer.
--
-- O que cada asserção defende:
--   · `marketing` escreve em quatro tabelas do módulo desde a 0008 e não tinha
--     `menu.sdr`: o papel autorizado pelo banco não conseguia abrir /sdr, e
--     todo o ramo `marketing` do front era código morto.
--   · `sdr` administra agentes, origens e listas mas não podia editar o
--     template que ele mesmo dispara — a aba WhatsApp ficava só para o admin.
--   · a abertura é para esses três papéis e mais ninguém: `broker` continua
--     de fora (senão a correção viraria um buraco novo).
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check69(cond boolean, label text)
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
  mkt_id    uuid := '00000000-0000-0000-0000-00000000f691';
  sdr_id    uuid := '00000000-0000-0000-0000-00000000f692';
  broker_id uuid := '00000000-0000-0000-0000-00000000f693';
  n         int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (mkt_id,    'marketing@t69.test', '{"full_name":"Marketing T69"}'),
    (sdr_id,    'sdr@t69.test',       '{"full_name":"SDR T69"}'),
    (broker_id, 'broker@t69.test',    '{"full_name":"Corretor T69"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (mkt_id, 'marketing'), (sdr_id, 'sdr'), (broker_id, 'broker')
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- 1. `marketing` enxerga o menu do módulo que já podia administrar.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', mkt_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform pg_temp.check69(public.has_permission('menu.sdr'),
    'marketing tem menu.sdr (antes escrevia nas tabelas e não abria a tela)');

  -- E continua escrevendo o template, como na 0008.
  insert into public.whatsapp_templates (name, body) values ('t69_marketing', 'Olá {{1}}');
  perform pg_temp.check69(
    exists (select 1 from public.whatsapp_templates where name = 't69_marketing'),
    'marketing continua editando template');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- ---------------------------------------------------------------------------
  -- 2. `sdr` escreve o template que ele mesmo dispara.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.whatsapp_templates (name, body) values ('t69_sdr', 'Olá {{1}}');
  perform pg_temp.check69(
    exists (select 1 from public.whatsapp_templates where name = 't69_sdr'),
    'sdr insere template (a aba WhatsApp era editável só por admin)');

  update public.whatsapp_templates set approved = true where name = 't69_sdr';
  perform pg_temp.check69(
    (select approved from public.whatsapp_templates where name = 't69_sdr'),
    'sdr atualiza o template que acabou de criar');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- ---------------------------------------------------------------------------
  -- 3. A abertura é só para esses papéis: corretor continua de fora.
  --    UPDATE barrado pelo `using` casa ZERO linhas sem erro — por isso a
  --    asserção conta linhas em vez de esperar exceção.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', broker_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    insert into public.whatsapp_templates (name, body) values ('t69_broker', 'Não deveria entrar');
    raise exception 'FALHOU: corretor inseriu template';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não insere template (42501)';
    when sqlstate 'P0001' then
      if sqlerrm like 'FALHOU%' then raise; end if;
      raise notice '  ok  corretor não insere template';
  end;

  update public.whatsapp_templates set approved = false where name = 't69_sdr';
  get diagnostics n = row_count;
  perform pg_temp.check69(n = 0, 'corretor não altera template (0 linhas, sem erro)');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  delete from public.whatsapp_templates where name in ('t69_marketing', 't69_sdr');
end;
$$;

\echo 'SDR permissões (0069) ok'
