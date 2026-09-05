-- =============================================================================
-- 0077 · Esteira CCA: o funil externo entra na esteira, o envio move o caso e o
--        dossiê para de aceitar arquivo depois de conferido
--
-- Cinco furos medidos em 06/09, todos na mesma fronteira (gerente → CCA →
-- construtora). Cada bloco explica o PORQUÊ.
--
-- 1. Aprovar um negócio de construtora EXTERNA sumia da operação.
--    `submit_deal_for_analysis` só criava `cca_cases` no ramo interno: no ramo
--    externo enfileirava `developer_submissions` e mais nada. Consequência
--    medida na homologação: nenhum cartão em /cca, nenhuma notificação
--    `cca_pending` (o produtor é gatilho de INSERT em `cca_cases`), nenhum
--    Status 2 (o gatilho do rótulo também se pendura em `cca_cases`) e nenhuma
--    tela listando a fila de e-mail. O único negócio que realmente saiu para a
--    construtora — SEED-NEG-005 — era o único sem rótulo nenhum.
--    Decisão de 06/09 (recomendação aceita): o funil externo passa a criar o
--    caso, no estágio "Enviado à Construtora". Consequência de NÃO fazer: o
--    negócio externo continuaria sem tela, sem rótulo, sem aviso e sem forma de
--    reenviar um envio falhado. Consequência de fazer: um caso externo aparece
--    na esteira em modo acompanhamento — o analista não "analisa" esse caso,
--    ele acompanha o retorno da construtora, que é o que a operação já faz.
--
-- 2. O Status 2 do envio à construtora era NULO. O `case` de
--    `cca_cases_sync_esteira_label` cobria under_review, pending_documents e
--    approved e devolvia null para os demais. `sent_to_developer` e
--    `sent_to_agency` passam a escrever "ANÁLISE EXTERNA" — rótulo que já existe
--    no catálogo dos 32 (src/components/pipeline/statuses.ts). Uma linha no
--    mesmo `case`: uma fonte de verdade só, e o negócio sai do limbo.
--    Fora daqui de propósito: 'rejected' e 'cancelled' continuam sem rótulo,
--    porque quem encerra o negócio é o diálogo de perda, que também move a etapa
--    — escrever só o rótulo deixaria "REPROVADO" com o negócio ainda no funil
--    (decisão da 0059, item 4, mantida).
--
-- 3. "Enviar à construtora" enfileirava e o caso não saía do lugar. Nenhum
--    gatilho de `developer_submissions` tocava `cca_cases` (a tabela só tinha
--    `set_updated_at`): o analista precisava fazer um segundo "Mover para… →
--    Enviado à Construtora" à mão, e nada ligava um ao outro. O gatilho novo só
--    avança caso ainda EM ANDAMENTO (under_review/pending_documents) e só de
--    construtora de fluxo EXTERNO: caso já decidido não volta atrás por causa de
--    um e-mail, e o envio avulso do dossiê a um contato de construtora INTERNA
--    (caso legítimo, oferecido pelo próprio diálogo) não pode arrancar o caso da
--    análise da casa nem trocar o Status 2 para "ANÁLISE EXTERNA".
--
-- 4. Anexar continuava liberado depois de "Aprovar e enviar ao CCA". A 0059
--    fechou o DELETE ('draft'/'returned') e deixou o INSERT aberto: o corretor
--    trocava a versão que o gerente aprovou e que o analista ia baixar, e o
--    banco aceitava calado. A mesma cláusula passa a valer no INSERT, com uma
--    exceção deliberada — quem tem `cca.review` continua juntando documento
--    depois (retorno do banco, laudo), senão a própria esteira ficaria de fora.
--
-- 5. `stage_id` nulo em 9 dos 12 casos. O ramo interno nunca gravava estágio, e
--    o quadro só acertava a coluna pelo fallback por status (ccaData.ts:97).
--    Na prática a gestão de estágios governava 3 casos e excluir um estágio não
--    mudava nada para os outros 9. O ramo interno passa a gravar, e o backfill
--    resolve o passado.
--
-- Idempotente: `create or replace`, `drop … if exists` e updates com filtro de
-- estado. Reaplicar não muda nada duas vezes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2. O rótulo do envio externo — uma linha no mesmo `case`
-- -----------------------------------------------------------------------------
create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label  text;
  v_deal   public.deals;
  v_reason text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_label := case new.status
    when 'under_review'      then '13. ESTEIRA AGIL'
    when 'pending_documents' then 'RET. ESTEIRA AGIL'
    when 'approved'          then '09. APROV. TOTAL'
    -- 0077: o dossiê saiu da casa. Enquanto isto devolvia null, o único negócio
    -- que de fato foi para a construtora era o único com Status 2 vazio.
    when 'sent_to_developer' then 'ANÁLISE EXTERNA'
    when 'sent_to_agency'    then 'ANÁLISE EXTERNA'
    else null
  end;

  if v_label is not null then
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF');
  end if;

  -- Devolução do CCA: o dossiê volta para a conferência do gerente. Sem isto o
  -- corretor recebia o rótulo "RET. ESTEIRA AGIL" e nenhuma ação: o negócio
  -- seguia 'approved' e `submit_deal_for_manager_review` recusava o reenvio.
  if new.status = 'pending_documents' then
    select * into v_deal from public.deals where id = new.deal_id for update;

    if found and v_deal.document_review_status = 'approved' then
      v_reason := 'Devolvido pela análise de crédito: '
                  || coalesce(nullif(btrim(new.decision_notes), ''), 'documentação pendente.');

      update public.deals
         set document_review_status   = 'returned',
             document_reviewed_at     = now(),
             document_reviewed_by     = auth.uid(),
             document_review_reason   = left(v_reason, 2000)
       where id = new.deal_id;

      insert into public.deal_history
        (deal_id, actor_id, kind, from_value, to_value, detail)
      values
        (new.deal_id, auth.uid(), 'document_review_returned', 'approved', 'returned',
         jsonb_build_object('reason', left(v_reason, 2000), 'source', 'cca'));

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct dp.profile_id,
             'document_review_returned',
             'CCA devolveu o dossiê: ' || v_deal.code,
             left(v_reason, 2000),
             '/pipeline',
             'in_app'::notification_channel
      from public.deal_participants dp
      where dp.deal_id = new.deal_id and dp.role = 'broker';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.cca_cases_sync_esteira_label() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1/5. O funil externo entra na esteira, e o interno grava o estágio
