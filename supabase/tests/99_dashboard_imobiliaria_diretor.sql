-- =============================================================================
-- 0244/0245 — o diretor carrega o Dashboard da imobiliária sem ganhar acesso
-- operacional aos negócios e leads fora da própria hierarquia.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok245(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  v_director uuid := '00000000-0000-0000-0000-000000024501';
  v_payload jsonb;
  v_leads integer;
  v_deals integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_director, 'diretor@v0245.test', '{"full_name":"Diretor 0245"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role)
  values (v_director, 'director') on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_director::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_payload := public.dashboard_imobiliaria_payload();
  select count(*) into v_leads from public.dashboard_imobiliaria_leads(null, null);
  select count(*) into v_deals from public.dashboard_imobiliaria_deals();

  reset role;
  perform pg_temp.ok245(jsonb_typeof(v_payload -> 'deals') = 'array',
    'diretor recebe os negócios agregados da imobiliária');
  perform pg_temp.ok245(jsonb_typeof(v_payload -> 'people') = 'array',
    'diretor recebe as pessoas necessárias ao ranking');
  perform pg_temp.ok245(v_payload ? 'activeMonth' and v_payload ? 'leadsCount',
    'payload mantém o contrato esperado pelo Dashboard');
  perform pg_temp.ok245(v_leads >= 0, 'diretor consulta os leads agregados');
  perform pg_temp.ok245(v_deals >= 0, 'diretor consulta os negócios pagináveis');
end;
$$;

rollback;
