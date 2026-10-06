-- 0235 — gerente OU diretor vinculado pode conferir a proposta pendente.
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
  ) then
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
  'Gerente ou diretor participante (e admin/sócio) confere a documentação pendente.';