-- -----------------------------------------------------------------------------
create or replace function public.submit_deal_for_analysis(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal           public.deals;
  v_dev            public.developers;
  v_docs           uuid[];
  v_client         text;
  v_case_id        uuid;
  v_sub_id         uuid;
  v_stage          uuid;
  v_analysis_stage uuid;
  v_result         jsonb;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if auth.uid() is not null
     and not public.is_admin()
     and not exists (
       select 1 from public.deal_participants dp
       where dp.deal_id = p_deal_id
         and dp.profile_id = auth.uid()
         and dp.role = 'manager'
     ) then
    raise exception 'Somente um gerente vinculado ao negócio pode enviá-lo ao CCA.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status <> 'approved' then
    raise exception 'A documentação ainda não foi aprovada pelo gerente.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora antes de enviar para análise.'
      using errcode = 'P0001';
  end if;

  select * into v_dev from public.developers where id = v_deal.developer_id;

  select coalesce(array_agg(d.id order by d.created_at), '{}') into v_docs
  from public.deal_documents d
  where d.deal_id = p_deal_id and d.superseded_at is null;

  if array_length(v_docs, 1) is null then
    raise exception 'Nenhum documento anexado ao negócio.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_types dt
    where dt.active and dt.required_for_conversion
      and not exists (
        select 1 from public.deal_documents dd
        where dd.deal_id = p_deal_id
          and dd.document_type_id = dt.id
          and dd.superseded_at is null
      )
  ) then
    raise exception 'Faltam documentos obrigatórios: %',
      (select string_agg(dt.label, ', ' order by dt.sort_order)
       from public.document_types dt
       where dt.active and dt.required_for_conversion
         and not exists (
           select 1 from public.deal_documents dd
           where dd.deal_id = p_deal_id
             and dd.document_type_id = dt.id
             and dd.superseded_at is null
         ))
      using errcode = 'P0001';
  end if;

  select c.full_name into v_client
  from public.deal_clients c where c.deal_id = p_deal_id and c.ordinal = 1;

  if v_dev.flow = 'internal' then
    -- 0077: o estágio deixa de nascer nulo. Com `stage_id` vazio o cartão só
    -- caía na coluna certa pelo fallback por status, e a gestão de estágios não
    -- governava o caso.
    select id into v_stage from public.cca_stages
     where status = 'under_review' and active order by position limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'under_review', v_stage, now())
    on conflict (deal_id) do update
      set status = 'under_review',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'under_review');

    v_result := jsonb_build_object('flow', 'internal', 'case_id', v_case_id);
  else
    -- 0077: o caso nasce ANTES da linha da fila, já em "Enviado à Construtora".
    -- Nesta ordem o gatilho `developer_submissions_advance_case` encontra o caso
    -- no estágio final e não faz nada — e o negócio ganha cartão, rótulo
    -- ("ANÁLISE EXTERNA", pelo gatilho do bloco 2) e a notificação `cca_pending`
    -- que só existia para o fluxo interno.
    select id into v_stage from public.cca_stages
     where status = 'sent_to_developer' and active order by position limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'sent_to_developer', v_stage, now())
    on conflict (deal_id) do update
      set status = 'sent_to_developer',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'sent_to_developer');

    insert into public.developer_submissions
      (deal_id, developer_id, to_email, subject, body, document_ids, requested_by)
    values (
      p_deal_id,
      v_dev.id,
      v_dev.submission_email,
      format('[%s] Documentação - %s', v_deal.code, coalesce(v_client, 'cliente')),
      format('Segue documentação do negócio %s (unidade %s).',
             v_deal.code, coalesce(v_deal.unit, '-')),
      v_docs,
      auth.uid()
    )
    returning id into v_sub_id;

    insert into public.deal_history (deal_id, actor_id, kind, detail)
    values (p_deal_id, auth.uid(), 'sent_to_developer',
            jsonb_build_object('submission_id', v_sub_id, 'developer', v_dev.name));

    v_result := jsonb_build_object(
      'flow', 'external', 'submission_id', v_sub_id, 'case_id', v_case_id);
  end if;

  select id into v_analysis_stage
  from public.pipeline_stages
  where code = 'under_analysis' and active;

  if v_analysis_stage is null then
    raise exception 'A etapa Em análise não está configurada.' using errcode = 'P0001';
  end if;

  if v_deal.stage_id is distinct from v_analysis_stage then
    update public.deals set stage_id = v_analysis_stage where id = p_deal_id;
  end if;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Enfileirar o envio move o caso — sem segundo gesto à mão
