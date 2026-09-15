-- =============================================================================
-- 0150 — CCA pelo Status 2 e envio com mensagem nas duas esteiras.
--
--   · as 19 colunas do cliente, na ordem, cada uma com seu Status 2;
--   · mensagem obrigatória no envio e no movimento (a aprovação aceita, sem exigir);
--   · status, coluna, entrada e decisão só mudam pela RPC; a tela não cria nem
--     apaga caso; gravar `analysis` segue livre;
--   · coluna não se liga a DISTRATO, QUEDA, OFF, "13. ESTEIRA AGIL" nem
--     "15. ANÁLISE P/ VIRAR NEGÓCIO"; a "RET. ESTEIRA AGIL", sim;
--   · RETORNO À ESTEIRA ÁGIL grava "RET. ESTEIRA AGIL", devolve ao comercial
--     como PENDENTE e o Status 1 fica PROPOSTA;
--   · Status 2 travado na coluna da análise; negócio perdido e mês fechado não
--     são reescritos pela esteira; 2º envio devolvido volta como virar;
--   · "aprovado" pontua uma vez por negócio, entre temporadas;
--   · mover grava o Status 2 e o Status 1 segue (ASSINADO BANCO → VENDA);
--   · 2º envio (virar) só com crédito aprovado, passa pelo gerente, entra com
--     "15. ANÁLISE P/ VIRAR NEGÓCIO", avisa a CCA e não puxa o negócio de volta;
--   · contador de envios somado por CPF do titular;
--   · envio à construtora externa sem a coluna "Enviado à Construtora".
--
-- Blocos separados de propósito: cada DO é uma transação, e a reentrada na
-- esteira é reconhecida por `submitted_at` novo — dentro da mesma transação
-- `now()` não muda.
--
-- Prefixo 99 e não 150: o laço de scripts/validate-schema.sh só roda
-- `supabase/tests/[0-9][0-9]_*` (mesma nota do 98 e do 99_status_catalogo).
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check150(cond boolean, label text)
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

-- Negócio pronto para o envio: lead convertido pelo corretor, titular com o CPF
-- pedido e todos os documentos obrigatórios.
create or replace function pg_temp.negocio150(p_cor uuid, p_dev uuid, p_unit text, p_cpf text)
returns uuid
language plpgsql
as $$
declare
  v_lead uuid;
  v_deal public.deals;
  v_type record;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 150 ' || p_unit, '1195555' || p_unit, 'in_progress', p_cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', p_cor::text, 'role', 'authenticated')::text, false);
  v_deal := public.convert_lead_to_deal(v_lead, p_dev, null, p_unit, 300000);
  perform set_config('request.jwt.claims', '', false);

  insert into public.deal_clients (deal_id, ordinal, full_name, cpf)
  values (v_deal.id, 1, 'Cliente 150 ' || p_unit, p_cpf)
  on conflict (deal_id, ordinal) do update set cpf = excluded.cpf;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, v_deal.id || '/150-' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-150.pdf', p_cor);
  end loop;

  return v_deal.id;
end;
$$;

\echo '== 0150: colunas da CCA e superfície das RPCs =='

do $$
declare
  v_nomes text[];
