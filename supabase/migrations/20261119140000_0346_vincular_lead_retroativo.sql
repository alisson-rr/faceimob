-- =============================================================================
-- 0346 · Vincular lead a negócio de mês anterior ou fechado
--
-- Pedido de 19/11/2026: "o vincular lead a um negócio não aceita de mês
-- passado e fechado; permita que esse vínculo aconteça para remover da lista de
-- leads, mesmo que retroativo". O `update deals set lead_id` batia no
-- `deals_guard_closed_month` (0302) e o lead ficava na lista. O guarda ganha
-- uma saída estreita, ligada só durante o vínculo e só para lead_id/lead_origin.
-- =============================================================================

create or replace function public.deals_guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := coalesce(new.month_base, old.month_base);
  v_reactivation text := coalesce(current_setting('faceimob.reactivate_deal', true), '');
  v_current_month date := public.month_start(
    coalesce(public.current_season_month(), current_date)
  );
begin
  if public.is_admin() or v_reactivation = new.id::text then
    return new;
  end if;

  -- 0346: vincular lead a negócio de mês anterior ou fechado (retroativo).
  -- Só por `vincular_lead_a_negocio`, e só a origem do negócio (lead_id e
  -- lead_origin): nada que mude número, rateio ou status do mês.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.vincular_lead', true), '') = new.id::text
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('lead_id', 'lead_origin', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_move', true), '') = 'on'
     and public.has_permission('deals.mark_distrato')
     and new.month_base is not distinct from old.month_base
     and new.month_base < v_current_month
     and public.deal_status_bare(new.status_detail) = 'DISTRATO' then
    return new;
  end if;

  -- Baixa da pendência (0286): só por `baixar_pendencia_contrato`, e só o selo
  -- de ligado para desligado. Coluna gerada (`vgv_net`) chega nula no BEFORE e
  -- não é escrita por ninguém: fica fora da comparação.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.baixa_pendencia', true), '') = new.id::text
     and old.contract_has_pending_issue and not new.contract_has_pending_issue
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('contract_has_pending_issue', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  -- Avanço de contrato pelo CCA (0302): só pela esteira (o gatilho da coluna liga o aviso),
  -- de um status de contrato para outro, e só o Status 2 e o que segue dele.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('faceimob.cca_contrato', true), '') = new.id::text
     and public.deal_status_e_contrato(old.status_detail)
     and public.deal_status_e_contrato(new.status_detail)
     and not exists (
       select 1
         from jsonb_each(to_jsonb(new)) n
         join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
          and n.key not in ('status_detail', 'status_detail_changed_at', 'status_group_id', 'stage_id',
                            'stage_entered_at', 'outcome', 'closed_at', 'updated_at')
          and n.key not in (select a.attname from pg_attribute a
                             where a.attrelid = 'public.deals'::regclass and a.attgenerated <> '')
     ) then
    return new;
  end if;

  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_period, 'MM/YYYY') using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.vincular_lead_a_negocio(p_lead_id uuid, p_deal_id uuid, p_cpf text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead   public.leads;
  v_deal   public.deals;
  v_owner  uuid;
  v_cpf    text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if length(v_cpf) <> 11 then
    raise exception 'Informe o CPF do cliente com 11 dígitos.' using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if v_lead.converted_deal_id is not null then
    raise exception 'Este lead já está ligado ao negócio %.', v_lead.converted_deal_id using errcode = 'P0001';
  end if;

  v_owner := coalesce(v_lead.assigned_to, auth.uid());
  if not (public.is_admin() or v_owner = auth.uid() or public.manages_profile(v_owner)) then
    raise exception 'Sem permissão para vincular este lead.' using errcode = '42501';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or public.can_edit_deal(p_deal_id)) then
    raise exception 'Sem permissão para vincular lead a este negócio.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.deal_clients dc
     where dc.deal_id = p_deal_id and regexp_replace(coalesce(dc.cpf, ''), '\D', '', 'g') = v_cpf
  ) then
    raise exception 'O CPF informado não é de nenhum cliente deste negócio.' using errcode = 'P0001';
  end if;

  if v_deal.lead_id is not null and v_deal.lead_id <> p_lead_id then
    raise exception 'Este negócio já está ligado a outro lead.' using errcode = 'P0001';
  end if;

  if v_deal.lead_id is null then
    -- 0346: o mês do negócio pode estar fechado; o guarda libera só estas colunas.
    perform set_config('faceimob.vincular_lead', p_deal_id::text, true);
    update public.deals
       set lead_id = p_lead_id,
           lead_origin = coalesce(lead_origin,
             (select ls.label from public.lead_sources ls where ls.id = v_lead.source_id), v_lead.utm_source)
     where id = p_deal_id;
    perform set_config('faceimob.vincular_lead', '', true);
  end if;

  -- Os anexos do lead que o negócio ainda não tem (a mesma regra da conversão).
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name,
                                     stored_name, mime_type, size_bytes, uploaded_by)
  select p_deal_id,
         coalesce(la.document_type_id, (select dt.id from public.document_types dt where dt.code = 'outros' limit 1)),
         la.storage_path, la.original_name, la.stored_name, la.mime_type, la.size_bytes, la.uploaded_by
    from public.lead_attachments la
   where la.lead_id = p_lead_id
     and coalesce(la.document_type_id, (select dt.id from public.document_types dt where dt.code = 'outros' limit 1)) is not null
     and not exists (select 1 from public.deal_documents dd
                      where dd.deal_id = p_deal_id and dd.storage_path = la.storage_path);

  update public.leads
     set status = 'converted',
         converted_deal_id = p_deal_id,
         converted_at = now(),
         last_activity_at = now()
   where id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, to_value, detail)
  values (p_lead_id, auth.uid(), 'converted', p_deal_id::text, jsonb_build_object('vinculado_a_negocio_existente', true));

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (p_deal_id, auth.uid(), 'lead_linked', jsonb_build_object('from_lead', p_lead_id));
end;
$$;
