-- =============================================================================
-- 0154 · Envio à construtora pelo gerente, e e-mail da construtora externa
--        opcional
--
-- O que este arquivo cobra:
--   1. construtora externa SEM e-mail é aceita (o CHECK saiu), gravada pela
--      tela como o admin grava;
--   2. a aprovação do gerente num negócio dessa construtora segue normal (caso
--      na CCA, negócio em "Em análise") e NÃO enfileira nada, nem registra
--      "Enviado à construtora" no histórico;
--   3. com e-mail, a aprovação continua enfileirando o dossiê para ele;
--   4. `enqueue_developer_submission`: o gerente do negócio enfileira; corretor
--      não (nem pela RPC, nem pela tabela); gerente de outro negócio não;
--      construtora interna é recusada ao gerente; documento de outro negócio é
--      recusado; anon não executa;
--   5. o gerente só envia no recorte da tela: documentação aprovada e
--      construtora externa COM e-mail. Quem tem `cca.review` segue livre.
--
-- Prefixo 99 e não 154: `validate-schema.sh` roda `supabase/tests/[0-9][0-9]_*`.
-- UUIDs na faixa `…-000001540001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check154(cond boolean, label text)
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

create or replace function pg_temp.become154(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- Negócio com todos os obrigatórios, convertido pelo corretor da equipe do
-- gerente (é assim que o gerente entra no rateio).
create or replace function pg_temp.negocio154(p_cor uuid, p_dev uuid, p_unit text)
returns uuid
language plpgsql
as $$
declare
  v_lead uuid;
  v_deal public.deals;
  v_type record;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 154 ' || p_unit, '1195154' || p_unit, 'in_progress', p_cor)
  returning id into v_lead;

  perform pg_temp.become154(p_cor);
  v_deal := public.convert_lead_to_deal(v_lead, p_dev, null, p_unit, 300000);
  perform set_config('request.jwt.claims', '', false);

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, v_deal.id || '/154-' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-154.pdf', p_cor);
  end loop;

  return v_deal.id;
end;
$$;

-- Corretor envia ao gerente e o gerente aprova, cada um com a própria sessão.
create or replace function pg_temp.aprova154(p_cor uuid, p_ger uuid, p_deal uuid)
returns void
language plpgsql
as $$
begin
  perform pg_temp.become154(p_cor);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(p_deal, 'Dossiê 154');
  reset role;

  perform pg_temp.become154(p_ger);
  set local role authenticated;
  perform public.review_deal_documents(p_deal, true, null);
  reset role;
end;
$$;

-- Chama a RPC com a sessão dada e devolve o SQLSTATE da recusa (null = gravou).
create or replace function pg_temp.envia154(p_user uuid, p_deal uuid, p_docs uuid[])
returns text
language plpgsql
as $$
declare
  v_estado text;
begin
  perform pg_temp.become154(p_user);
  set local role authenticated;
  begin
    perform public.enqueue_developer_submission(
      p_deal, 'analise@externa154.test', array['copia@externa154.test'],
      'Dossiê 154', 'Segue o dossiê.', p_docs);
  exception when others then
    v_estado := sqlstate;
  end;
  reset role;
  return v_estado;
end;
$$;

create or replace function pg_temp.docs154(p_deal uuid)
returns uuid[]
language sql
as $$
  select array_agg(id order by created_at) from public.deal_documents
   where deal_id = p_deal and superseded_at is null;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001540001';
  ger uuid := '00000000-0000-0000-0000-000001540002';
  cor uuid := '00000000-0000-0000-0000-000001540003';
  -- Gerente de outra equipe: não participa de nenhum negócio deste arquivo.
  ger2 uuid := '00000000-0000-0000-0000-000001540004';
  v_team uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@envio154.test', '{"full_name":"Admin 154"}'),
    (ger, 'ger@envio154.test', '{"full_name":"Gerente 154"}'),
    (cor, 'cor@envio154.test', '{"full_name":"Corretor 154"}'),
    (ger2, 'ger2@envio154.test', '{"full_name":"Outro Gerente 154"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (ger2, 'manager')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe Envio 154', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (id, name, flow, submission_email) values
    ('00000000-0000-0000-0000-000001540011', 'Externa Com E-mail 154', 'external', 'credito@externa154.test'),
    ('00000000-0000-0000-0000-000001540012', 'Interna 154', 'internal', null);

  delete from public.closed_months where period = public.month_start(current_date);
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 1. construtora externa sem e-mail é aceita =='
-- -----------------------------------------------------------------------------
do $$
declare
  v_estado text;
begin
  perform pg_temp.check154(
    not exists (select 1 from pg_constraint
                 where conname = 'developers_external_needs_email'
                   and conrelid = 'public.developers'::regclass),
    'o CHECK developers_external_needs_email não existe mais');

  -- Como a tela grava: sessão de admin, pela RLS de `developers_write`.
  perform pg_temp.become154('00000000-0000-0000-0000-000001540001');
  set local role authenticated;
  begin
    insert into public.developers (id, name, slug, flow, submission_email)
    values ('00000000-0000-0000-0000-000001540010', 'Externa Sem E-mail 154', 'externa-sem-email-154',
            'external', null);
  exception when others then
    v_estado := sqlstate;
  end;
  reset role;

  perform pg_temp.check154(v_estado is null
    and exists (select 1 from public.developers
                 where id = '00000000-0000-0000-0000-000001540010'
                   and flow = 'external' and submission_email is null),
    format('admin cadastra externa sem e-mail (recusa: %s)', coalesce(v_estado, 'nenhuma')));

  -- O formato continua cobrado quando o e-mail vem.
  v_estado := null;
  begin
    update public.developers set submission_email = 'sem-arroba'
     where id = '00000000-0000-0000-0000-000001540010';
  exception when check_violation then
    v_estado := sqlstate;
  end;
  perform pg_temp.check154(v_estado = '23514', 'e-mail fora do formato segue recusado');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. aprovação de negócio da externa sem e-mail: segue, sem fila =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger uuid := '00000000-0000-0000-0000-000001540002';
  cor uuid := '00000000-0000-0000-0000-000001540003';
  v_deal uuid;
begin
  v_deal := pg_temp.negocio154(cor, '00000000-0000-0000-0000-000001540010', '1541');
  perform pg_temp.aprova154(cor, ger, v_deal);

  perform pg_temp.check154(
    (select document_review_status from public.deals where id = v_deal) = 'approved',
    'a aprovação do gerente não quebra');
  perform pg_temp.check154(
    (select status from public.cca_cases where deal_id = v_deal) = 'sent_to_developer',
    'o caso entra na CCA pelo fluxo externo, como sempre');
  perform pg_temp.check154(
    (select ps.code from public.deals d join public.pipeline_stages ps on ps.id = d.stage_id
      where d.id = v_deal) = 'under_analysis',
    'o negócio vai para Em análise');
  perform pg_temp.check154(
    not exists (select 1 from public.developer_submissions where deal_id = v_deal),
    'nada entra na fila de e-mail (sem destinatário não há dossiê automático)');
  perform pg_temp.check154(
    not exists (select 1 from public.deal_history
                 where deal_id = v_deal and kind = 'sent_to_developer'),
    'o histórico não afirma "Enviado à construtora"');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. com e-mail, a aprovação continua enfileirando =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger uuid := '00000000-0000-0000-0000-000001540002';
  cor uuid := '00000000-0000-0000-0000-000001540003';
  v_deal uuid;
begin
  v_deal := pg_temp.negocio154(cor, '00000000-0000-0000-0000-000001540011', '1542');
  perform pg_temp.aprova154(cor, ger, v_deal);

  perform pg_temp.check154(
    (select count(*) from public.developer_submissions
      where deal_id = v_deal and to_email = 'credito@externa154.test'
        and status = 'queued' and requested_by = ger) = 1,
    'um dossiê na fila, para o e-mail da construtora, pedido pelo gerente');
  perform pg_temp.check154(
    exists (select 1 from public.deal_history
             where deal_id = v_deal and kind = 'sent_to_developer'),
    'e o histórico registra o envio');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. enqueue_developer_submission: quem envia e o quê =='
-- -----------------------------------------------------------------------------
do $$
declare
  ger uuid := '00000000-0000-0000-0000-000001540002';
  cor uuid := '00000000-0000-0000-0000-000001540003';
  v_deal  uuid := (select id from public.deals where unit = '1542'
                     and developer_id = '00000000-0000-0000-0000-000001540011');
  v_outro uuid := (select id from public.deals where unit = '1541'
                     and developer_id = '00000000-0000-0000-0000-000001540010');
  v_int   uuid;
  v_antes int;
  v_estado text;
begin
  perform pg_temp.check154(
    not has_function_privilege('anon',
      'public.enqueue_developer_submission(uuid,text,text[],text,text,uuid[])', 'execute')
    and has_function_privilege('authenticated',
      'public.enqueue_developer_submission(uuid,text,text[],text,text,uuid[])', 'execute'),
    'anon não executa a RPC; a tela logada executa');

  select count(*) into v_antes from public.developer_submissions where deal_id = v_deal;

  -- Corretor do negócio: nem pela RPC...
  v_estado := pg_temp.envia154(cor, v_deal, pg_temp.docs154(v_deal));
  perform pg_temp.check154(v_estado = '42501',
    format('corretor não dispara o envio pela RPC (veio %s)', coalesce(v_estado, 'gravou')));

  -- ...nem direto na tabela (`developer_submissions_write` = cca.review).
  v_estado := null;
  perform pg_temp.become154(cor);
  set local role authenticated;
  begin
    insert into public.developer_submissions
      (deal_id, developer_id, to_email, subject, document_ids, requested_by)
    values (v_deal, '00000000-0000-0000-0000-000001540011', 'x@y.test', 'x',
            pg_temp.docs154(v_deal), cor);
  exception when others then
    v_estado := sqlstate;
  end;
  reset role;
  perform pg_temp.check154(v_estado = '42501', 'corretor não grava direto na fila');

  -- Gerente, mas de outro negócio.
  v_estado := pg_temp.envia154('00000000-0000-0000-0000-000001540004', v_deal, pg_temp.docs154(v_deal));
  perform pg_temp.check154(v_estado = '42501',
    format('gerente de outro negócio é recusado (veio %s)', coalesce(v_estado, 'gravou')));

  perform pg_temp.check154(
    (select count(*) from public.developer_submissions where deal_id = v_deal) = v_antes,
    'a fila do negócio continua como estava');

  -- Sem sessão.
  perform set_config('request.jwt.claims', '', false);
  v_estado := null;
  begin
    perform public.enqueue_developer_submission(v_deal, 'a@b.test', null, 's', null, pg_temp.docs154(v_deal));
  exception when others then
    v_estado := sqlstate;
  end;
  perform pg_temp.check154(v_estado = '28000', 'sem sessão é recusado');

  -- Documento de outro negócio: o worker anexaria sem conferir o dono.
  v_estado := pg_temp.envia154(ger, v_deal, pg_temp.docs154(v_deal) || pg_temp.docs154(v_outro));
  perform pg_temp.check154(v_estado = 'P0001', 'documento de outro negócio é recusado');

  v_estado := pg_temp.envia154(ger, v_deal, '{}');
  perform pg_temp.check154(v_estado = 'P0001', 'sem documento é recusado');

  -- O gerente do negócio, com construtora externa: enfileira.
  v_estado := pg_temp.envia154(ger, v_deal, pg_temp.docs154(v_deal));
  perform pg_temp.check154(v_estado is null,
    format('gerente do negócio enfileira o dossiê (recusa: %s)', coalesce(v_estado, 'nenhuma')));
  perform pg_temp.check154(
    exists (select 1 from public.developer_submissions
             where deal_id = v_deal and to_email = 'analise@externa154.test'
               and cc_emails = array['copia@externa154.test'] and status = 'queued'
               and requested_by = ger
               and developer_id = '00000000-0000-0000-0000-000001540011'),
    'a linha nasce na fila com o destinatário, a cópia e quem pediu');

  -- Construtora interna: o gerente não tem envio a fazer.
  v_int := pg_temp.negocio154(cor, '00000000-0000-0000-0000-000001540012', '1543');
  v_estado := pg_temp.envia154(ger, v_int, pg_temp.docs154(v_int));
  perform pg_temp.check154(v_estado = 'P0001', 'construtora interna é recusada ao gerente');
  perform pg_temp.check154(
    not exists (select 1 from public.developer_submissions where deal_id = v_int),
    'e nada entra na fila do negócio da interna');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 5. o gerente envia só no recorte da tela =='
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001540001';
  ger uuid := '00000000-0000-0000-0000-000001540002';
  cor uuid := '00000000-0000-0000-0000-000001540003';
  v_sem uuid := (select id from public.deals where unit = '1541'
                   and developer_id = '00000000-0000-0000-0000-000001540010');
  v_nao uuid;
  v_estado text;
begin
  -- Externa COM e-mail, documentação ainda não aprovada: a aprovação é que
  -- enfileira, e enviar antes mandaria o dossiê duas vezes.
  v_nao := pg_temp.negocio154(cor, '00000000-0000-0000-0000-000001540011', '1544');
  v_estado := pg_temp.envia154(ger, v_nao, pg_temp.docs154(v_nao));
  perform pg_temp.check154(v_estado = 'P0001',
    format('antes da aprovação o gerente é recusado (veio %s)', coalesce(v_estado, 'gravou')));
  perform pg_temp.check154(
    not exists (select 1 from public.developer_submissions where deal_id = v_nao),
    'e nada entra na fila do negócio não aprovado');

  -- Externa SEM e-mail, aprovada: o combinado é o envio à mão.
  v_estado := pg_temp.envia154(ger, v_sem, pg_temp.docs154(v_sem));
  perform pg_temp.check154(v_estado = 'P0001',
    format('construtora sem e-mail: o gerente não manda a endereço livre (veio %s)', coalesce(v_estado, 'gravou')));
  perform pg_temp.check154(
    not exists (select 1 from public.developer_submissions where deal_id = v_sem),
    'e nada entra na fila do negócio da construtora sem e-mail');

  -- `cca.review` (o admin entra por ela) segue gravando como pela tabela.
  v_estado := pg_temp.envia154(adm, v_sem, pg_temp.docs154(v_sem));
  perform pg_temp.check154(v_estado is null,
    format('quem tem cca.review segue livre (recusa: %s)', coalesce(v_estado, 'nenhuma')));
end
$$;

\echo 'envio à construtora pelo gerente ok'
