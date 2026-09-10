-- =============================================================================
-- Conferência documental: corretor -> gerente -> CCA.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check12(cond boolean, label text)
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

\echo '== conferência documental antes do CCA =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-00000000f101';
  ger1 uuid := '00000000-0000-0000-0000-00000000f102';
  ger2 uuid := '00000000-0000-0000-0000-00000000f103';
  cor  uuid := '00000000-0000-0000-0000-00000000f104';
  fora uuid := '00000000-0000-0000-0000-00000000f105';
  v_team uuid;
  v_dev uuid;
  v_lead uuid;
  v_deal public.deals;
  v_analysis uuid;
  v_type record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@review.test',  '{"full_name":"Admin Review"}'),
    (ger1, 'ger1@review.test', '{"full_name":"Gerente Review Um"}'),
    (ger2, 'ger2@review.test', '{"full_name":"Gerente Review Dois"}'),
    (cor,  'cor@review.test',  '{"full_name":"Corretor Review"}'),
    (fora, 'fora@review.test', '{"full_name":"Corretor Fora Review"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger1, 'manager'), (ger2, 'manager'),
    (cor, 'broker'), (fora, 'broker')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe Review', ger1)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow) values ('Construtora Review', 'internal')
  returning id into v_dev;
  -- Testes anteriores exercitam o fechamento do mês corrente.
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente Review', '11955550101', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '101', 350000);
  perform pg_temp.check12(v_deal.document_review_status = 'draft',
    'conversão sem documento cria revisão em rascunho');

  reset role;

  -- Segundo gerente no mesmo negócio: a aprovação de qualquer um basta.
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal.id, ger2, 'manager');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  begin
    update public.deals set document_review_status = 'approved' where id = v_deal.id;
    raise exception 'FALHOU: corretor aprovou a própria documentação por PATCH';
  exception when insufficient_privilege then
    raise notice '  ok  campos de revisão não aceitam PATCH direto';
  end;

  select id into v_analysis from public.pipeline_stages where code = 'under_analysis';
  begin
    update public.deals set stage_id = v_analysis where id = v_deal.id;
    raise exception 'FALHOU: negócio entrou no CCA sem revisão';
  exception when raise_exception then
    if position('aprovada pelo gerente' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  etapa do CCA não pode ser pulada';
  end;

  begin
    perform public.submit_deal_for_manager_review(v_deal.id);
    raise exception 'FALHOU: enviou revisão sem documentos obrigatórios';
  exception when raise_exception then
    if position('Faltam documentos obrigatórios' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  documentos obrigatórios travam o envio ao gerente';
  end;

  reset role;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, 'review/' || v_deal.id || '/' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-cliente.pdf', cor);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  perform pg_temp.check12(
    (select document_review_status from public.deals where id = v_deal.id) = 'pending',
    'corretor envia documentação completa para conferência');
  perform pg_temp.check12(
    (select count(*) from public.notifications
     where kind = 'document_review_requested' and profile_id in (ger1, ger2)) = 2,
    'todos os gerentes vinculados são avisados');

  perform set_config('request.jwt.claims',
    json_build_object('sub', fora::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.review_deal_documents(v_deal.id, true, null);
    raise exception 'FALHOU: gerente não vinculado aprovou documentos';
  exception when insufficient_privilege then
    raise notice '  ok  pessoa fora do negócio não pode conferir';
  end;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.review_deal_documents(v_deal.id, false, null);
    raise exception 'FALHOU: devolução sem motivo foi aceita';
  exception when raise_exception then
    if position('Informe o motivo' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  devolução exige motivo';
  end;

  perform public.review_deal_documents(v_deal.id, false, 'Comprovante de renda ilegível.');
  reset role;

  perform pg_temp.check12(
    (select document_review_status from public.deals where id = v_deal.id) = 'returned'
    and (select document_review_reason from public.deals where id = v_deal.id) = 'Comprovante de renda ilegível.',
    'gerente devolve com motivo registrado');
  perform pg_temp.check12(
    exists (select 1 from public.notifications
            where profile_id = cor and kind = 'document_review_returned'
              and body = 'Comprovante de renda ilegível.'),
    'devolução notifica o corretor com o motivo');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  -- O segundo gerente aprova: não há necessidade de unanimidade.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger2::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;

  perform pg_temp.check12(
    (select document_review_status from public.deals where id = v_deal.id) = 'approved'
    and (select document_reviewed_by from public.deals where id = v_deal.id) = ger2,
    'um dos gerentes vinculados aprova sozinho');
  perform pg_temp.check12(
    exists (select 1 from public.cca_cases
            where deal_id = v_deal.id and status = 'under_review'),
    'aprovação cria o caso na esteira do CCA');
  perform pg_temp.check12(
    (select stage_id from public.deals where id = v_deal.id) = v_analysis,
    'aprovação move o negócio para Em análise');
  perform pg_temp.check12(
    exists (select 1 from public.deal_history
            where deal_id = v_deal.id and kind = 'document_review_approved'
              and actor_id = ger2),
    'decisão fica auditada no histórico');
  perform pg_temp.check12(
    exists (select 1 from public.notifications
            where profile_id = cor and kind = 'document_review_approved'),
    'aprovação também avisa o corretor');
end
$$;

-- -----------------------------------------------------------------------------
-- 0047: o envio ao gerente recusa negócio sem construtora.
--
-- Antes, a recusa só aparecia no clique do GERENTE ("Aprovar e enviar ao CCA"),
-- que grava a aprovação e chama `submit_deal_for_analysis` na mesma transação:
-- a exceção desfazia a aprovação e a tela voltava a "Aguardando gerente".
-- -----------------------------------------------------------------------------
\echo '== envio ao gerente exige construtora =='

do $$
declare
  ger1 uuid := '00000000-0000-0000-0000-00000000f102';
  cor  uuid := '00000000-0000-0000-0000-00000000f104';
  v_dev   uuid;
  v_stage uuid;
  v_deal  uuid;
  v_type  record;
begin
  select id into v_dev from public.developers where name = 'Construtora Review';
  select id into v_stage from public.pipeline_stages where code = 'proposal';

  -- O modal deixa salvar sem construtora (`developer_id` é nullable).
  insert into public.deals (stage_id, created_by) values (v_stage, cor)
  returning id into v_deal;
  -- O autofill puxa ger1 da equipe do corretor; o insert explícito é redundância
  -- proposital para o teste não depender do trigger.
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, cor, 'broker'), (v_deal, ger1, 'manager')
  on conflict do nothing;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal, v_type.id, 'review/' || v_deal || '/' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-sem-construtora.pdf', cor);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  begin
    perform public.submit_deal_for_manager_review(v_deal);
    -- O texto do FALHOU não pode casar com o filtro abaixo, senão a ausência
    -- da guarda passaria como "ok".
    raise exception 'FALHOU: envio ao gerente aceito com developer_id nulo';
  exception when raise_exception then
    if position('Defina a construtora' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  envio ao gerente recusa negócio sem construtora';
  end;
  reset role;

  perform pg_temp.check12(
    (select document_review_status from public.deals where id = v_deal) = 'draft',
    'a recusa não deixa rastro: revisão continua em rascunho');
  perform pg_temp.check12(
    not exists (select 1 from public.notifications
                where kind = 'document_review_requested' and profile_id = ger1
                  and title like '%' || (select code from public.deals where id = v_deal)),
    'gerente não é avisado de um envio recusado');

  update public.deals set developer_id = v_dev where id = v_deal;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal);
  reset role;

  perform pg_temp.check12(
    (select document_review_status from public.deals where id = v_deal) = 'pending',
    'com a construtora definida o mesmo negócio segue para conferência');
end
$$;

\echo 'conferência documental ok'
