-- =============================================================================
-- 0077 — O funil externo na esteira, o envio que move o caso e o dossiê que
-- para de aceitar arquivo depois de conferido.
--
-- O que a 59 já cobre continua lá (rótulo grudento, laço de volta, exclusão do
-- documento errado). Aqui entram os casos que faltavam:
--   · aprovar negócio de construtora EXTERNA cria caso, cartão e rótulo;
--   · "ANÁLISE EXTERNA" no envio à construtora e à agência;
--   · enfileirar o dossiê move o caso em andamento, e NÃO mexe no já decidido;
--   · anexar depois do envio ao gerente é recusado (e o CCA continua podendo);
--   · o caso nasce com `stage_id`, em vez de depender do fallback da tela.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check77(cond boolean, label text)
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

\echo '== 0077: esteira externa, envio e trava do dossiê =='

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-00000000f771';
  ger   uuid := '00000000-0000-0000-0000-00000000f772';
  cor   uuid := '00000000-0000-0000-0000-00000000f773';
  ana   uuid := '00000000-0000-0000-0000-00000000f774';
  v_team    uuid;
  v_ext     uuid;
  v_int     uuid;
  v_lead    uuid;
  v_deal    public.deals;
  v_deal2   public.deals;
  v_type    record;
  v_case    public.cca_cases;
  v_case2   public.cca_cases;
  v_label   text;
  v_qtd     int;
  v_email   text;
  v_stage   uuid;
  v_recusou boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@cca77.test', '{"full_name":"Admin 77"}'),
    (ger, 'ger@cca77.test', '{"full_name":"Gerente 77"}'),
    (cor, 'cor@cca77.test', '{"full_name":"Corretor 77"}'),
    (ana, 'ana@cca77.test', '{"full_name":"Analista 77"}');

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cor, 'broker'), (ana, 'cca')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe CCA 77', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.developers (name, flow, submission_email)
  values ('Construtora Externa 77', 'external', 'credito@externa77.test')
  returning id into v_ext;

  insert into public.developers (name, flow)
  values ('Construtora Interna 77', 'internal')
  returning id into v_int;

  delete from public.closed_months where period = public.month_start(current_date);

  -- ── negócio EXTERNO pelo caminho real ────────────────────────────────────
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente CCA 77', '11955550777', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_ext, null, '77E', 400000);
  reset role;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal.id, v_type.id, v_deal.id || '/77-' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-externo.pdf', cor);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id);
  reset role;

  -- ── 4. dossiê enviado não recebe mais arquivo pela mão do corretor ────────
  -- O DELETE já era recusado desde a 0059; o INSERT continuava aberto, e é o
  -- que troca a versão que o gerente está conferindo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_recusou := false;
  begin
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal.id,
            (select id from public.document_types where active order by sort_order limit 1),
            v_deal.id || '/77-troca.pdf', 'troca.pdf', 'troca.pdf', cor);
  exception when insufficient_privilege then
    v_recusou := true;
  end;
  reset role;

  perform pg_temp.check77(v_recusou,
    'depois de enviado ao gerente o corretor não anexa mais no dossiê');

  -- E o CCA continua podendo juntar documento: retorno do banco e laudo chegam
  -- quando o dossiê já saiu da mão do corretor.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.deal_documents
    (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
  values (v_deal.id,
          (select id from public.document_types where active order by sort_order limit 1),
          v_deal.id || '/77-laudo.pdf', 'laudo.pdf', 'laudo.pdf', ana);
  reset role;
  select count(*) into v_qtd from public.deal_documents
   where deal_id = v_deal.id and stored_name = 'laudo.pdf';
  perform pg_temp.check77(v_qtd = 1,
    'quem tem cca.review continua juntando documento com o dossiê já enviado');

  -- ── 1. aprovar externo cria o caso, o envio e o rótulo ───────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;

  select * into v_case from public.cca_cases where deal_id = v_deal.id;
  perform pg_temp.check77(v_case.id is not null,
    'negócio de construtora externa passa a ter caso na esteira');
  perform pg_temp.check77(v_case.status = 'sent_to_developer',
    'o caso externo nasce em "Enviado à Construtora"');
  perform pg_temp.check77(v_case.stage_id is not null,
    'o caso nasce com estágio gravado, sem depender do fallback da tela');

  select to_email into v_email from public.developer_submissions
   where deal_id = v_deal.id order by created_at desc limit 1;
  perform pg_temp.check77(v_email = 'credito@externa77.test',
    'a fila de e-mail continua saindo com o endereço do cadastro da construtora');

  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check77(v_label = 'ANÁLISE EXTERNA',
    'o envio à construtora deixa de ficar sem Status 2');

  select count(*) into v_qtd from public.notifications
   where profile_id = ana and kind = 'cca_pending';
  perform pg_temp.check77(v_qtd >= 1,
    'o analista é avisado também quando o dossiê vai para a construtora');

  -- ── 2. o mesmo rótulo vale para a agência ────────────────────────────────
  update public.cca_cases set status = 'sent_to_agency' where id = v_case.id;
  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check77(v_label = 'ANÁLISE EXTERNA',
    '"Enviado à Agência" escreve o mesmo Status 2 do envio à construtora');

  -- ── negócio INTERNO: o caso nasce com estágio ────────────────────────────
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente CCA 77 interno', '11955550778', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_deal2 := public.convert_lead_to_deal(v_lead, v_int, null, '77I', 300000);
  reset role;

  for v_type in
    select id, code from public.document_types
    where active and required_for_conversion order by sort_order
  loop
    insert into public.deal_documents
      (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values
      (v_deal2.id, v_type.id, v_deal2.id || '/77i-' || v_type.code || '.pdf',
       v_type.code || '.pdf', v_type.code || '-interno.pdf', cor);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal2.id);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ger::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  perform public.review_deal_documents(v_deal2.id, true, null);
  reset role;

  select * into v_case2 from public.cca_cases where deal_id = v_deal2.id;
  perform pg_temp.check77(v_case2.status = 'under_review' and v_case2.stage_id is not null,
    'o caso interno também nasce com estágio gravado');

  select id into v_stage from public.cca_stages
   where status = 'under_review' and active order by position limit 1;
  perform pg_temp.check77(v_case2.stage_id = v_stage,
    'o estágio gravado é o de menor posição com o desfecho do caso');

  -- ── 3a. envio avulso a construtora INTERNA não tira o caso da casa ───────
  -- O diálogo de envio permite de propósito mandar o dossiê para um contato
  -- pontual de uma construtora interna. Se o gatilho olhasse só o status do
  -- caso, esse e-mail arrancaria o caso da coluna "Em Análise" e o Status 2
  -- passaria a afirmar que o dossiê saiu da casa com a análise acontecendo aqui.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.developer_submissions
    (deal_id, developer_id, to_email, subject, document_ids, requested_by)
  values (v_deal2.id, v_int, 'contato.obra@interna77.test', 'Dossiê 77 avulso',
          array(select id from public.deal_documents
                 where deal_id = v_deal2.id and superseded_at is null), ana);
  reset role;

  select * into v_case2 from public.cca_cases where deal_id = v_deal2.id;
  perform pg_temp.check77(v_case2.status = 'under_review',
    'envio a construtora interna não move o caso: a análise continua na casa');
  select status_detail into v_label from public.deals where id = v_deal2.id;
  perform pg_temp.check77(v_label = '13. ESTEIRA AGIL',
    'e o Status 2 continua dizendo que o negócio está na esteira ágil');

  -- ── 3b. enfileirar para construtora EXTERNA move o caso em andamento ─────
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.developer_submissions
    (deal_id, developer_id, to_email, subject, document_ids, requested_by)
  values (v_deal2.id, v_ext, 'credito@externa77.test', 'Dossiê 77',
          array(select id from public.deal_documents
                 where deal_id = v_deal2.id and superseded_at is null), ana);
  reset role;

  select * into v_case2 from public.cca_cases where deal_id = v_deal2.id;
  perform pg_temp.check77(v_case2.status = 'sent_to_developer',
    'enfileirar o dossiê move o caso, sem segundo "Mover para…" à mão');
  perform pg_temp.check77(v_case2.stage_id = (
      select id from public.cca_stages
       where status = 'sent_to_developer' and active order by position limit 1),
    'o caso movido pelo envio cai na coluna "Enviado à Construtora"');

  select status_detail into v_label from public.deals where id = v_deal2.id;
  perform pg_temp.check77(v_label = 'ANÁLISE EXTERNA',
    'o rótulo acompanha o caso movido pelo envio');

  -- ── e NÃO mexe no caso já decidido ───────────────────────────────────────
  -- 'rejected' e não 'approved' de propósito: aprovar dispara `cca_award_points`
  -- e este arquivo não é sobre o jogo. Decidido é decidido nos dois casos.
  update public.cca_cases set status = 'rejected', decided_at = now() where id = v_case2.id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', ana::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  insert into public.developer_submissions
    (deal_id, developer_id, to_email, subject, document_ids, requested_by)
  values (v_deal2.id, v_ext, 'credito@externa77.test', 'Dossiê 77 de novo',
          array(select id from public.deal_documents
                 where deal_id = v_deal2.id and superseded_at is null), ana);
  reset role;

  select status into v_label from public.cca_cases where id = v_case2.id;
  perform pg_temp.check77(v_label = 'rejected',
    'um envio novo não desfaz a decisão do analista');

  raise notice '  --  cenário 77 concluído';
end;
$$;

\echo '== 0077: o backfill do Status 2 atravessa o mês fechado =='

-- O backfill da 0077 casa exatamente o negócio que a homologação tem em mês
-- congelado (SEED-NEG-005, `month_base` 2026-06-01, que está em
-- `closed_months`). Contra banco limpo o update não casa linha nenhuma e o
-- arquivo aplica verde — o harness não reproduzia a falha. Este bloco semeia o
-- cenário e prova as duas metades: sem o par disable/enable a transação cai, com
-- ele o rótulo alcança o passado e o gatilho volta ligado.
do $$
declare
  cor       uuid := '00000000-0000-0000-0000-00000000f773';
  v_dev     uuid;
  v_lead    uuid;
  v_deal    public.deals;
  -- Mês bem fora do caminho dos outros arquivos de teste: 23_marketing_dados
  -- mexe em 2026-01 e os arquivos posteriores no mês corrente.
  v_mes     date := date '2021-03-01';
  v_recusou boolean := false;
  v_label   text;
  v_estado  char;
begin
  select id into v_dev from public.developers where name = 'Construtora Externa 77';

  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente CCA 77 passado', '11955550779', 'in_progress', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '77P', 250000);
  reset role;

  -- Caso já fora da casa, do jeito que o passado deixou. O rótulo é apagado de
  -- propósito: é assim que o SEED-NEG-005 está hoje, sem Status 2 nenhum.
  insert into public.cca_cases (deal_id, status, submitted_at)
  values (v_deal.id, 'sent_to_developer', now());

  update public.deals
     set month_base = v_mes, status_detail = null
   where id = v_deal.id;

  insert into public.closed_months (period) values (v_mes)
  on conflict (period) do nothing;

  -- Metade 1: o gatilho recusa, e a recusa derruba a migration inteira.
  begin
    update public.deals d
       set status_detail = 'ANÁLISE EXTERNA'
      from public.cca_cases c
     where c.deal_id = d.id
       and c.status in ('sent_to_developer', 'sent_to_agency')
       and d.status_detail is null;
  exception when raise_exception then
    v_recusou := true;
  end;

  perform pg_temp.check77(v_recusou,
    'sem desligar o gatilho o backfill do Status 2 cai no mês fechado');

  -- Metade 2: o par da 0028, que é o que a 0077 passou a usar.
  alter table public.deals disable trigger deals_guard_closed_month;

  update public.deals d
     set status_detail = 'ANÁLISE EXTERNA'
    from public.cca_cases c
   where c.deal_id = d.id
     and c.status in ('sent_to_developer', 'sent_to_agency')
     and d.status_detail is null;

  alter table public.deals enable trigger deals_guard_closed_month;

  select status_detail into v_label from public.deals where id = v_deal.id;
  perform pg_temp.check77(v_label = 'ANÁLISE EXTERNA',
    'com o gatilho desligado o rótulo alcança o negócio de mês congelado');

  select t.tgenabled into v_estado
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'deals' and t.tgname = 'deals_guard_closed_month';
  perform pg_temp.check77(v_estado = 'O',
    'e o gatilho volta ligado: o mês fechado continua fechado para a operação');

  delete from public.closed_months where period = v_mes;

  raise notice '  --  backfill de mês fechado conferido';
end;
$$;

\echo '== 0077: permissões e catálogo =='

do $$
declare
  v_check text;
begin
  -- O 5º perfil da esteira: o sócio LÊ a esteira inteira (`can_read_all`) e não
  -- escreve nela. Estava sem cobertura nenhuma.
  perform pg_temp.check77(
    exists (select 1 from public.role_permissions
             where role = 'partner' and permission = 'menu.cca' and allowed),
    'o sócio enxerga o menu da esteira');
  perform pg_temp.check77(
    not exists (select 1 from public.role_permissions
                 where role = 'partner' and permission = 'cca.review' and allowed),
    'o sócio não escreve na esteira: a tela dele é somente leitura');

  select pg_get_expr(p.polwithcheck, p.polrelid) into v_check
    from pg_policy p where p.polname = 'deal_documents_insert'
     and p.polrelid = 'public.deal_documents'::regclass;
  perform pg_temp.check77(position('document_review_status' in coalesce(v_check, '')) > 0,
    'anexar passa a olhar o estado da conferência, como já fazia o excluir');
  perform pg_temp.check77(position('has_permission' in coalesce(v_check, '')) > 0,
    'a exceção do CCA está na policy, não só na tela');

  perform pg_temp.check77(
    exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'developer_submissions'
               and t.tgname = 'developer_submissions_advance_case'),
    'a fila de envio tem gatilho que move o caso');
end;
$$;

\echo '== 77_cca_documentos: ok =='
