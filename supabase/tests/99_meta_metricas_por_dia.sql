-- 0350 — números da Meta por dia: soma por dia, recorte de lead sem a campanha
-- `outro`, e só quem vê finanças.
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
  adm uuid := '00000000-0000-0000-0000-000003500001';
  cor uuid := '00000000-0000-0000-0000-000003500002';
  c_form uuid; c_alcance uuid;
  d1 date := date '2030-01-10';
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c350.test', '{"full_name":"Admin 350"}'),
    (cor, 'cor@c350.test', '{"full_name":"Corretor 350"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;

  insert into public.ad_campaigns (name, external_id, meta_channel) values ('Form 350', '9993500001', 'formulario') returning id into c_form;
  insert into public.ad_campaigns (name, external_id, meta_channel) values ('Alcance 350', '9993500002', 'outro') returning id into c_alcance;
  insert into public.meta_campaign_insights_daily (campaign_id, day, spend, impressions, link_clicks, resultados) values
    (c_form,    d1,     100, 1000, 20, 10),
    (c_alcance, d1,      50, 5000, 30,  0),
    (c_form,    d1 + 1,  60,  800, 10,  3);

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform pg_temp.ok((select count(*) from public.meta_metricas_por_dia(d1, d1 + 1)) = 2, 'uma linha por dia');
  perform pg_temp.ok(
    (select spend = 150 and impressions = 6000 and link_clicks = 50 and resultados = 10
            and spend_lead = 100 and resultados_lead = 10
       from public.meta_metricas_por_dia(d1, d1) ),
    'soma o dia inteiro e separa as campanhas de lead');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.meta_metricas_por_dia(d1, d1);
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'barrado';
  end;
  perform pg_temp.ok(v_msg = 'barrado', 'corretor não vê os números da Meta');
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.meta_metricas_por_dia(date,date)', 'execute'), 'anon não executa');

rollback;