-- -----------------------------------------------------------------------------
create or replace function public.developer_submissions_advance_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage uuid;
begin
  select id into v_stage from public.cca_stages
   where status = 'sent_to_developer' and active order by position limit 1;

  -- Duas condições, e as duas por um motivo medido:
  --
  -- 1. Só caso EM ANDAMENTO. Reenviar o dossiê de um caso já aprovado ou
  --    reprovado não pode desfazer a decisão do analista — e o "Reenviar" da
  --    tela é UPDATE, não INSERT, então nem passa por aqui.
  -- 2. Só construtora de fluxo EXTERNO. O diálogo de envio permite de propósito
  --    mandar o dossiê para um contato pontual de uma construtora interna
  --    (pedido de um gerente da obra, por exemplo). Sem este filtro, esse e-mail
  --    avulso arrancava o caso da coluna "Em Análise", gravava o estágio
  --    "Enviado à Construtora" e, pela cascata de `cca_cases_sync_esteira_label`,
  --    trocava o Status 2 de '13. ESTEIRA AGIL' para 'ANÁLISE EXTERNA': o
  --    analista perdia o caso de vista e o funil passava a afirmar que o dossiê
  --    tinha saído da casa com a análise ainda acontecendo aqui dentro.
  update public.cca_cases c
     set status   = 'sent_to_developer',
         stage_id = coalesce(v_stage, c.stage_id)
   where c.deal_id = new.deal_id
     and c.status in ('under_review', 'pending_documents')
     and exists (
       select 1 from public.developers dv
       where dv.id = new.developer_id and dv.flow = 'external'
     );

  return null;
