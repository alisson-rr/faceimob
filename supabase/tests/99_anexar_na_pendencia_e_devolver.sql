-- =============================================================================
-- 0229 — dossiê com o comercial e "Devolver ao comercial".
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002290001';
  cca uuid := '00000000-0000-0000-0000-000002290002';
  v_deal uuid;
  v_status text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c229.test', '{"full_name":"Corretor 229"}'),
    (cca, 'cca@c229.test', '{"full_name":"CCA 229"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (cca, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail, document_review_status)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'INCOMPLETO', 'approved')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;
  insert into public.cca_cases (deal_id, status, submitted_at) values (v_deal, 'under_review', now());
  -- Entrar na esteira grava ESTEIRA AGIL; o caso da CCA é o que ficou INCOMPLETO depois.
  update public.deals set status_detail = 'INCOMPLETO', document_review_status = 'approved' where id = v_deal;

  if public.dossie_com_o_comercial(v_deal) then
    raise exception 'FALHOU: com o caso em análise o dossiê não é do comercial';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  perform public.devolver_ao_comercial(v_deal, 'Falta o comprovante de residência.');
  select d.document_review_status::text into v_status from public.deals d where d.id = v_deal;
  if v_status <> 'returned' or (select status from public.cca_cases where deal_id = v_deal) <> 'cancelled'
     or (select public.deal_status_bare(status_detail) from public.deals where id = v_deal) <> 'INCOMPLETO' then
    raise exception 'FALHOU: devolver ao comercial (% )', v_status;
  end if;
  if not public.dossie_com_o_comercial(v_deal) then
    raise exception 'FALHOU: devolvido, o dossiê devia voltar ao comercial';
  end if;
  raise notice '  ok  devolver tira da esteira, mantém INCOMPLETO e libera o anexo ao corretor';

  -- Aprovado sem caso em análise também é do comercial (caso Diandra).
  update public.deals set document_review_status = 'approved' where id = v_deal;
  if not public.dossie_com_o_comercial(v_deal) then
    raise exception 'FALHOU: aprovado sem caso em análise devia aceitar anexo';
  end if;
  raise notice '  ok  aprovado sem caso em análise aceita anexo';
end;
$$;

rollback;