begin
  select array_agg(s.name order by s.position) into v_nomes
    from public.cca_stages s
   where s.active and s.deal_status_id is not null;

  perform pg_temp.check150(v_nomes = array[
      'EM ANÁLISE', 'PENDENTE', 'RETORNO À ESTEIRA ÁGIL', 'EM PROCESSAMENTO',
      'AGUARDANDO RETORNO AGÊNCIA',
      'APROVADO TOTAL', 'APROVADO POTENCIAL', 'APROVADO CONDICIONADO',
      'APROVADO TOTAL COM RESTRIÇÃO', 'APROVADO CONDICIONADO COM RESTRIÇÃO',
      'REPROVADO', 'BACEN', 'VIROU NEGÓCIO', 'VIROU NEGÓCIO COM PENDÊNCIAS',
      'ANÁLISE CEOPF', 'INCONFORME CEOPF', 'APROVADO/AGUARDANDO AGENDA',
      'ENTREVISTA AGENDADA', 'ASSINADO BANCO'],
    'as 19 colunas do cliente estão ativas, na ordem, cada uma com seu Status 2');

  perform pg_temp.check150(
    (select s.status = 'pending_documents' and ds.value = 'RET. ESTEIRA AGIL'
            and ds.label = 'RETORNO À ESTEIRA ÁGIL'
       from public.cca_stages s
       join public.deal_statuses ds on ds.id = s.deal_status_id
      where s.name = 'RETORNO À ESTEIRA ÁGIL' and s.active),
    'RETORNO À ESTEIRA ÁGIL é pendência e grava "RET. ESTEIRA AGIL", exibido como "RETORNO À ESTEIRA ÁGIL"');

  -- O seed deste banco recria "Enviado à Construtora" (status sem estágio): é a
  -- coluna do fluxo externo, a única que pode seguir ativa sem Status 2.
  perform pg_temp.check150(
    not exists (select 1 from public.cca_stages
                 where active and deal_status_id is null and status <> 'sent_to_developer'),
    'nenhum estágio antigo segue ativo');

  perform pg_temp.check150(
    (select ds.value from public.cca_stages s
       join public.deal_statuses ds on ds.id = s.deal_status_id
      where s.name = 'ASSINADO BANCO') = '02. ASS. BANCO'
    and (select ds.value from public.cca_stages s
           join public.deal_statuses ds on ds.id = s.deal_status_id
          where s.name = 'EM ANÁLISE') = 'EM ANÁLISE',
    'a coluna aponta o Status 2 do cliente (ASSINADO BANCO → "02. ASS. BANCO"; EM ANÁLISE, novo no catálogo)');

  perform pg_temp.check150(
    not has_function_privilege('anon', 'public.move_cca_case(uuid,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.cca_send_counts(uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.submit_deal_for_manager_review(uuid,text,text)', 'execute')
    and has_function_privilege('authenticated', 'public.move_cca_case(uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.cca_send_counts(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.submit_deal_for_manager_review(uuid,text,text)', 'execute'),
    'anon não executa as RPCs novas; a tela logada executa');

  perform pg_temp.check150(
    to_regprocedure('public.submit_deal_for_manager_review(uuid)') is null,
    'o envio sem mensagem (assinatura antiga) não existe mais');
end;
$$;