end;
$$;

revoke all on function public.developer_submissions_advance_case() from public, anon, authenticated;

drop trigger if exists developer_submissions_advance_case on public.developer_submissions;
create trigger developer_submissions_advance_case
  after insert on public.developer_submissions
  for each row execute function public.developer_submissions_advance_case();

comment on function public.developer_submissions_advance_case is
  'Enfileirar o dossiê para construtora de fluxo EXTERNO move o caso da esteira para '
  '"Enviado à Construtora". Só caso em andamento: caso decidido não volta atrás por causa de '
  'um e-mail, e envio avulso a construtora interna não tira o caso da análise da casa.';

-- -----------------------------------------------------------------------------
-- 4. Depois do envio ao gerente o dossiê é prova: não recebe mais arquivo
-- -----------------------------------------------------------------------------
drop policy if exists deal_documents_insert on public.deal_documents;
create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check (
    public.can_edit_deal(deal_id)
    and (
      public.is_admin()
      -- O CCA junta documento depois da aprovação de propósito: retorno do
      -- banco e laudo chegam quando o dossiê já está na esteira. Fechar para
      -- todo mundo trancaria justamente quem recebe esses papéis.
      or public.has_permission('cca.review')
      or exists (
        select 1 from public.deals d
        where d.id = deal_id
          and coalesce(d.document_review_status, 'draft') in ('draft', 'returned')
      )
    )
  );

comment on policy deal_documents_insert on public.deal_documents is
  'Anexar exige editar o negócio E o dossiê ainda estar com o corretor (draft/returned). '
  'Espelha deal_documents_delete (0059); admin e cca.review seguem podendo juntar documento.';

-- -----------------------------------------------------------------------------
-- Backfill · o passado alcança as regras novas
-- -----------------------------------------------------------------------------

-- Estágio dos casos que nasceram sem ele. `distinct on` porque nada impede dois
-- estágios ativos com o mesmo desfecho: vale o de menor posição, a mesma ordem
-- que o quadro usa.
update public.cca_cases c
   set stage_id = s.id
  from (
    select distinct on (status) id, status
    from public.cca_stages
    where active
    order by status, position
  ) s
 where c.stage_id is null
   and s.status = c.status;

-- Status 2 de quem já estava fora da casa. Só onde está NULO: sobrescrever
-- rótulo escolhido por alguém seria trocar um fato por uma suposição — a mesma
-- regra do backfill da 0059.
--
-- O gatilho sai do caminho pelo mesmo motivo da 0028 (linha 31): este update NÃO
-- é gravação nova em mês fechado, é rótulo de um fato consumado — o dossiê JÁ
-- saiu para a construtora, e a linha estava sem Status 2 só porque o gatilho de
-- rótulo não cobria esse desfecho até agora. Sem o par disable/enable a
-- migration inteira faz rollback: o único negócio que casa este filtro na
-- homologação é o SEED-NEG-005, cujo `month_base` (2026-06-01) está em
-- `closed_months`, e `deals_guard_closed_month` (0010) só isenta `is_admin()` —
-- que é falso rodando como `postgres`, sem JWT.
alter table public.deals disable trigger deals_guard_closed_month;

update public.deals d
   set status_detail = 'ANÁLISE EXTERNA'
  from public.cca_cases c
 where c.deal_id = d.id
   and c.status in ('sent_to_developer', 'sent_to_agency')
   and d.status_detail is null;

alter table public.deals enable trigger deals_guard_closed_month;
