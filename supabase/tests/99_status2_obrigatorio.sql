-- 0352 — Status 2 obrigatório na conversão: grava o escolhido e recusa em branco.
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
  cor uuid := '00000000-0000-0000-0000-000003520001';
  v_dev uuid; v_lead uuid; v_lead2 uuid;
  v_deal public.deals;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c352.test', '{"full_name":"Corretor 352"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.developers (name, flow) values ('Construtora 352', 'internal') returning id into v_dev;
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 352', '11955352001', 'in_progress', cor) returning id into v_lead;
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 352 b', '11955352002', 'in_progress', cor) returning id into v_lead2;

  perform set_config('request.jwt.claims', json_build_object('sub', cor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.convert_lead_to_deal(v_lead, v_dev, p_project_name => 'Res 352', p_status_detail => '  ');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  perform pg_temp.ok(v_msg = 'Escolha o Status 2 do negócio.', 'conversão com Status 2 em branco é recusada');

  v_deal := public.convert_lead_to_deal(v_lead, v_dev, p_project_name => 'Res 352', p_status_detail => 'PENDENTE');
  perform pg_temp.ok(v_deal.status_detail = '16. PENDENTE', 'conversão grava o valor do cadastro, sem depender do número');

  reset role;
end;
$$;

rollback;
