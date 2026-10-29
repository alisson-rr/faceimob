-- 0281 revoga o atalho da 0274: o rótulo não substitui aprovação ou
-- pendência legítima da segunda análise.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002740001';
  v_deal uuid; v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (adm, 'adm@a274.test', '{"full_name":"Admin 274"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin') on conflict do nothing;
  insert into public.deals (stage_id, created_by, review_esteira, document_review_status)
    values ((select id from public.pipeline_stages where is_initial limit 1), adm, 'agil', 'approved') returning id into v_deal;
  insert into public.cca_cases (deal_id, status, submitted_at) values (v_deal, 'pending_documents', now());

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio', 'virar');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'A análise p/ virar negócio é o 2º envio%', 'sem o Status 2 de pendência, o caso da Ágil não reenvia por virar');

  update public.deals set status_detail = (select value from public.deal_statuses where public.deal_status_bare(value) = 'PENDENTE P/ VIRAR NEGÓCIO' limit 1) where id = v_deal;
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio', 'virar');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'A análise p/ virar negócio é o 2º envio%',
    'o rótulo PENDENTE P/ VIRAR não libera caso da Ágil (' || v_msg || ')');

  update public.deals set review_esteira = 'virar' where id = v_deal;
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'reenvio legítimo', 'virar');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg not like 'A análise p/ virar negócio é o 2º envio%', 'pendência do segundo envio continua elegível');

  update public.cca_cases set status = 'cancelled' where deal_id = v_deal;
  set local role authenticated;
  begin
    perform public.submit_deal_for_manager_review(v_deal, 'devolvido ao comercial', 'virar');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'A análise p/ virar negócio é o 2º envio%', 'caso cancelado pela devolução não reutiliza a aprovação');
end;
$$;

rollback;
