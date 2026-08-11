-- =============================================================================
-- 0028 · Conferência documental entre corretor e gerente
--
-- O negócio pode nascer sem anexos. Os documentos obrigatórios passam a ser
-- exigidos quando o corretor envia o dossiê para conferência. Um dos gerentes
-- participantes aprova e, na mesma transação, o negócio entra na esteira do CCA
-- (ou na fila da construtora externa). Devolução exige motivo e avisa corretores.
-- =============================================================================

alter table public.deals
  add column document_review_status text not null default 'draft',
  add column document_review_requested_at timestamptz,
  add column document_review_requested_by uuid references public.profiles(id) on delete set null,
  add column document_reviewed_at timestamptz,
  add column document_reviewed_by uuid references public.profiles(id) on delete set null,
  add column document_review_reason text,
  add constraint deals_document_review_status_check
    check (document_review_status in ('draft', 'pending', 'returned', 'approved'));

create index deals_document_review_pending_idx
  on public.deals (document_review_requested_at)
  where document_review_status = 'pending';

comment on column public.deals.document_review_status is
  'Conferência anterior ao CCA: draft, pending, returned ou approved.';
comment on column public.deals.document_review_reason is
  'Último motivo de devolução informado pelo gerente; o histórico preserva os anteriores.';

-- Negócios que já estavam no CCA ou em etapas posteriores não podem reaparecer
-- como documentação em rascunho depois da migration.
alter table public.deals disable trigger deals_guard_closed_month;

update public.deals d
set document_review_status = 'approved',
    document_reviewed_at = coalesce(
      (select c.submitted_at from public.cca_cases c where c.deal_id = d.id),
      (select max(s.created_at) from public.developer_submissions s where s.deal_id = d.id),
      d.updated_at
    )
where exists (select 1 from public.cca_cases c where c.deal_id = d.id)
   or exists (select 1 from public.developer_submissions s where s.deal_id = d.id)
   or exists (
     select 1
     from public.pipeline_stages ps
     where ps.id = d.stage_id
       and ps.code in ('under_analysis', 'approved', 'contract', 'closed')
   );

alter table public.deals enable trigger deals_guard_closed_month;

-- Os campos de decisão são escritos somente pelas RPCs abaixo. Sem esta trava,
-- um corretor que pode editar o negócio conseguiria marcar a própria revisão
-- como aprovada por PATCH direto no PostgREST.
create or replace function public.deals_guard_document_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (
    new.document_review_status is distinct from old.document_review_status
    or new.document_review_requested_at is distinct from old.document_review_requested_at
    or new.document_review_requested_by is distinct from old.document_review_requested_by
    or new.document_reviewed_at is distinct from old.document_reviewed_at
    or new.document_reviewed_by is distinct from old.document_reviewed_by
    or new.document_review_reason is distinct from old.document_review_reason
  ) and current_user not in ('postgres', 'service_role') then
    raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger deals_guard_document_review
  before update on public.deals
  for each row execute function public.deals_guard_document_review();

revoke all on function public.deals_guard_document_review() from public, anon, authenticated;

-- Mantém a matriz de etapas da 0020 e fecha o atalho para CCA/etapas posteriores.
create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code     text;
  v_requires boolean;
  v_docs     int;
  v_outcome  deal_outcome;
