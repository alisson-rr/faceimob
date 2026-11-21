-- =============================================================================
-- 0352 · Status 2 obrigatório: nenhum negócio nasce ou fica em branco
--
-- Pedido de 21/11/2026: "o corretor escolhe o que colocar, o que não pode é
-- deixar em branco". Os 18 negócios de novembro sem Status 2 foram passados a
-- INCOMPLETO pela tela (move_deal_status), um a um, a pedido do administrador.
--
--   1. `convert_lead_to_deal` recebe `p_status_detail` (o valor do cadastro,
--      comparado sem o prefixo numerado). Em branco é recusado. O padrão
--      'PROPOSTA' só existe para chamadas antigas; a tela sempre manda o
--      escolhido.
--   2. Criar e reabrir pela tela já exigem o Status 2 (ficha do negócio,
--      conversão, reabrir OFF → INCOMPLETO).
--      ponytail: sem gatilho no banco — 17 asserts antigos criam negócio sem
--      Status 2 pela API para testar a derivação do Status 1; evoluir para um
--      gatilho quando aparecer negócio em branco criado fora da tela.
-- =============================================================================

-- 1. Conversão com Status 2 -----------------------------------------------------
drop function if exists public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric, text);

create or replace function public.convert_lead_to_deal(
  p_lead_id      uuid,
  p_developer_id uuid,
  p_project_id   uuid default null,
  p_unit         text default null,
  p_vgv_gross    numeric default null,
  p_project_name text default null,
  p_status_detail text default 'PROPOSTA'
)
returns public.deals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_stage   uuid;
  v_deal    public.deals;
  v_owner   uuid;
  v_nome    text := nullif(btrim(p_project_name), '');
  v_projeto uuid := p_project_id;
  v_status  text := nullif(btrim(replace(coalesce(p_status_detail, ''), chr(160), ' ')), '');
begin
  if v_status is null then
    raise exception 'Escolha o Status 2 do negócio.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.deal_statuses s
                  where public.deal_status_bare(replace(s.value, chr(160), ' ')) = public.deal_status_bare(v_status)) then
    raise exception 'Status 2 fora do cadastro: %.', v_status using errcode = '22023';
  end if;

  if char_length(v_nome) > 120 then
    raise exception 'O nome do empreendimento passa de 120 caracteres.' using errcode = '22023';
  end if;

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

  -- Nome digitado que bate com o cadastro da construtora liga o vínculo; o
  -- nome é gravado sempre.
  if v_projeto is null and v_nome is not null and p_developer_id is not null then
    select dp.id into v_projeto
      from public.developer_projects dp
     where dp.developer_id = p_developer_id and lower(btrim(dp.name)) = lower(v_nome)
     limit 1;
  end if;

  insert into public.deals (lead_id, developer_id, project_id, project_name, unit, stage_id,
                            vgv_gross, lead_origin, created_by, status_detail)
  values (p_lead_id, p_developer_id, v_projeto, v_nome, p_unit, v_stage,
          p_vgv_gross,
          coalesce((select ls.label from public.lead_sources ls where ls.id = v_lead.source_id),
                   v_lead.utm_source),
          auth.uid(),
          (select s.value from public.deal_statuses s
            where public.deal_status_bare(replace(s.value, chr(160), ' ')) = public.deal_status_bare(v_status)
            limit 1))
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

  select * into v_deal from public.deals where id = v_deal.id;
  return v_deal;
end;
$$;

revoke all on function public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.convert_lead_to_deal(uuid, uuid, uuid, text, numeric, text, text) to authenticated;

