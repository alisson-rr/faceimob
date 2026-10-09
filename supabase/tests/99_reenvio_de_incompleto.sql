-- =============================================================================
-- 0253 — reenvio a partir de INCOMPLETO encerra o caso aberto da CCA.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002530001';
  ger uuid := '00000000-0000-0000-0000-000002530002';
  v_deal uuid;
  v_ok boolean;
  v_dev uuid;
begin
  insert into public.developers (name, slug) values ('Construtora 253', 'construtora-253') returning id into v_dev;
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c253.test', '{"full_name":"Corretor 253"}'),
    (ger, 'ger@c253.test', '{"full_name":"Gerente 253"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ger, 'manager') on conflict do nothing;
  insert into public.deals (stage_id, created_by, document_review_status)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'approved')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal, ger, 'manager', 1) on conflict do nothing;
  insert into public.cca_cases (deal_id, status, submitted_at) values (v_deal, 'under_review', now());
  update public.deals set status_detail = 'ANÁLISE EXTERNA', document_review_status = 'approved',
         developer_id = v_dev where id = v_deal;
  -- Sem tipo obrigatório no catálogo: o teste é a trava do caso, não a dos anexos.
  update public.document_types set required_for_conversion = false;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  -- Fora de INCOMPLETO o caso em análise continua travando.
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio', 'agil');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then raise exception 'FALHOU: caso em análise devia travar o reenvio fora de INCOMPLETO'; end if;
  raise notice '  ok  em análise, fora de INCOMPLETO, o reenvio segue travado';

  perform set_config('request.jwt.claims', '', true);
  update public.deals set status_detail = 'INCOMPLETO' where id = v_deal;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform public.submit_deal_for_manager_review(v_deal, 'Era Esteira Ágil, não análise externa', 'agil');
  if (select status from public.cca_cases where deal_id = v_deal) <> 'cancelled'
     or (select document_review_status from public.deals where id = v_deal) <> 'pending' then
    raise exception 'FALHOU: em INCOMPLETO o reenvio devia encerrar o caso e ir ao gerente';
  end if;
  raise notice '  ok  em INCOMPLETO o reenvio encerra o caso antigo e vai ao gerente';
end;
$$;

rollback;
