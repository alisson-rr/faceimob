-- =============================================================================
-- 0215 — corretor coloca o negócio em ANÁLISE EXTERNA sem a conferência do
-- gerente; os status da esteira continuam só pelo envio ao gerente.
-- =============================================================================
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
  cor uuid := '00000000-0000-0000-0000-000002150001';
  v_deal uuid;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@a215.test', '{"full_name":"Corretor 215"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1)
    on conflict do nothing;

  perform pg_temp.ok(
    (select bool_and(p.can_enter) from public.deal_status_permissions p
       join public.deal_statuses s on s.id = p.status_id
      where public.deal_status_bare(s.value) = 'ANÁLISE EXTERNA' and p.role in ('broker', 'manager', 'director')),
    'corretor, gerente e diretor colocam em ANÁLISE EXTERNA');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.move_deal_status(v_deal, 'ANÁLISE EXTERNA', null);
  reset role;
  perform pg_temp.ok(
    (select public.deal_status_bare(status_detail) = 'ANÁLISE EXTERNA' and document_review_status is distinct from 'pending'
       from public.deals where id = v_deal),
    'o corretor move direto, sem abrir conferência do gerente');

  set local role authenticated;
  begin
    perform public.move_deal_status(v_deal, '13. ESTEIRA AGIL', null);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Para voltar à análise%', 'a esteira continua pelo envio ao gerente');
end;
$$;

rollback;