\echo '== 0150: 1º envio, aprovação e movimento com mensagem =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000150001';
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_assinado   uuid := (select id from public.cca_stages where name = 'ASSINADO BANCO' and active);
  v_em_analise uuid := (select id from public.cca_stages where name = 'EM ANÁLISE' and active);
  v_team       uuid;
  v_int        uuid;
  v_a          uuid;
  v_b          uuid;
  v_case       public.cca_cases;
  v_qtd        int;
  v_linhas     int;
  v_sem_msg    boolean;
  v_sem_credito boolean;
  v_sem_status boolean;
  v_sem_coluna boolean;
  v_recusou    boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@cca150.test', '{"full_name":"Admin 150"}'),
    (ger, 'ger@cca150.test', '{"full_name":"Gerente 150"}'),
    (cor, 'cor@cca150.test', '{"full_name":"Corretor 150"}'),
    (ana, 'ana@cca150.test', '{"full_name":"Analista 150"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (ana, 'cca')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe CCA 150', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow) values ('Construtora Interna 150', 'internal')
  returning id into v_int;
  insert into public.developers (name, flow, submission_email)
  values ('Construtora Externa 150', 'external', 'credito@externa150.test');

  delete from public.closed_months where period = public.month_start(current_date);

  -- Mesmo CPF com e sem máscara: o contador compara só os dígitos.
  v_a := pg_temp.negocio150(cor, v_int, '1501', '123.456.789-09');
  v_b := pg_temp.negocio150(cor, v_int, '1502', '12345678909');

  -- ── envio ao gerente ──────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  v_sem_msg := false;
  begin
    perform public.submit_deal_for_manager_review(v_a, '   ');
  exception when raise_exception then
    v_sem_msg := position('mensagem do envio' in sqlerrm) > 0;
  end;

  v_sem_credito := false;
  begin
    perform public.submit_deal_for_manager_review(v_a, 'Cliente com renda comprovada', 'virar');
  exception when raise_exception then
    v_sem_credito := position('crédito aprovado' in sqlerrm) > 0;
  end;

  perform public.submit_deal_for_manager_review(v_a, 'Cliente com renda comprovada');
  perform public.submit_deal_for_manager_review(v_b, 'Mesmo cliente, outra unidade');
  reset role;

  perform pg_temp.check150(v_sem_msg,
    'enviar ao gerente sem mensagem é recusado, com a frase em pt-BR');
  perform pg_temp.check150(v_sem_credito,
    'o 2º envio (virar) é recusado sem crédito aprovado na CCA');
  perform pg_temp.check150(
    (select document_review_status = 'pending' and review_esteira = 'agil'
       from public.deals where id = v_a),
    'o 1º envio vai ao gerente pela esteira ágil');
  perform pg_temp.check150(
    exists (select 1 from public.deal_history
             where deal_id = v_a and kind = 'comment' and actor_id = cor
               and to_value = 'ENVIO ESTEIRA ÁGIL: Cliente com renda comprovada'),
    'a mensagem do envio fica no negócio como comentário');
  perform pg_temp.check150(
    exists (select 1 from public.notifications
             where profile_id = ger and kind = 'document_review_requested'
               and body like '%Cliente com renda comprovada%'),
    'o aviso ao gerente leva a mensagem');

  -- ── conferência do gerente ────────────────────────────────────────────────
  select count(*) into v_qtd from public.notifications
   where profile_id = ana and kind = 'cca_pending';

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  -- A mensagem da aprovação é opcional (o pedido só a cobra no envio); quando
  -- vem, fica no negócio. Aprovar sem texto segue coberto no 12, 18, 59 e 77.
  perform public.review_deal_documents(v_a, true, 'Documentação conferida');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_a;
  perform pg_temp.check150(v_case.status = 'under_review' and v_case.stage_id = v_em_analise,
    'a aprovação do gerente abre o caso na coluna EM ANÁLISE');
  perform pg_temp.check150(
    (select status_detail from public.deals where id = v_a) = '13. ESTEIRA AGIL',
    'o 1º envio entra na CCA com "13. ESTEIRA AGIL"');
  perform pg_temp.check150(
    exists (select 1 from public.deal_history
             where deal_id = v_a and kind = 'comment' and actor_id = ger
               and to_value = 'APROVADO PELO GERENTE: Documentação conferida'),
    'a mensagem da aprovação fica no negócio');
  perform pg_temp.check150(
    (select count(*) from public.notifications
      where profile_id = ana and kind = 'cca_pending') = v_qtd + 1,
    'a entrada avisa a CCA uma vez só');

  -- ── trava do caso: status e coluna só pela RPC ────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  v_sem_status := false;
  begin
    update public.cca_cases set status = 'approved', decided_at = now() where id = v_case.id;
  exception when insufficient_privilege then
    v_sem_status := true;
  end;

  v_sem_coluna := false;
  begin
    update public.cca_cases set stage_id = v_assinado where id = v_case.id;
  exception when insufficient_privilege then
    v_sem_coluna := true;
  end;

  update public.cca_cases set analysis = '{"renda": 5000}'::jsonb where id = v_case.id;
  get diagnostics v_linhas = row_count;

  v_sem_msg := false;
  begin
    perform public.move_cca_case(v_case.id, v_assinado, ' ');
  exception when raise_exception then
    v_sem_msg := position('mensagem da movimentação' in sqlerrm) > 0;
  end;
  reset role;

  perform pg_temp.check150(v_sem_status, 'o analista não muda o status do caso por update direto');
  perform pg_temp.check150(v_sem_coluna, 'nem a coluna');
  perform pg_temp.check150(
    v_linhas = 1
    and (select analysis ->> 'renda' from public.cca_cases where id = v_case.id) = '5000',
    'gravar só a análise do caso continua liberado');
  perform pg_temp.check150(v_sem_msg, 'mover o caso sem mensagem é recusado');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    perform public.move_cca_case(v_case.id, v_assinado, 'Tentativa do corretor');
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check150(v_recusou, 'corretor não move caso na CCA');

  -- ── mover grava o Status 2 da coluna, e o Status 1 segue ──────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case.id, v_assinado, 'Contrato assinado no banco');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_a;
  perform pg_temp.check150(
    v_case.stage_id = v_assinado and v_case.status = 'approved'
    and v_case.decided_at is not null and v_case.decision_notes = 'Contrato assinado no banco',
    'mover grava a coluna, o desfecho da coluna, a data da decisão e a mensagem no caso');
  perform pg_temp.check150(
    (select d.status_detail = '02. ASS. BANCO' and g.code = 'VENDA'
       from public.deals d
       join public.deal_status_groups g on g.id = d.status_group_id
      where d.id = v_a),
    'ASSINADO BANCO grava "02. ASS. BANCO" e o Status 1 segue sozinho para VENDA');
  perform pg_temp.check150(
    exists (select 1 from public.deal_history
             where deal_id = v_a and kind = 'comment' and actor_id = ana
               and to_value = 'STATUS: ASSINADO BANCO — Contrato assinado no banco'),
    'o movimento fica no negócio como comentário com a coluna e a mensagem');
  perform pg_temp.check150(
    (select count(distinct profile_id) from public.notifications
      where kind = 'cca_status_changed' and profile_id in (cor, ger)
        and body like '%Contrato assinado no banco%') = 2,
    'corretor e gerente recebem o aviso com a mensagem');
  perform pg_temp.check150(
    (select count(*) from public.notifications
      where kind = 'cca_status_changed' and profile_id = cor) = 1,
    'e um aviso só: o genérico de mudança de status não sai junto');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    update public.deals set status_detail = '15. ANÁLISE P/ VIRAR NEGÓCIO' where id = v_a;
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check150(v_recusou,
    'nem o admin marca "15. ANÁLISE P/ VIRAR NEGÓCIO" à mão: é rótulo do sistema');

  -- O funil andou até Contrato. Sem sessão: a matriz de etapas não é o assunto.
  perform set_config('request.jwt.claims', '', false);
  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = 'contract')
   where id = v_a;
