-- =============================================================================
-- 0106 — Apelido do anexo: rótulo de tela, sem tocar no nome que a construtora
-- recebe.
--
-- Por que este arquivo existe: `rename_deal_document` é `security definer`, ou
-- seja, enxerga `deal_documents` inteira e não passa por RLS. A autorização
-- inteira mora dentro do corpo da função (`can_edit_deal`) — se alguém tirar
-- essa linha, nada em tela quebra e qualquer autenticado passa a renomear anexo
-- de qualquer negócio. É o único assert que separa "rótulo" de "buraco".
--
-- O que se cobra:
--   1. `display_name` existe e o `check` recusa branco e comprimento além de 120.
--   2. `deal_documents` continua SEM policy de UPDATE — é a premissa do desenho:
--      a 0023 concede `update` de TABELA a `authenticated`, então uma policy
--      nova abriria junto `storage_path`, `stored_name`, `version` e
--      `superseded_at`.
--   3. Quem edita o negócio renomeia; quem não edita leva 42501.
--   4. Renomear NÃO toca em `stored_name` — o nome do anexo no e-mail.
--   5. Apelido em branco limpa e a tela volta ao nome técnico.
--
-- Prefixo 95 e não 106: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`,
-- então nome de três dígitos não é executado por ninguém.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check95(cond boolean, label text)
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

-- -----------------------------------------------------------------------------
-- 1. A coluna e a fronteira de tamanho no próprio banco
-- -----------------------------------------------------------------------------
\echo '== 1. display_name e o check da fronteira =='

do $$
declare
  v_recusou boolean;
  v_deal uuid;
  v_tipo uuid;
  v_doc  uuid;
  v_stage uuid;
begin
  perform pg_temp.check95(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'deal_documents'
        and column_name = 'display_name' and is_nullable = 'YES'
    ),
    'deal_documents.display_name existe e aceita NULL (NULL = sem apelido)');

  select id into v_stage from public.pipeline_stages where code = 'proposal';
  select id into v_tipo  from public.document_types order by sort_order limit 1;

  insert into public.deals (stage_id) values (v_stage) returning id into v_deal;
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name)
  values
    (v_deal, v_tipo, v_deal || '/95-apelido.pdf', 'scan.pdf', 'rg-cpf-teste-95.pdf')
  returning id into v_doc;

  -- Branco não é apelido: a tela manda NULL para limpar, e " " gravado deixaria
  -- a linha da lista sem nome nenhum.
  v_recusou := false;
  begin
    update public.deal_documents set display_name = '   ' where id = v_doc;
  exception when check_violation then
    v_recusou := true;
  end;
  perform pg_temp.check95(v_recusou, 'o check recusa apelido só de espaço');

  v_recusou := false;
  begin
    update public.deal_documents set display_name = repeat('a', 121) where id = v_doc;
  exception when check_violation then
    v_recusou := true;
  end;
  perform pg_temp.check95(v_recusou, 'o check recusa apelido acima de 120 caracteres');

  update public.deal_documents set display_name = repeat('a', 120) where id = v_doc;
  perform pg_temp.check95(
    (select length(display_name) from public.deal_documents where id = v_doc) = 120,
    'o teto de 120 é aceito — é o mesmo número de MAX_DOCUMENT_ALIAS no front');

  update public.deal_documents set display_name = null where id = v_doc;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. A premissa do desenho: nenhuma policy de UPDATE em deal_documents
-- -----------------------------------------------------------------------------
\echo '== 2. deal_documents continua sem policy de UPDATE =='

do $$
declare
  extras text;
begin
  select string_agg(policyname, ', ' order by policyname) into extras
  from pg_policies
  where schemaname = 'public' and tablename = 'deal_documents'
    and cmd in ('UPDATE', 'ALL');

  perform pg_temp.check95(extras is null,
    format('nenhuma policy de UPDATE/ALL em deal_documents (apareceu: %s) — '
           || 'a 0023 concede update de TABELA a authenticated, então uma policy '
           || 'aqui abriria storage_path, stored_name, version e superseded_at',
           coalesce(extras, 'nenhuma')));

  perform pg_temp.check95(
    not has_function_privilege('anon', 'public.rename_deal_document(uuid,text)', 'execute'),
    'anon não executa rename_deal_document');
  perform pg_temp.check95(
    has_function_privilege('authenticated', 'public.rename_deal_document(uuid,text)', 'execute'),
    'authenticated executa rename_deal_document');
end
$$;

-- -----------------------------------------------------------------------------
-- 3, 4 e 5. Quem renomeia, o que não muda, e como se limpa
-- -----------------------------------------------------------------------------
\echo '== 3. can_edit_deal decide quem renomeia =='

do $$
declare
  dono     uuid := '00000000-0000-0000-0000-000000000951';
  estranho uuid := '00000000-0000-0000-0000-000000000952';
  v_stage uuid;
  v_tipo  uuid;
  v_deal  uuid;
  v_doc   uuid;
  v_recusou boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dono,     'dono@apelido95.test',     '{"full_name":"Corretor do rateio"}'),
    (estranho, 'estranho@apelido95.test', '{"full_name":"Corretor de fora"}');

  insert into public.user_roles (profile_id, role) values
    (dono, 'broker'), (estranho, 'broker')
  on conflict do nothing;

  select id into v_stage from public.pipeline_stages where code = 'proposal';
  select id into v_tipo  from public.document_types order by sort_order limit 1;

  insert into public.deals (stage_id, created_by) values (v_stage, dono)
  returning id into v_deal;

  -- O rateio do criador já vem do gatilho de `deals` (0022: criador vira
  -- `broker` com 100%). Repetir o insert aqui violava a unique de
  -- `deal_participants`.

  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name)
  values
    (v_deal, v_tipo, v_deal || '/95-dossie.pdf', 'IMG_0042.pdf', 'rg-cpf-cliente-95.pdf')
  returning id into v_doc;

  -- Quem está no rateio renomeia.
  perform set_config('request.jwt.claims',
    json_build_object('sub', dono::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.rename_deal_document(v_doc, '  RG da esposa  ');
  reset role;

  perform pg_temp.check95(
    (select display_name from public.deal_documents where id = v_doc) = 'RG da esposa',
    'quem edita o negócio grava o apelido, já sem os espaços das pontas');

  -- E o nome do arquivo continua o mesmo: é ele que `submission-dispatch` usa
  -- como nome do anexo no e-mail da construtora.
  perform pg_temp.check95(
    (select stored_name from public.deal_documents where id = v_doc) = 'rg-cpf-cliente-95.pdf'
    and (select storage_path from public.deal_documents where id = v_doc) = v_deal || '/95-dossie.pdf',
    'renomear NÃO toca em stored_name nem em storage_path');

  -- Quem não participa do negócio não renomeia — a função é security definer e
  -- enxerga a tabela inteira; a recusa tem que vir do corpo dela.
  perform set_config('request.jwt.claims',
    json_build_object('sub', estranho::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    perform public.rename_deal_document(v_doc, 'invasão');
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check95(v_recusou,
    'corretor fora do rateio leva 42501 ao tentar renomear');
  perform pg_temp.check95(
    (select display_name from public.deal_documents where id = v_doc) = 'RG da esposa',
    'a recusa não deixou nada gravado');

  -- Apelido em branco limpa: é como a tela volta ao nome técnico.
  perform set_config('request.jwt.claims',
    json_build_object('sub', dono::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.rename_deal_document(v_doc, '   ');
  reset role;

  perform pg_temp.check95(
    (select display_name from public.deal_documents where id = v_doc) is null,
    'apelido em branco volta a NULL e a lista mostra o nome técnico de novo');
end
$$;

\echo '== 95_apelido_anexo: OK =='
