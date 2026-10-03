-- =============================================================================
-- 0201 — gerente e diretor trocam o mês-base com motivo; corretor não troca.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.tenta(uid uuid, deal uuid, mes date, motivo text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.alterar_mes_base(deal, mes, motivo);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end;
$$;

do $$
declare
  ger uuid := '00000000-0000-0000-0000-000002010001';
  dir uuid := '00000000-0000-0000-0000-000002010002';
  cor uuid := '00000000-0000-0000-0000-000002010003';
  v_team uuid; v_dev uuid; v_lead uuid;
  v_deal public.deals;
  v_mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ger, 'ger@m201.test', '{"full_name":"Gerente 201"}'),
    (dir, 'dir@m201.test', '{"full_name":"Diretor 201"}'),
    (cor, 'cor@m201.test', '{"full_name":"Corretor 201"}');
  insert into public.user_roles (profile_id, role) values (ger, 'manager'), (dir, 'director'), (cor, 'broker')
  on conflict do nothing;
  insert into public.teams (name, manager_id, director_id) values ('Equipe 201', ger, dir) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);
  insert into public.developers (name, flow) values ('Construtora 201', 'internal') returning id into v_dev;
  delete from public.closed_months where period in (public.month_start(current_date), v_mes);
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 201', '11955201001', 'in_progress', cor) returning id into v_lead;

  perform set_config('request.jwt.claims', json_build_object('sub', cor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '201', 300000);
  reset role;

  perform pg_temp.ok(pg_temp.tenta(cor, v_deal.id, v_mes, 'quero mudar') = '42501', 'corretor não troca o mês-base');
  perform pg_temp.ok(pg_temp.tenta(ger, v_deal.id, v_mes, '  ') = '22023', 'sem motivo é recusado');
  perform pg_temp.ok(pg_temp.tenta(ger, v_deal.id, v_mes, 'Assinatura ficou para o mês que vem') = 'ok', 'gerente troca com motivo');
  perform pg_temp.ok((select month_base = v_mes from public.deals where id = v_deal.id), 'o mês-base mudou');
  perform pg_temp.ok(exists (
    select 1 from public.deal_history
     where deal_id = v_deal.id and kind = 'comment' and actor_id = ger
       and to_value like 'MÊS-BASE ALTERADO de % para ' || to_char(v_mes, 'MM/YYYY') || ': Assinatura ficou para o mês que vem'),
    'o motivo fica registrado nos comentários do negócio, com o de → para');
  perform pg_temp.ok(pg_temp.tenta(dir, v_deal.id, public.month_start(current_date), 'Voltou para este mês') = 'ok', 'diretor também troca');
  perform pg_temp.ok(pg_temp.tenta(dir, v_deal.id, public.month_start(current_date), 'De novo') = '22023', 'mesmo mês é recusado');
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.alterar_mes_base(uuid, date, text)', 'execute'), 'anon não executa');

rollback;
