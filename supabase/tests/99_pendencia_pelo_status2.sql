-- =============================================================================
-- 0294 — Status 2 em PENDENTE libera o anexo mesmo com o caso numa coluna de
-- análise (caso NEG-001243: AGUARDANDO RETORNO AGÊNCIA, sent_to_agency).
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000002940001';
  v_deal uuid;
  v_tipo uuid := (select id from public.document_types where active order by sort_order limit 1);
  v_ok   boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c294.test', '{"full_name":"Corretor 294"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'APROVADO TOTAL')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;
  update public.deals set document_review_status = 'approved' where id = v_deal;
  insert into public.cca_cases (deal_id, status, submitted_at) values (v_deal, 'sent_to_agency', now());

  if public.dossie_com_o_comercial(v_deal) then
    raise exception 'FALHOU: sem pendência, o caso em análise segue prendendo o dossiê';
  end if;

  update public.deals set status_detail = '16. PENDENTE' where id = v_deal;
  if not public.dossie_com_o_comercial(v_deal) then
    raise exception 'FALHOU: Status 2 em PENDENTE deveria devolver o dossiê ao comercial';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
      values (v_deal, v_tipo, v_deal || '/294-pend.pdf', 'p.pdf', '294-pend.pdf', cor);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'FALHOU: corretor deveria anexar a pendência'; end if;
  raise notice '  ok  pendência pelo Status 2 libera o anexo';
end;
$$;

rollback;
