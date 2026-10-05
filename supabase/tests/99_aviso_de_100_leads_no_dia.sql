-- =============================================================================
-- 0223 — aviso único quando os leads do dia chegam a 100.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002230001';
  v_inicio timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_hoje int;
  v_avisos int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (adm, 'adm@c223.test', '{"full_name":"Admin 223"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin') on conflict do nothing;
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_hoje from public.leads where created_at >= v_inicio;
  if v_hoje >= 99 then
    raise exception 'FALHOU: o cenário precisa de menos de 99 leads hoje (há %)', v_hoje;
  end if;

  insert into public.leads (full_name, phone)
  select 'Lead 223 #' || g, '1190223' || lpad(g::text, 4, '0') from generate_series(1, 99 - v_hoje) g;
  select count(*) into v_avisos from public.notifications where profile_id = adm and kind = 'lead_marca_do_dia';
  if v_avisos <> 0 then
    raise exception 'FALHOU: avisou antes do 100º lead';
  end if;
  raise notice '  ok  99 leads no dia: sem aviso';

  insert into public.leads (full_name, phone) values ('Lead 223 cem', '11902239100');
  select count(*) into v_avisos from public.notifications where profile_id = adm and kind = 'lead_marca_do_dia';
  if v_avisos <> 1 then
    raise exception 'FALHOU: o 100º lead devia gerar 1 aviso (gerou %)', v_avisos;
  end if;
  raise notice '  ok  100º lead avisa o admin';

  insert into public.leads (full_name, phone) values ('Lead 223 cento e um', '11902239101');
  select count(*) into v_avisos from public.notifications where profile_id = adm and kind = 'lead_marca_do_dia';
  if v_avisos <> 1 then
    raise exception 'FALHOU: o aviso do dia repetiu (% avisos)', v_avisos;
  end if;
  raise notice '  ok  101º lead não repete o aviso';
end;
$$;

rollback;