end;
$$;

\echo '== 0150: 2º envio (análise p/ virar negócio) e contador por CPF =='

do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_int     uuid := (select id from public.developers where name = 'Construtora Interna 150');
  v_a       uuid;
  v_b       uuid;
  v_case    public.cca_cases;
  v_qtd     int;
  v_agil    int;
  v_virar   int;
  v_recusou boolean;
begin
  select id into v_a from public.deals where developer_id = v_int and unit = '1501';
  select id into v_b from public.deals where developer_id = v_int and unit = '1502';

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_a, 'Cliente pronto para virar negócio', 'virar');
  reset role;

  perform pg_temp.check150(
    (select document_review_status = 'pending' and review_esteira = 'virar'
       from public.deals where id = v_a),
    'com crédito aprovado, o dossiê já aprovado volta ao gerente pela esteira virar');
  perform pg_temp.check150(
    exists (select 1 from public.deal_history
             where deal_id = v_a and kind = 'comment'
               and to_value = 'ENVIO ANÁLISE P/ VIRAR NEGÓCIO: Cliente pronto para virar negócio'),
    'a mensagem do 2º envio fica no negócio');
  perform pg_temp.check150(
    (select status from public.cca_cases where deal_id = v_a) = 'approved',
    'o caso segue aprovado até o gerente conferir o 2º envio');

  select count(*) into v_qtd from public.notifications
   where profile_id = ana and kind = 'cca_pending';

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_a, true, 'Pode virar negócio');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_a;
  perform pg_temp.check150(
    v_case.status = 'under_review' and v_case.decided_at is null
    and v_case.stage_id = (select id from public.cca_stages where name = 'EM ANÁLISE' and active),
    'aprovado pelo gerente, o 2º envio reabre o caso em EM ANÁLISE');
  perform pg_temp.check150(
    (select status_detail from public.deals where id = v_a) = '15. ANÁLISE P/ VIRAR NEGÓCIO',
    'e entra com "15. ANÁLISE P/ VIRAR NEGÓCIO"');
  perform pg_temp.check150(
    (select count(*) from public.notifications
      where profile_id = ana and kind = 'cca_pending') = v_qtd + 1,
    'a reentrada avisa a CCA (antes só o INSERT do caso avisava)');
  perform pg_temp.check150(
    (select s.code from public.deals d
       join public.pipeline_stages s on s.id = d.stage_id
      where d.id = v_a) = 'contract',
    'negócio em Contrato não é puxado de volta para Em análise');

  -- ── contador ──────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select c.agil, c.virar into v_agil, v_virar
    from public.cca_send_counts() c where c.deal_id = v_a;
  select count(*) into v_qtd from public.cca_send_counts() c where c.deal_id = v_b;
  reset role;

  perform pg_temp.check150(v_agil = 2 and v_virar = 1,
    'o contador soma os envios de todos os negócios do mesmo CPF (2 ágeis, 1 virar)');
  perform pg_temp.check150(v_qtd = 0,
    'negócio sem caso na CCA não aparece no contador');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    perform * from public.cca_send_counts();
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check150(v_recusou, 'corretor não lê o contador da CCA');
end;
$$;

\echo '== 0150: envio à construtora externa sem a coluna "Enviado à Construtora" =='

do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_ext        uuid := (select id from public.developers where name = 'Construtora Externa 150');
  v_desligadas uuid[];
  v_e          uuid;
  v_case       public.cca_cases;
  v_agil       int;
  v_virar      int;
