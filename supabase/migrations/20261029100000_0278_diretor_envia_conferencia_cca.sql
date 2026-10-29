-- 0278 — A conferência já aceitava o diretor (0235), mas o envio interno
-- ao CCA ainda exigia gerente e revertia toda a aprovação. Alinha as duas
-- guardas; diretor da hierarquia usa o escopo existente de can_edit_deal.
-- Mantém documentos obrigatórios, status, auditoria e notificações.

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
  v_analysis_pos   int;
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
         and dp.role in ('manager', 'director')
     )
     and not (public.has_any_role('director') and public.can_edit_deal(p_deal_id)) then
    raise exception 'Somente gerente ou diretor vinculado ao negócio pode enviá-lo ao CCA.'
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
    select id into v_stage from public.cca_stages
     where active and status in ('sent_to_developer', 'under_review')
     order by (status = 'sent_to_developer') desc, position
     limit 1;

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

    if v_dev.submission_email is not null then
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
    end if;

    -- `submission_id` nulo = construtora sem e-mail: o dossiê vai à mão.
    v_result := jsonb_build_object(
      'flow', 'external', 'submission_id', v_sub_id, 'case_id', v_case_id);
  end if;

  select id, position into v_analysis_stage, v_analysis_pos
  from public.pipeline_stages
  where code = 'under_analysis' and active;

  if v_analysis_stage is null then
    raise exception 'A etapa Em análise não está configurada.' using errcode = 'P0001';
  end if;

  if v_deal.outcome = 'open' and exists (
    select 1 from public.pipeline_stages s
    where s.id = v_deal.stage_id and s.position < v_analysis_pos
  ) then
    update public.deals set stage_id = v_analysis_stage where id = p_deal_id;
  end if;

  return v_result;
end;
$$;

comment on function public.submit_deal_for_analysis(uuid) is
  'Entrada do negócio aprovado pela liderança na CCA. Construtora externa com e-mail enfileira o dossiê em developer_submissions; sem e-mail o caso entra igual e o dossiê não é enfileirado (0154).';

create or replace function public.review_deal_documents(
  p_deal_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_reason text := nullif(btrim(p_reason), '');
  v_submit jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Negócio não encontrado.' using errcode = 'P0002'; end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
     where dp.deal_id = p_deal_id and dp.profile_id = auth.uid()
       and dp.role in ('manager', 'director')
  ) and not (public.has_any_role('director') and public.can_edit_deal(p_deal_id)) then
    raise exception 'Somente gerente ou diretor vinculado pode conferir os documentos.'
      using errcode = '42501';
  end if;
  if v_deal.document_review_status <> 'pending' then
    raise exception 'A documentação não está aguardando conferência.' using errcode = 'P0001';
  end if;
  if v_reason is null and not coalesce(p_approve, false) then
    raise exception 'Informe o motivo da devolução.' using errcode = 'P0001';
  end if;
  if length(v_reason) > 2000 then
    raise exception 'Mensagem longa demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  if not coalesce(p_approve, false) then
    update public.deals
       set document_review_status = 'returned', document_reviewed_at = now(),
           document_reviewed_by = auth.uid(), document_review_reason = v_reason
     where id = p_deal_id;
    insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
    values (p_deal_id, auth.uid(), 'document_review_returned', 'pending', 'returned',
            jsonb_build_object('reason', v_reason));
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id, 'document_review_returned',
           'Documentos devolvidos: ' || v_deal.code, v_reason, '/pipeline',
           'in_app'::public.notification_channel
      from public.deal_participants dp
     where dp.deal_id = p_deal_id and dp.role = 'broker';
    return jsonb_build_object('status', 'returned', 'reason', v_reason);
  end if;

  update public.deals
     set document_review_status = 'approved', document_reviewed_at = now(),
         document_reviewed_by = auth.uid(), document_review_reason = null
   where id = p_deal_id;
  insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value)
  values (p_deal_id, auth.uid(), 'document_review_approved', 'pending', 'approved');
  if v_reason is not null then
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment', 'APROVADO PELA LIDERANÇA: ' || v_reason);
  end if;

  v_submit := public.submit_deal_for_analysis(p_deal_id);
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id, 'document_review_approved',
         'Documentos aprovados: ' || v_deal.code,
         left('A conferência foi aprovada e o negócio seguiu para análise.'
              || coalesce(' ' || v_reason, ''), 2000),
         '/pipeline', 'in_app'::public.notification_channel
    from public.deal_participants dp
   where dp.deal_id = p_deal_id and dp.role = 'broker';
  return jsonb_build_object('status', 'approved', 'submission', v_submit);
end;
$$;

revoke all on function public.review_deal_documents(uuid, boolean, text) from public, anon;
grant execute on function public.review_deal_documents(uuid, boolean, text) to authenticated;
comment on function public.review_deal_documents(uuid, boolean, text) is
  'Gerente ou diretor participante, diretor da equipe (e admin/sócio) confere a documentação pendente.';