begin
  if new.stage_id is distinct from old.stage_id then
    if auth.uid() is not null then
      if not public.can_exit_stage(old.stage_id) then
        raise exception 'Seu papel não pode tirar um negócio deste estágio.'
          using errcode = '42501';
      end if;
      if not public.can_enter_stage(new.stage_id) then
        raise exception 'Seu papel não pode mover um negócio para este estágio.'
          using errcode = '42501';
      end if;
    end if;

    select code, requires_document, outcome into v_code, v_requires, v_outcome
    from public.pipeline_stages where id = new.stage_id;

    if v_code in ('under_analysis', 'approved', 'contract', 'closed')
       and coalesce(new.document_review_status, 'draft') <> 'approved' then
      raise exception
        'A documentação precisa ser aprovada pelo gerente antes de entrar no CCA.'
        using errcode = 'P0001';
    end if;

    if coalesce(v_requires, false) then
      select count(*) into v_docs
      from public.deal_documents
      where deal_id = new.id and superseded_at is null;

      if v_docs = 0 then
        raise exception
          'O estágio exige ao menos um documento anexado antes do avanço.'
          using errcode = 'P0001';
      end if;
    end if;

    new.stage_entered_at := now();
    new.outcome := coalesce(v_outcome, new.outcome);

    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- Conversão sem documento: os anexos existentes ainda são promovidos, mas a
-- ausência deles não impede o nascimento do negócio.
create or replace function public.convert_lead_to_deal(
  p_lead_id      uuid,
  p_developer_id uuid,
  p_project_id   uuid default null,
  p_unit         text default null,
  p_vgv_gross    numeric default null
)
returns public.deals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead  public.leads;
  v_stage uuid;
  v_deal  public.deals;
  v_owner uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Lead já convertido no negócio %.', v_lead.converted_deal_id
      using errcode = 'P0001';
  end if;

  v_owner := coalesce(v_lead.assigned_to, auth.uid());

  if not (public.is_admin() or v_owner = auth.uid() or public.manages_profile(v_owner)) then
    raise exception 'Sem permissão para converter este lead.' using errcode = '42501';
  end if;

  select id into v_stage from public.pipeline_stages
  where is_initial and active limit 1;
  if v_stage is null then
    raise exception 'Nenhum estágio inicial configurado no pipeline.' using errcode = 'P0001';
  end if;

  insert into public.deals (lead_id, developer_id, project_id, unit, stage_id,
                            vgv_gross, lead_origin, created_by)
  values (p_lead_id, p_developer_id, p_project_id, p_unit, v_stage,
          p_vgv_gross,
          coalesce((select ls.label from public.lead_sources ls where ls.id = v_lead.source_id),
                   v_lead.utm_source),
          auth.uid())
  returning * into v_deal;

  insert into public.deal_clients (deal_id, ordinal, full_name, phone, email, cpf)
  values (v_deal.id, 1, v_lead.full_name, v_lead.phone, v_lead.email, v_lead.document);

  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal.id, v_owner, 'broker');

  insert into public.deal_documents (deal_id, document_type_id, storage_path,
                                     original_name, stored_name, mime_type,
                                     size_bytes, uploaded_by)
  select v_deal.id,
         coalesce(la.document_type_id,
                  (select dt.id from public.document_types dt where dt.code = 'outros' limit 1)),
         la.storage_path, la.original_name, la.stored_name, la.mime_type,
         la.size_bytes, la.uploaded_by
  from public.lead_attachments la
  where la.lead_id = p_lead_id
    and coalesce(la.document_type_id,
                 (select dt.id from public.document_types dt where dt.code = 'outros' limit 1))
        is not null;

  update public.leads
     set status = 'converted',
         converted_deal_id = v_deal.id,
         converted_at = now(),
         last_activity_at = now()
   where id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, to_value)
  values (p_lead_id, auth.uid(), 'converted', v_deal.id::text);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (v_deal.id, auth.uid(), 'created', jsonb_build_object('from_lead', p_lead_id));

  return v_deal;
end;
$$;

-- Rotina interna: somente a aprovação do gerente chama esta função. Ela ainda
-- valida tudo novamente e move o negócio para Em análise na mesma transação.
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
    insert into public.cca_cases (deal_id, status, submitted_at)
    values (p_deal_id, 'under_review', now())
    on conflict (deal_id) do update
      set status = 'under_review', submitted_at = now(), decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'under_review');

    v_result := jsonb_build_object('flow', 'internal', 'case_id', v_case_id);
  else
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

    v_result := jsonb_build_object('flow', 'external', 'submission_id', v_sub_id);
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