begin
  -- A homologação não tem construtora externa, e a 0150 desliga a coluna nesse
  -- caso. O seed deste banco a recria; aqui ela sai do ar para medir o cenário
  -- real e volta no fim.
  select array_agg(id) into v_desligadas
    from public.cca_stages where status = 'sent_to_developer' and active;
  update public.cca_stages set active = false where id = any (v_desligadas);

  v_e := pg_temp.negocio150(cor, v_ext, '1503', null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_e, 'Dossiê para a construtora');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_e, true, 'Pode seguir para a construtora');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_e;
  perform pg_temp.check150(
    v_case.status = 'sent_to_developer'
    and v_case.stage_id = (select id from public.cca_stages where name = 'EM ANÁLISE' and active),
    'sem a coluna da construtora o caso externo entra em EM ANÁLISE, com o status do fluxo externo');
  perform pg_temp.check150(
    exists (select 1 from public.developer_submissions where deal_id = v_e),
    'e o dossiê segue para a fila de e-mail da construtora');
  perform pg_temp.check150(
    (select status_detail from public.deals where id = v_e) = 'ANÁLISE EXTERNA',
    'com o mesmo rótulo "ANÁLISE EXTERNA" de antes');

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select c.agil, c.virar into v_agil, v_virar
    from public.cca_send_counts() c where c.deal_id = v_e;
  reset role;

  perform pg_temp.check150(v_agil = 1 and v_virar = 0,
    'negócio sem CPF conta só os próprios envios');

  -- O sistema continua mudando o caso por fora da RPC.
  set local role service_role;
  update public.cca_cases set status = 'sent_to_agency' where id = v_case.id;
  reset role;

  perform pg_temp.check150(
    (select status from public.cca_cases where id = v_case.id) = 'sent_to_agency',
    'service_role continua passando pela trava do caso');

  update public.cca_stages set active = true where id = any (v_desligadas);
end;
$$;

\echo '== 0150: reentrada externa segue com "ANÁLISE EXTERNA" =='

-- Bloco próprio: a reentrada só é reconhecida com `submitted_at` de outra
-- transação. A CCA devolve, o gerente reaprova e o caso volta pelo fluxo
-- externo caindo em EM ANÁLISE — o rótulo é o do fluxo, não o da coluna.
do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_ext        uuid := (select id from public.developers where name = 'Construtora Externa 150');
  v_desligadas uuid[];
  v_e          uuid;
  v_case       public.cca_cases;
begin
  select array_agg(id) into v_desligadas
    from public.cca_stages where status = 'sent_to_developer' and active;
  update public.cca_stages set active = false where id = any (v_desligadas);

  select id into v_e from public.deals where developer_id = v_ext and unit = '1503';
  select * into v_case from public.cca_cases where deal_id = v_e;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case.id,
    (select id from public.cca_stages where name = 'PENDENTE' and active),
    'Falta a matrícula do imóvel');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_e, 'Matrícula anexada');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_e, true, 'Pode voltar para a construtora');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_e;
  perform pg_temp.check150(
    v_case.status = 'sent_to_developer'
    and v_case.stage_id = (select id from public.cca_stages where name = 'EM ANÁLISE' and active),
    'a reentrada externa volta para EM ANÁLISE com o status do fluxo externo');
  perform pg_temp.check150(
    (select status_detail from public.deals where id = v_e) = 'ANÁLISE EXTERNA',
    format('e o rótulo segue "ANÁLISE EXTERNA", não o Status 2 da coluna (veio %s)',
           (select status_detail from public.deals where id = v_e)));

  update public.cca_stages set active = true where id = any (v_desligadas);
end;
$$;

\echo '== 0150: travas da coluna, do caso, do Status 2 e dos pontos =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000150001';
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_int     uuid := (select id from public.developers where name = 'Construtora Interna 150');
  v_proc    uuid := (select id from public.cca_stages where name = 'EM PROCESSAMENTO' and active);
  v_agencia uuid := (select id from public.cca_stages where name = 'AGUARDANDO RETORNO AGÊNCIA' and active);
  v_repr    uuid := (select id from public.cca_stages where name = 'REPROVADO' and active);
  v_pend    uuid := (select id from public.cca_stages where name = 'PENDENTE' and active);
  v_total   uuid := (select id from public.cca_stages where name = 'APROVADO TOTAL' and active);
  v_ret     uuid := (select id from public.cca_stages where name = 'RETORNO À ESTEIRA ÁGIL' and active);
  v_a       uuid;
  v_b       uuid;
  v_d       uuid;
  v_case    uuid;
  v_case_a  uuid;
  v_mes     date;
  v_state   text;
  v_msg     text;
  v_linhas  int;
