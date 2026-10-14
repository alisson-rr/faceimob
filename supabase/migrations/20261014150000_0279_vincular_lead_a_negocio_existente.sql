-- =============================================================================
-- 0279 · Vincular o lead a um negócio que já existe
--
-- Pedido de 14/10/2026: o corretor esquece de converter o lead, cria o negócio
-- à mão e depois o lead segue aberto (e, se converter, nasce cadastro duplo).
-- `vincular_lead_a_negocio` fecha o lead apontando para o negócio existente, sem
-- criar nenhum. O CPF informado precisa ser de um dos clientes do negócio: o id
-- sozinho não basta, para ninguém vincular a lead um negócio que não é do cliente.
--
-- Quem pode: quem converte o lead (dono, gestor do dono ou admin) E edita o
-- negócio. O lead vira "convertido" como na conversão, com o histórico dos dois
-- lados, e os anexos do lead que o negócio ainda não tem entram nele.
-- =============================================================================

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
    update public.deals
       set lead_id = p_lead_id,
           lead_origin = coalesce(lead_origin,
             (select ls.label from public.lead_sources ls where ls.id = v_lead.source_id), v_lead.utm_source)
     where id = p_deal_id;
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

revoke all on function public.vincular_lead_a_negocio(uuid, uuid, text) from public, anon;
grant execute on function public.vincular_lead_a_negocio(uuid, uuid, text) to authenticated, service_role;
comment on function public.vincular_lead_a_negocio(uuid, uuid, text) is
  'Liga o lead a um negócio existente (convertido, sem criar negócio novo). Exige o CPF de um cliente do negócio, e permissão sobre o lead e sobre o negócio.';