create or replace function public.submit_deal_for_manager_review(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'broker'
  ) then
    raise exception 'Somente um corretor vinculado ao negócio pode solicitar a conferência.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  elsif v_deal.document_review_status = 'approved' then
    raise exception 'A documentação deste negócio já foi aprovada.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'manager'
  ) then
    raise exception 'Vincule ao menos um gerente ao negócio antes de enviar.'
      using errcode = 'P0001';
  end if;

  select string_agg(dt.label, ', ' order by dt.sort_order) into v_missing
  from public.document_types dt
  where dt.active and dt.required_for_conversion
    and not exists (
      select 1 from public.deal_documents dd
      where dd.deal_id = p_deal_id
        and dd.document_type_id = dt.id
        and dd.superseded_at is null
    );

  if v_missing is not null then
    raise exception 'Faltam documentos obrigatórios: %', v_missing using errcode = 'P0001';
  end if;

  v_previous := v_deal.document_review_status;

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         'Um corretor enviou a documentação deste negócio para sua conferência.',
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'manager';

  return jsonb_build_object('status', 'pending');
end;
$$;

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
  v_deal   public.deals;
  v_reason text := nullif(btrim(p_reason), '');
  v_submit jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'manager'
  ) then
    raise exception 'Somente um gerente vinculado ao negócio pode conferir os documentos.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status <> 'pending' then
    raise exception 'A documentação não está aguardando conferência.' using errcode = 'P0001';
  end if;

  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'Informe o motivo da devolução.' using errcode = 'P0001';
    end if;
    if length(v_reason) > 2000 then
      raise exception 'Motivo longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
    end if;

    update public.deals
    set document_review_status = 'returned',
        document_reviewed_at = now(),
        document_reviewed_by = auth.uid(),
        document_review_reason = v_reason
    where id = p_deal_id;

    insert into public.deal_history
      (deal_id, actor_id, kind, from_value, to_value, detail)
    values
      (p_deal_id, auth.uid(), 'document_review_returned', 'pending', 'returned',
       jsonb_build_object('reason', v_reason));

    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id,
           'document_review_returned',
           'Documentos devolvidos: ' || v_deal.code,
           v_reason,
           '/pipeline',
           'in_app'::notification_channel
    from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'broker';

    return jsonb_build_object('status', 'returned', 'reason', v_reason);
  end if;

  update public.deals
  set document_review_status = 'approved',
      document_reviewed_at = now(),
      document_reviewed_by = auth.uid(),
      document_review_reason = null
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_approved', 'pending', 'approved');

  v_submit := public.submit_deal_for_analysis(p_deal_id);

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_approved',
         'Documentos aprovados: ' || v_deal.code,
         'A conferência foi aprovada e o negócio seguiu para análise.',
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'broker';

  return jsonb_build_object('status', 'approved', 'submission', v_submit);
end;
$$;

-- A tela chama somente as duas ações do fluxo. O envio ao CCA vira detalhe
-- interno, impedindo duplicidade ou reabertura por chamada direta do navegador.
revoke all on function public.submit_deal_for_analysis(uuid) from public, anon, authenticated;
grant execute on function public.submit_deal_for_analysis(uuid) to service_role;

revoke all on function public.submit_deal_for_manager_review(uuid) from public, anon;
grant execute on function public.submit_deal_for_manager_review(uuid) to authenticated, service_role;

revoke all on function public.review_deal_documents(uuid, boolean, text) from public, anon;
grant execute on function public.review_deal_documents(uuid, boolean, text) to authenticated, service_role;

comment on function public.submit_deal_for_manager_review(uuid) is
  'Corretor envia documentos obrigatórios para um dos gerentes participantes conferir.';
comment on function public.review_deal_documents(uuid, boolean, text) is
  'Gerente participante aprova e envia ao CCA, ou devolve ao corretor com motivo obrigatório.';