begin
  select id into v_a from public.deals where developer_id = v_int and unit = '1501';
  select id into v_b from public.deals where developer_id = v_int and unit = '1502';
  select id into v_case_a from public.cca_cases where deal_id = v_a;

  v_d := pg_temp.negocio150(cor, v_int, '1504', '98765432100');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_d, 'Envio da unidade 1504');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_d, true, null);
  reset role;

  select id into v_case from public.cca_cases where deal_id = v_d;

  -- ── coluna ligada a desfecho ou a rótulo do sistema ───────────────────────
  -- O gatilho da esteira grava como postgres: a ligação passaria por cima da
  -- trava de OFF/DISTRATO e da de rótulo do sistema. Desde a 0151 só admin e
  -- sócio escrevem coluna, e a trava vale para eles também.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_state := '';
  begin
    update public.cca_stages
       set deal_status_id = (select id from public.deal_statuses where value = '17. DISTRATO')
     where id = v_repr;
    v_state := v_state || 'DISTRATO passou;';
  exception when raise_exception then null;
  end;
  begin
    update public.cca_stages
       set deal_status_id = (select id from public.deal_statuses where value = '15. ANÁLISE P/ VIRAR NEGÓCIO')
     where id = v_repr;
    v_state := v_state || 'VIRAR passou;';
  exception when raise_exception then null;
  end;
  begin
    update public.cca_stages
       set deal_status_id = (select id from public.deal_statuses where value = '13. ESTEIRA AGIL')
     where id = v_repr;
    v_state := v_state || 'ESTEIRA AGIL passou;';
  exception when raise_exception then null;
  end;
  begin
    insert into public.cca_stages (name, color, position, status, active, deal_status_id)
    values ('QUEDA 150', 'danger', 50, 'rejected', true,
            (select id from public.deal_statuses where value = '18. QUEDA'));
    v_state := v_state || 'QUEDA passou;';
  exception when raise_exception then null;
  end;

  -- "RET. ESTEIRA AGIL" pode (15/09): religar a coluna RETORNO À ESTEIRA ÁGIL
  -- pela tela passa pelo gatilho. `row_count` porque UPDATE barrado pela RLS
  -- não dá erro e deixaria a ligação da migration de pé.
  v_msg := null;
  begin
    update public.cca_stages set deal_status_id = null where id = v_ret;
    update public.cca_stages
       set deal_status_id = (select id from public.deal_statuses where value = 'RET. ESTEIRA AGIL')
     where id = v_ret;
    get diagnostics v_linhas = row_count;
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check150(
    v_state = ''
    and (select ds.value from public.cca_stages s
           join public.deal_statuses ds on ds.id = s.deal_status_id
          where s.id = v_repr) = '19. REPROVADO',
    format('o administrador não liga coluna a DISTRATO, QUEDA, "13. ESTEIRA AGIL" nem "15. ANÁLISE P/ VIRAR NEGÓCIO" (%s)', nullif(v_state, '')));
  perform pg_temp.check150(
    v_msg is null and v_linhas = 1
    and (select ds.value from public.cca_stages s
           join public.deal_statuses ds on ds.id = s.deal_status_id
          where s.id = v_ret) = 'RET. ESTEIRA AGIL',
    format('o administrador liga coluna a "RET. ESTEIRA AGIL" (%s)', coalesce(v_msg, 'aceito')));

  -- ── a tela não cria, não apaga e não reescreve a entrada do caso ──────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_state := '';
  begin
    delete from public.cca_cases where id = v_case;
    v_state := v_state || 'DELETE passou;';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.cca_cases (deal_id) values (v_b);
    v_state := v_state || 'INSERT passou;';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.cca_cases set submitted_at = now() - interval '1 day' where id = v_case;
    v_state := v_state || 'submitted_at passou;';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.cca_cases set deal_id = v_b where id = v_case;
    v_state := v_state || 'deal_id passou;';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.check150(
    v_state = ''
    and exists (select 1 from public.cca_cases where id = v_case and deal_id = v_d)
    and not exists (select 1 from public.cca_cases where deal_id = v_b),
    format('o analista não apaga nem cria caso, nem reescreve entrada ou negócio por PATCH (%s)', nullif(v_state, '')));

  -- ── Status 2 travado com o caso numa coluna da análise ────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case, v_proc, 'Processando no banco');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_msg := null;
  begin
    update public.deals set status_detail = '03. ASSINADO' where id = v_d;
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check150(
    v_msg like '%esteira de crédito%'
    and (select status_detail from public.deals where id = v_d) = '12. EM PROCESSAMENTO',
    format('com o caso em EM PROCESSAMENTO o corretor não troca o Status 2 da coluna (%s)', coalesce(v_msg, 'passou')));

  -- ── mês fechado: o caso anda, o Status 2 do negócio fica ─────────────────
  select month_base into v_mes from public.deals where id = v_d;
  insert into public.closed_months (period) values (v_mes) on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case, v_agencia, 'Enviado para a agência');
  reset role;

  delete from public.closed_months where period = v_mes;

  perform pg_temp.check150(
    (select stage_id from public.cca_cases where id = v_case) = v_agencia
    and (select status_detail from public.deals where id = v_d) = '12. EM PROCESSAMENTO',
    'em mês fechado o analista move o caso e o Status 2 do negócio fica como estava');

  -- ── negócio perdido: o motivo da perda fica ───────────────────────────────
  -- Sem sessão: a matriz de etapas não é o assunto.
  perform set_config('request.jwt.claims', '', false);
  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = 'lost'),
         status_detail = '19. REPROVADO', lost_reason = '19. REPROVADO'
   where id = v_d;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case, v_proc, 'Reanálise pedida pelo banco');
  reset role;

  perform pg_temp.check150(
    (select status_detail from public.deals where id = v_d) = '19. REPROVADO',
    'mover o caso de negócio perdido não troca o "19. REPROVADO" da perda');

  -- ── 2º envio devolvido pela CCA volta pela mesma esteira ──────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case_a, v_pend, 'Falta o contrato social');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_msg := null;
  begin
    perform public.submit_deal_for_manager_review(v_a, 'Contrato social anexado', 'virar');
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check150(
    v_msg is null
    and (select document_review_status = 'pending' and review_esteira = 'virar'
           from public.deals where id = v_a),
    format('devolvido o 2º envio, o corretor reenvia pela esteira virar (%s)', coalesce(v_msg, 'aceito')));

  -- ── "aprovado" pontua uma vez por negócio, entre temporadas ──────────────
  if public.current_game_season() is null then
    insert into public.game_seasons (label, period_start) values ('Temporada 150 (anterior)', current_date);
  end if;
  insert into public.game_events (season_id, profile_id, event_code, points, ref_type, ref_id)
  values (public.current_game_season(), cor, 'aprovado', 1, 'deal', v_a)
  on conflict do nothing;

  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;
  insert into public.game_seasons (label, period_start) values ('Temporada 150', current_date);

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case_a, v_total, 'Aprovado de novo');
  perform public.move_cca_case(v_case, v_total, 'Aprovado na reanálise');
  reset role;

  perform pg_temp.check150(
    not exists (select 1 from public.game_events
                 where season_id = public.current_game_season() and profile_id = cor
                   and event_code = 'aprovado' and ref_id = v_a)
    and exists (select 1 from public.game_events
                 where season_id = public.current_game_season() and profile_id = cor
                   and event_code = 'aprovado' and ref_id = v_d),
    'crédito aprovado em temporada fechada não pontua "aprovado" de novo; o primeiro aprovado pontua');
