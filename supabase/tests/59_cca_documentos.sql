-- =============================================================================
-- 0059 — Esteira CCA e documentos: o laço de volta, o rótulo grudento e a
-- exclusão do documento errado.
--
-- O que a 18 já cobre continua lá. Aqui entram os casos que faltavam:
--   · negócio com conferência APROVADA tentando gravar o rótulo à mão (era a
--     maioria da base: 25 de 32 negócios passavam);
--   · remoção do rótulo com o caso ainda na esteira;
--   · devolução do CCA reabrindo a conferência do gerente (com notificação);
--   · desfecho 'approved' escrevendo Status 2;
--   · exclusão de documento pelo corretor só enquanto o dossiê é dele.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check59(cond boolean, label text)
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

\echo '== esteira CCA: laço de volta e rótulo do sistema =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-00000000f591';
  ger  uuid := '00000000-0000-0000-0000-00000000f592';
  cor  uuid := '00000000-0000-0000-0000-00000000f593';
  ana  uuid := '00000000-0000-0000-0000-00000000f594';
  v_team uuid;
  v_dev  uuid;
  v_lead uuid;
  v_deal public.deals;
  v_type record;
  v_doc  uuid;
  v_doc2 uuid;
  v_falta uuid;
  v_case uuid;
  v_label text;
  v_status text;
  v_qtd  int;
  v_recusou boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@cca59.test', '{"full_name":"Admin 59"}'),
    (ger, 'ger@cca59.test', '{"full_name":"Gerente 59"}'),
    (cor, 'cor@cca59.test', '{"full_name":"Corretor 59"}'),
    (ana, 'ana@cca59.test', '{"full_name":"Analista 59"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (ana, 'cca')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe CCA 59', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow) values ('Construtora CCA 59', 'internal')
  returning id into v_dev;

  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente CCA 59', '11955550599', 'in_progress', cor)
  returning id into v_lead;

  -- ── o negócio nasce pelo caminho real ─────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '59', 400000);
  reset role;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, v_deal.id || '/59-' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-cliente.pdf', cor);
  end loop;

  -- ── 6. o corretor apaga o documento errado enquanto o dossiê é dele ───────
  select id into v_doc from public.deal_documents
   where deal_id = v_deal.id order by created_at limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  delete from public.deal_documents where id = v_doc;
  reset role;

  select count(*) into v_qtd from public.deal_documents where id = v_doc;
  perform pg_temp.check59(v_qtd = 0,
    'corretor apaga documento do próprio negócio enquanto a conferência é rascunho');

  -- Recoloca o obrigatório que acabou de sair, senão o envio ao gerente cai —
  -- em DUAS versões, porque é aí que a exclusão deixava o dossiê sem vigente.
  select dt.id into v_falta from public.document_types dt
   where dt.active and dt.required_for_conversion and not dt.allows_multiple
     and not exists (select 1 from public.deal_documents dd
                     where dd.deal_id = v_deal.id and dd.document_type_id = dt.id
                       and dd.superseded_at is null)
   limit 1;
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal.id, v_falta, v_deal.id || '/59-recolocado-v1.pdf',
          'recolocado.pdf', 'recolocado-v1.pdf', cor)
  returning id into v_doc;
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal.id, v_falta, v_deal.id || '/59-recolocado-v2.pdf',
          'recolocado.pdf', 'recolocado-v2.pdf', cor)
  returning id into v_doc2;

  perform pg_temp.check59(
    (select superseded_at is not null from public.deal_documents where id = v_doc)
    and (select version = 2 from public.deal_documents where id = v_doc2),
    'a segunda versão entra como vigente e manda a primeira para o histórico');

  -- ── apagar a versão VIGENTE reabre a anterior ────────────────────────────
  -- A FK zera `superseded_by` e ninguém zerava `superseded_at`: a v1 ficava
  -- marcada como substituída, o tipo ficava sem vigente, sumia da lista padrão
  -- da aba Anexos e voltava a contar como obrigatório faltando — com o arquivo
  -- ainda no bucket. O botão Excluir só aparece na linha vigente, então este é
  -- o caminho normal, não um canto.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  delete from public.deal_documents where id = v_doc2;
  reset role;

  perform pg_temp.check59(
    (select superseded_at is null and superseded_by is null
       from public.deal_documents where id = v_doc),
    'apagar a versão vigente devolve a anterior ao dossiê');

  select count(*) into v_qtd from public.document_types dt
   where dt.active and dt.required_for_conversion
     and not exists (select 1 from public.deal_documents dd
                     where dd.deal_id = v_deal.id and dd.document_type_id = dt.id
                       and dd.superseded_at is null);
  perform pg_temp.check59(v_qtd = 0,
    'nenhum obrigatório volta a faltar depois de a versão vigente ser apagada');

  -- ── corretor envia, gerente aprova: o caso entra na esteira ───────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  -- Dossiê enviado deixa de ser editável pelo corretor: apagar não faz nada.
  select id into v_doc from public.deal_documents
   where deal_id = v_deal.id order by created_at limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  delete from public.deal_documents where id = v_doc;
  reset role;
  select count(*) into v_qtd from public.deal_documents where id = v_doc;
  perform pg_temp.check59(v_qtd = 1,
    'depois de enviado ao gerente o documento não sai mais pela mão do corretor');

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;

  select id into v_case from public.cca_cases where deal_id = v_deal.id;
  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check59(v_case is not null and v_label = '13. ESTEIRA AGIL',
    'aprovação do gerente cria o caso e o banco escreve "13. ESTEIRA AGIL"');

  -- ── 3. o rótulo é grudento enquanto o caso está na esteira ────────────────
  -- A recusa sai em `P0001` (raise_exception) porque a mensagem é para o
  -- operador ler: `describeError` só preserva a frase própria nesse código.
  -- Conferir o texto, e não só o código, é o que prova que a frase chega.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    update public.deals set status_detail = 'PROPOSTA' where id = v_deal.id;
  exception when raise_exception then
    v_recusou := position('esteira de crédito' in sqlerrm) > 0;
  end;
  reset role;

  perform pg_temp.check59(v_recusou,
    'rótulo da esteira não é apagado em análise, e a recusa chega em pt-BR (P0001)');

  -- ── 4. o desfecho aprovado escreve Status 2 ──────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.cca_cases set status = 'approved', decided_at = now() where id = v_case;
  reset role;

  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check59(v_label = '09. APROV. TOTAL',
    'desfecho aprovado deixa de sair da esteira sem Status 2');

  -- ── 2. escrita manual recusada MESMO com a conferência aprovada ───────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    update public.deals set status_detail = 'RET. ESTEIRA AGIL' where id = v_deal.id;
    raise exception 'FALHOU: negócio com conferência aprovada aceitou o rótulo digitado à mão';
  exception when insufficient_privilege then
    raise notice '  ok  conferência aprovada não é mais escape para escrever o rótulo à mão';
  end;
  reset role;

  -- ── 1. o CCA devolve: a conferência do gerente reabre ─────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.cca_cases
     set status = 'pending_documents', decision_notes = 'Falta comprovante legível'
   where id = v_case;
  reset role;

  select status_detail, document_review_status into v_label, v_status
    from public.deals where id = v_deal.id;
  perform pg_temp.check59(v_label = 'RET. ESTEIRA AGIL' and v_status = 'returned',
    'devolução do CCA reabre a conferência do gerente em vez de travar o corretor');

  select count(*) into v_qtd from public.notifications
   where profile_id = cor and kind = 'document_review_returned'
     and body like '%comprovante legível%';
  perform pg_temp.check59(v_qtd = 1, 'o corretor é notificado da devolução do CCA');

  select count(*) into v_qtd from public.deal_history
   where deal_id = v_deal.id and kind = 'document_review_returned' and to_value = 'returned';
  perform pg_temp.check59(v_qtd >= 1, 'a devolução do CCA fica no histórico do negócio');

  -- ── e o reenvio, que era o beco sem saída, volta a funcionar ─────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  select document_review_status into v_status from public.deals where id = v_deal.id;
  perform pg_temp.check59(v_status = 'pending',
    'depois da devolução do CCA o corretor consegue reenviar ao gerente');

  -- ── exceção deliberada: encerrar o negócio continua permitido ─────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.deals set status_detail = '17. DISTRATO' where id = v_deal.id;
  reset role;

  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check59(v_label = '17. DISTRATO',
    'rótulo de encerramento passa mesmo com o caso na esteira (diálogo de perda)');
