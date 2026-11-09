-- =============================================================================
-- 0325 — campanhas em ordem de CPL: todos veem a ordem, só finanças vê o valor.
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
  adm uuid := '00000000-0000-0000-0000-000003250001';
  cor uuid := '00000000-0000-0000-0000-000003250002';
  c_caro uuid;
  c_barato uuid;
  c_zero uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c3250.test', '{"full_name":"Admin 3250"}'),
    (cor, 'cor@c3250.test', '{"full_name":"Corretor 3250"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.ad_campaigns (name, external_id) values ('Caro 325', '9993250001') returning id into c_caro;
  insert into public.ad_campaigns (name, external_id) values ('Barato 325', '9993250002') returning id into c_barato;
  insert into public.ad_campaigns (name, external_id) values ('Sem lead 325', '9993250003') returning id into c_zero;
  insert into public.meta_campaign_insights_daily (campaign_id, day, spend, resultados) values
    (c_caro,   current_date, 100, 2),   -- CPL 50
    (c_barato, current_date, 100, 10),  -- CPL 10
    (c_zero,   current_date, 100, 0);   -- sem CPL

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(
    (select array_agg(campanha_id order by posicao) from public.campanhas_por_cpl(7) where campanha_id like '999325%')
      = array['9993250002', '9993250001', '9993250003'],
    'ordem: menor CPL primeiro, sem resultado no fim');
  perform pg_temp.ok(
    not exists (select 1 from public.campanhas_por_cpl(7) where cpl is not null),
    'corretor vê a ordem, mas não o valor do CPL');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(
    (select cpl from public.campanhas_por_cpl(7) where campanha_id = '9993250002') = 10,
    'admin vê o valor do CPL');
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.campanhas_por_cpl(integer)', 'execute'), 'anon não executa');

rollback;