end;
$$;

\echo '== 0150: RETORNO À ESTEIRA ÁGIL devolve ao comercial =='

do $$
declare
  ger  uuid := '00000000-0000-0000-0000-000000150002';
  cor  uuid := '00000000-0000-0000-0000-000000150003';
  ana  uuid := '00000000-0000-0000-0000-000000150004';
  v_int     uuid := (select id from public.developers where name = 'Construtora Interna 150');
  v_ret     uuid := (select id from public.cca_stages where name = 'RETORNO À ESTEIRA ÁGIL' and active);
  v_b       uuid;
  v_r       uuid;
  v_case    public.cca_cases;
  v_recusou boolean;
  v_msg     text;
begin
  select id into v_b from public.deals where developer_id = v_int and unit = '1502';
  v_r := pg_temp.negocio150(cor, v_int, '1505', null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_r, 'Envio da unidade 1505');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_r, true, null);
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_r;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case.id, v_ret, 'Voltou para o comercial ajustar a renda');
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_r;
  perform pg_temp.check150(
    v_case.stage_id = v_ret and v_case.status = 'pending_documents' and v_case.decided_at is null,
    'mover para RETORNO À ESTEIRA ÁGIL deixa o caso em pendência, como PENDENTE');
  perform pg_temp.check150(
    (select d.status_detail = 'RET. ESTEIRA AGIL' and g.code = 'PROPOSTA'
       from public.deals d
       join public.deal_status_groups g on g.id = d.status_group_id
      where d.id = v_r),
    'a coluna grava "RET. ESTEIRA AGIL" e o Status 1 fica PROPOSTA');
  perform pg_temp.check150(
    (select document_review_status from public.deals where id = v_r) = 'returned'
    and exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'document_review_returned'
                   and body like '%ajustar a renda%'),
    'devolve ao comercial: a conferência do gerente reabre e o corretor é avisado com a mensagem');
  perform pg_temp.check150(
    not exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'cca_status_changed'
                   and body like '%ajustar a renda%')
    and exists (select 1 from public.notifications
                 where profile_id = ger and kind = 'cca_status_changed'
                   and body like '%ajustar a renda%'),
    'o corretor recebe só a devolução, sem o aviso do movimento junto; o gerente recebe o movimento');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    update public.deals set status_detail = 'RET. ESTEIRA AGIL' where id = v_b;
  exception when insufficient_privilege then
    v_recusou := true;
  end;

  v_msg := null;
  begin
    perform public.submit_deal_for_manager_review(v_r, 'Renda ajustada');
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check150(v_recusou,
    'à mão o corretor segue sem marcar "RET. ESTEIRA AGIL": só a coluna o grava');
  perform pg_temp.check150(
    v_msg is null
    and (select document_review_status = 'pending' and review_esteira = 'agil'
           from public.deals where id = v_r),
    format('devolvido pelo retorno, o corretor reenvia pela esteira ágil (%s)', coalesce(v_msg, 'aceito')));
