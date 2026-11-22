-- 0353 — funil por etapas: documentos por Status 1, envios do mês à CCA e o
-- que desses envios está aprovado ou vendido; só a liderança abre.
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
  adm uuid := '00000000-0000-0000-0000-000003530001';
  cor uuid := '00000000-0000-0000-0000-000003530002';
  v_mes date := date '2031-03-01';
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
  d1 uuid; d2 uuid; d3 uuid;
  r jsonb;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c353.test', '{"full_name":"Admin 353"}'),
    (cor, 'cor@c353.test', '{"full_name":"Corretor 353"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.deals (stage_id, created_by, month_base, status_detail) values (v_stage, cor, v_mes, '09. APROV. TOTAL') returning id into d1;
  insert into public.deals (stage_id, created_by, month_base, status_detail) values (v_stage, cor, v_mes, '04. EM CONTRATO') returning id into d2;
  insert into public.deals (stage_id, created_by, month_base, status_detail) values (v_stage, cor, (v_mes - interval '1 month')::date, '16. PENDENTE') returning id into d3;
  insert into public.cca_cases (deal_id, submitted_at)
  select x, (v_mes + interval '5 days')::timestamptz from unnest(array[d1, d2, d3]) x;
  -- Abrir o caso reescreve o rótulo da esteira no Status 2; o teste fixa o
  -- status atual de cada negócio depois, sem gatilhos.
  set local session_replication_role = replica;
  update public.deals set status_detail = '09. APROV. TOTAL' where id = d1;
  update public.deals set status_detail = '04. EM CONTRATO',
         status_group_id = (select id from public.deal_status_groups where code = 'VENDA') where id = d2;
  update public.deals set status_detail = '16. PENDENTE' where id = d3;
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.funil_por_etapas(v_mes);
  perform pg_temp.ok((r -> 'envios' ->> 'total')::int = 3 and (r -> 'envios' ->> 'do_mes')::int = 2
                     and (r -> 'envios' ->> 'outros_meses')::int = 1, 'envios do mês separados por mês-base');
  perform pg_temp.ok((r -> 'aprovados' ->> 'total')::int = 2, 'aprovado e quem já avançou contam como aprovados');
  perform pg_temp.ok((r -> 'vendas' ->> 'total')::int = 1, 'em contrato conta como venda');
  -- 0354: a venda é do mês-base, enviada ou não à CCA no mês.
  insert into public.deals (stage_id, created_by, month_base, status_detail) values (v_stage, cor, v_mes, '04. EM CONTRATO');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.funil_por_etapas(v_mes);
  perform pg_temp.ok((r -> 'vendas' ->> 'total')::int = 2, '0354: venda do mês sem envio no mês também conta');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.funil_por_etapas(v_mes);
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'barrado';
  end;
  perform pg_temp.ok(v_msg = 'barrado', 'corretor não abre o funil');
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.funil_por_etapas(date,uuid)', 'execute'), 'anon não executa');

rollback;
