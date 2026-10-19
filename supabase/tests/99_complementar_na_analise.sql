-- =============================================================================
-- 0290 — o complementar sai mesmo com a análise na CCA; o aprovado, não.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000002900001';
  v_deal uuid;
  v_tipo uuid := (select id from public.document_types where active order by sort_order limit 1);
  v_aprovado uuid;
  v_compl    uuid;
  v_n    int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c290.test', '{"full_name":"Corretor 290"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'INCOMPLETO')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;

  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/290-aprovado.pdf', 'a.pdf', '290-aprovado.pdf', cor)
    returning id into v_aprovado;
  update public.deals set status_detail = 'APROVADO TOTAL', document_review_status = 'approved' where id = v_deal;
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at) values (v_deal, 'approved', now(), now());
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/290-compl.pdf', 'c.pdf', '290-compl.pdf', cor)
    returning id into v_compl;

  -- Análise p/ virar negócio enviada: conferência pendente e caso em análise.
  update public.deals set document_review_status = 'pending', review_esteira = 'virar' where id = v_deal;
  update public.cca_cases set status = 'under_review', decided_at = null where deal_id = v_deal;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.deal_documents where id = v_aprovado;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FALHOU: o aprovado continua travado com a análise na CCA'; end if;
  delete from public.deal_documents where id = v_compl;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FALHOU: o complementar deveria sair com a análise na CCA'; end if;
  raise notice '  ok  complementar sai na análise, aprovado fica';
end;
$$;

rollback;