end;
$$;

\echo '== 0150: caso importado em pendência com a conferência aprovada =='

-- Bloco próprio: o dedupe do aviso compara `created_at >= now()`, e a devolução
-- do bloco anterior teria o mesmo instante. PENDENTE → RETORNO À ESTEIRA ÁGIL
-- não muda o status: sem reabrir na troca de coluna, o corretor ficava sem
-- reenvio (ágil recusa conferência aprovada; virar exige crédito aprovado).
do $$
declare
  ger    uuid := '00000000-0000-0000-0000-000000150002';
  cor    uuid := '00000000-0000-0000-0000-000000150003';
  ana    uuid := '00000000-0000-0000-0000-000000150004';
  v_int  uuid := (select id from public.developers where name = 'Construtora Interna 150');
  v_pend uuid := (select id from public.cca_stages where name = 'PENDENTE' and active);
  v_ret  uuid := (select id from public.cca_stages where name = 'RETORNO À ESTEIRA ÁGIL' and active);
  v_r    uuid;
  v_case uuid;
  v_msg  text;
begin
  select id into v_r from public.deals where developer_id = v_int and unit = '1505';
  select id into v_case from public.cca_cases where deal_id = v_r;

  -- O estado da importação do Bubble: caso em PENDENTE com a conferência
  -- aprovada. Nesta ordem, para a própria montagem não devolver.
  perform set_config('request.jwt.claims', '', false);
  update public.cca_cases set stage_id = v_pend where id = v_case;
  update public.deals set document_review_status = 'approved' where id = v_r;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.move_cca_case(v_case, v_ret, 'Retorno do caso importado');
  reset role;

  perform pg_temp.check150(
    (select document_review_status from public.deals where id = v_r) = 'returned'
    and (select count(*) from public.notifications
          where profile_id = cor and kind = 'document_review_returned'
            and body like '%caso importado%') = 1,
    'de PENDENTE para RETORNO À ESTEIRA ÁGIL (mesmo status) a conferência aprovada reabre e o corretor é avisado');
  perform pg_temp.check150(
    not exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'cca_status_changed'
                   and body like '%caso importado%')
    and exists (select 1 from public.notifications
                 where profile_id = ger and kind = 'cca_status_changed'
                   and body like '%caso importado%'),
    'e o corretor não recebe o aviso do movimento junto; o gerente recebe');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_msg := null;
  begin
    perform public.submit_deal_for_manager_review(v_r, 'Reenvio do caso importado');
  exception when raise_exception then
    v_msg := sqlerrm;
  end;
  reset role;

  perform pg_temp.check150(
    v_msg is null
    and (select document_review_status from public.deals where id = v_r) = 'pending',
    format('devolvido, o caso importado volta a ser reenviado pela esteira ágil (%s)', coalesce(v_msg, 'aceito')));
end;
$$;

\echo 'OK 150 · colunas da CCA, envio com mensagem e contador por CPF'
