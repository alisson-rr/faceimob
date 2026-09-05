-- =============================================================================
-- 0037 — "ESTEIRA AGIL" é escrito pelo sistema, não escolhido.
--
-- A escrita manual do rótulo é recusada para quem não é postgres/service_role
-- enquanto a conferência não estiver aprovada; a entrada do caso na esteira
-- ('under_review') grava "13. ESTEIRA AGIL", a volta ('pending_documents')
-- grava "RET. ESTEIRA AGIL", e nenhum dos dois passa por cima de rótulo de
-- encerramento.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check18(cond boolean, label text)
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

\echo '== rótulo de esteira escrito pelo sistema =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-00000000f201';
  ger  uuid := '00000000-0000-0000-0000-00000000f202';
  cor  uuid := '00000000-0000-0000-0000-00000000f203';
  cca  uuid := '00000000-0000-0000-0000-00000000f204';
  v_team uuid;
  v_dev  uuid;
  v_lead uuid;
  v_deal public.deals;
  v_type record;
  v_label text;
begin
  perform pg_temp.check18(
    public.deal_status_bare('  13. esteira agil ') = 'ESTEIRA AGIL'
    and public.deal_status_bare('RET. ESTEIRA AGIL') = 'RET. ESTEIRA AGIL'
    and public.deal_status_bare(null) = '',
    'normalização do rótulo igual à do front (sem prefixo, caixa alta)');

  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@esteira.test', '{"full_name":"Admin Esteira"}'),
    (ger, 'ger@esteira.test', '{"full_name":"Gerente Esteira"}'),
    (cor, 'cor@esteira.test', '{"full_name":"Corretor Esteira"}'),
    (cca, 'cca@esteira.test', '{"full_name":"Analista Esteira"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (cca, 'cca')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe Esteira', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow) values ('Construtora Esteira', 'internal')
  returning id into v_dev;
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente Esteira', '11955550201', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '201', 300000);
  reset role;

  -- Testes anteriores fecham meses; o guard de mês fechado não é o assunto aqui.
  delete from public.closed_months where period = v_deal.month_base;

  -- ---------------------------------------------------------------------------
  -- Escrita manual recusada: corretor, com e sem prefixo, e admin.
  -- ---------------------------------------------------------------------------
  foreach v_label in array array['13. ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'esteira agil'] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
    set local role authenticated;
    begin
      update public.deals set status_detail = v_label where id = v_deal.id;
      raise exception 'FALHOU: corretor gravou "%" à mão sem conferência', v_label;
    exception when insufficient_privilege then
      raise notice '  ok  "%" recusado por update direto', v_label;
    end;
    reset role;
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    update public.deals set status_detail = '13. ESTEIRA AGIL' where id = v_deal.id;
    raise exception 'FALHOU: admin gravou o rótulo de esteira sem conferência';
  exception when insufficient_privilege then
    raise notice '  ok  nem admin escolhe o rótulo: é do sistema';
  end;
  -- Os outros rótulos seguem livres.
  update public.deals set status_detail = '16. PENDENTE' where id = v_deal.id;
  reset role;

  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = '16. PENDENTE',
    'rótulo comum continua escolhível');

  -- ---------------------------------------------------------------------------
  -- Semente e serviço escrevem; reenviar o formulário com o valor que já está
  -- lá não pode ser recusado (o modal manda `status_detail` em todo salvar).
  -- ---------------------------------------------------------------------------
  update public.deals set status_detail = '13. ESTEIRA AGIL' where id = v_deal.id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set status_detail = '13. ESTEIRA AGIL', unit = '202' where id = v_deal.id;
  reset role;

  perform pg_temp.check18(
    (select unit from public.deals where id = v_deal.id) = '202',
    'postgres escreve o rótulo e reenviar o mesmo valor não é recusado');

  update public.deals set status_detail = '16. PENDENTE' where id = v_deal.id;

  -- ---------------------------------------------------------------------------
  -- Caminho real: corretor envia, gerente aprova, caso nasce na esteira.
  -- ---------------------------------------------------------------------------
  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, 'esteira/' || v_deal.id || '/' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-cliente.pdf', cor);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;

  perform pg_temp.check18(
    exists (select 1 from public.cca_cases where deal_id = v_deal.id and status = 'under_review'),
    'aprovação do gerente abre o caso na esteira');
  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = '13. ESTEIRA AGIL',
    'entrar na esteira escreve "13. ESTEIRA AGIL"');

  -- ---------------------------------------------------------------------------
  -- O CCA devolve e reenvia: é o update direto da tela do CCA (CcaMoveDialog),
  -- feito por um analista que não tem permissão de editar `deals`.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.cca_cases set status = 'pending_documents' where deal_id = v_deal.id;
  reset role;

  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = 'RET. ESTEIRA AGIL',
    'CCA devolver para "Aguardando documentos" escreve "RET. ESTEIRA AGIL"');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.cca_cases set status = 'under_review' where deal_id = v_deal.id;
  reset role;

  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = '13. ESTEIRA AGIL',
    'reenviar à esteira volta a escrever "13. ESTEIRA AGIL"');

  -- ---------------------------------------------------------------------------
  -- Rótulo de encerramento manda mais que a esteira.
  -- ---------------------------------------------------------------------------
  update public.deals set status_detail = '17. DISTRATO' where id = v_deal.id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.cca_cases set status = 'pending_documents' where deal_id = v_deal.id;
  reset role;

  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = '17. DISTRATO',
    'rótulo de encerramento não é sobrescrito pela esteira');

  -- A conferência aprovada DEIXOU de ser escape (migration 0059).
  --
  -- A 0037 abria a mão quando `document_review_status = 'approved'`, e esse é o
  -- estado de 25 dos 32 negócios da base: na prática o rótulo continuava
  -- digitável à mão na maioria dos casos, que é o oposto do que a 0037 quis
  -- garantir. Quem escreve é o gatilho da esteira, sempre — e ele passa por ser
  -- `security definer`, não por exceção no guard.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    update public.deals set status_detail = '13. ESTEIRA AGIL' where id = v_deal.id;
    raise exception 'FALHOU: conferência aprovada ainda serve de escape para o rótulo do sistema';
  exception when insufficient_privilege then
    raise notice '  ok  nem com conferência aprovada o rótulo é digitado à mão';
  end;
  reset role;

  perform pg_temp.check18(
    (select status_detail from public.deals where id = v_deal.id) = '17. DISTRATO',
    'a recusa não deixa nada gravado pela metade');
end
$$;

\echo 'rótulo de esteira ok'
