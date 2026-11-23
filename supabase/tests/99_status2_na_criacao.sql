-- 0355 — na criação o corretor grava INCOMPLETO sem a permissão de alterar Status 2.
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
  cor uuid := '00000000-0000-0000-0000-000003550001';
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c355.test', '{"full_name":"Corretor 355"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);

  perform set_config('request.jwt.claims', json_build_object('sub', cor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.deals (stage_id, created_by, month_base, status_detail)
    values (v_stage, cor, public.month_start(current_date), 'INCOMPLETO');
    v_msg := 'gravou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg = 'gravou', 'corretor cria negócio com Status 2 INCOMPLETO (' || v_msg || ')');
end;
$$;

rollback;
