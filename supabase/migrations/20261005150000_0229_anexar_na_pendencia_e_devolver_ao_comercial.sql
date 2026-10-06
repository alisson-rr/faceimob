-- =============================================================================
-- 0229 — anexar na pendência e "Devolver ao comercial" pela CCA
--
-- Pedido de 05/10/2026:
--   1. Marcelo (Diandra): o reenvio passou (0228), mas "Faltam documentos
--      obrigatórios" e o corretor não conseguia anexar — a trava de anexo
--      ainda exigia o dossiê em rascunho/devolvido, e o negócio estava
--      aprovado pelo gerente, pendente na CCA sem ter passado pela coluna de
--      pendência. Anexar segue agora a mesma regra do reenvio:
--      `dossie_com_o_comercial` — rascunho, devolvido, ou aprovado sem caso em
--      análise na CCA.
--   2. CCA: no negócio INCOMPLETO, "Devolver ao comercial" tira o caso da
--      esteira (cancelado, fora do quadro), mantém o Status 2 e devolve o
--      dossiê ao corretor com a mensagem, para ele completar e reenviar.
-- =============================================================================

create or replace function public.dossie_com_o_comercial(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select coalesce(d.document_review_status, 'draft') in ('draft', 'returned')
        or (d.document_review_status = 'approved'
            and not exists (select 1 from public.cca_cases c
                             where c.deal_id = d.id
                               and c.status in ('under_review', 'sent_to_agency', 'sent_to_developer')))
      from public.deals d where d.id = p_deal_id), false);
$$;

revoke all on function public.dossie_com_o_comercial(uuid) from public, anon;
grant execute on function public.dossie_com_o_comercial(uuid) to authenticated, service_role;

comment on function public.dossie_com_o_comercial(uuid) is
  'O dossiê está com o comercial (anexar e reenviar): rascunho, devolvido, ou aprovado sem caso em análise na CCA (0229).';

drop policy if exists deal_documents_insert on public.deal_documents;
create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check (
    public.can_edit_deal(deal_id)
    and (public.is_admin() or public.has_permission('cca.review') or public.dossie_com_o_comercial(deal_id))
  );

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage do Supabase ausente - policy de bucket ignorada (ambiente de teste)';
    return;
  end if;
  execute 'drop policy if exists deal_documents_storage_insert on storage.objects';
  execute $p$
    create policy deal_documents_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'deal-documents'
        and public.deal_id_of_object(storage.objects.name) is not null
        and (
          (
            public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
            and (
              public.is_admin()
              or public.has_permission('cca.review')
              or public.dossie_com_o_comercial(public.deal_id_of_object(storage.objects.name))
            )
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and a.lead_id = public.deal_id_of_object(storage.objects.name)
          )
        )
      )
  $p$;
end;
$$;

-- 2. Devolver ao comercial ---------------------------------------------------------
create or replace function public.devolver_ao_comercial(p_deal_id uuid, p_mensagem text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg  text := btrim(coalesce(p_mensagem, ''));
  v_deal public.deals;
  v_case public.cca_cases;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('cca')) then
    raise exception 'Só a CCA devolve o negócio ao comercial.' using errcode = '42501';
  end if;
  if v_msg = '' then
    raise exception 'Escreva o que falta: a mensagem vai para o corretor.' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  select * into v_case from public.cca_cases
   where deal_id = p_deal_id and status not in ('approved', 'rejected', 'cancelled')
   for update;
  if not found then
    raise exception 'Este negócio não está na esteira da CCA.' using errcode = 'P0001';
  end if;

  update public.cca_cases
     set status = 'cancelled', decided_at = now(), decision_notes = left(v_msg, 2000)
   where id = v_case.id;

  update public.deals
     set document_review_status = 'returned',
         document_reviewed_at   = now(),
         document_reviewed_by   = auth.uid(),
         document_review_reason = left('Devolvido pela CCA ao comercial: ' || v_msg, 2000)
   where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', left('CCA — DEVOLVIDO AO COMERCIAL: ' || v_msg, 4000));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id, 'document_review_returned',
         'CCA devolveu ao comercial: ' || coalesce(v_deal.code, 'negócio'),
         left(v_msg, 2000), '/pipeline', 'in_app'::notification_channel
    from public.deal_participants dp
   where dp.deal_id = p_deal_id and dp.role = 'broker';
end;
$$;

revoke all on function public.devolver_ao_comercial(uuid, text) from public, anon;
grant execute on function public.devolver_ao_comercial(uuid, text) to authenticated;

comment on function public.devolver_ao_comercial(uuid, text) is
  'CCA tira o caso da esteira (cancelado), mantém o Status 2 e devolve o dossiê ao corretor com a mensagem (0229).';