end
$$;

\echo '== autorização da esteira e caminho do bucket =='

do $$
declare
  v_qual text;
  v_check text;
begin
  perform pg_temp.check59(
    exists (select 1 from public.role_permissions
             where role = 'director' and permission = 'menu.cca' and allowed)
    and exists (select 1 from public.role_permissions
                 where role = 'manager' and permission = 'menu.cca' and allowed),
    'diretoria e gerência enxergam a esteira');

  perform pg_temp.check59(
    not exists (select 1 from public.role_permissions
                 where role in ('director', 'manager') and permission = 'cca.review' and allowed),
    'diretoria e gerência continuam sem escrever na esteira');

  select pg_get_expr(p.polqual, p.polrelid) into v_qual
    from pg_policy p where p.polname = 'cca_stages_write'
     and p.polrelid = 'public.cca_stages'::regclass;
  perform pg_temp.check59(position('has_permission' in coalesce(v_qual, '')) > 0,
    'gerenciar estágios usa a mesma permissão que mover e enviar (cca.review)');

  -- O botão "Tipos de documento" é liberado por `can('cca.review')`; enquanto a
  -- policy fosse por papel, quem recebesse a permissão via o botão e levava a
  -- recusa do banco.
  select pg_get_expr(p.polqual, p.polrelid) into v_qual
    from pg_policy p where p.polname = 'document_types_write'
     and p.polrelid = 'public.document_types'::regclass;
  perform pg_temp.check59(position('has_permission' in coalesce(v_qual, '')) > 0,
    'o catálogo de tipos de documento usa a mesma permissão do resto da tela');

  perform pg_temp.check59(
    public.deal_id_of_object('11111111-2222-3333-4444-555555555555/1-x.pdf')
      = '11111111-2222-3333-4444-555555555555'::uuid
    and public.deal_id_of_object('qualquer/coisa.pdf') is null
    and public.deal_id_of_object(null) is null,
    'o caminho do bucket só resolve negócio quando o prefixo é um uuid');

  if to_regclass('storage.objects') is null then
    raise notice '  --  storage ausente, with_check do bucket não exercitado';
    return;
  end if;

  select pg_get_expr(p.polwithcheck, p.polrelid) into v_check
    from pg_policy p where p.polname = 'deal_documents_storage'
     and p.polrelid = 'storage.objects'::regclass;
  perform pg_temp.check59(position('deal_id_of_object' in coalesce(v_check, '')) > 0,
    'gravar no bucket deixou de ser livre para qualquer autenticado');

  -- Escrever no bucket tem de cobrar o MESMO que a tabela: `can_see_deal` no
  -- with_check deixaria diretor e sócio (leitura) gravando na pasta de qualquer
  -- negócio, com a linha recusada e o arquivo lá.
  perform pg_temp.check59(
    position('can_edit_deal' in coalesce(v_check, '')) > 0
    and position('can_see_deal' in coalesce(v_check, '')) = 0,
    'escrever no bucket cobra can_edit_deal, igual a deal_documents_insert');

  -- O anexo promovido do lead entra com a chave `<lead_id>/...`: sem este ramo
  -- toda conversão com anexo passaria a falhar para corretor e gerente.
  perform pg_temp.check59(position('lead_attachments' in coalesce(v_check, '')) > 0,
    'a cópia do anexo do lead continua entrando no bucket do negócio');

  -- E o ramo do lead não pode virar prefixo livre: `lead_attachments.storage_
  -- path` é texto escolhido por quem insere e não tem vínculo nenhum com
  -- `lead_id`, então "existe a linha" sozinho deixava o corretor gravar na
  -- pasta de um negócio alheio inserindo a linha no PRÓPRIO lead.
  perform pg_temp.check59(coalesce(v_check, '') ~ 'lead_id[^)]*deal_id_of_object',
    'o ramo do anexo do lead exige que o prefixo seja o próprio lead da linha');
end
$$;

\echo 'esteira CCA e documentos ok'
