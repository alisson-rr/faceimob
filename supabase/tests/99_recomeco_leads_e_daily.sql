-- =============================================================================
-- 0187 — corretor não vê lead de antes do recomeço; gerente acha o link do daily.
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
  cor uuid := '00000000-0000-0000-0000-000001870001';
  ger uuid := '00000000-0000-0000-0000-000001870002';
  out_ger uuid := '00000000-0000-0000-0000-000001870003';
  v_time uuid;
  v_n int;
  v_overdue int;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor,'cor@r187.test','{"full_name":"Corretor 187"}'),
    (ger,'ger@r187.test','{"full_name":"Gerente 187"}'),
    (out_ger,'out@r187.test','{"full_name":"Outro Gerente 187"}');
  insert into public.user_roles(profile_id,role) values (ger,'manager'),(out_ger,'manager') on conflict do nothing;
  insert into public.teams(name, manager_id) values ('Equipe 187', ger) returning id into v_time;
  insert into public.team_members(team_id, profile_id) values (v_time, cor);
  insert into public.public_links(kind, team_id, slug) values ('daily_team', v_time, 'daily187');

  update public.automation_settings set leads_recomeco_em = now() - interval '1 hour';
  insert into public.leads(full_name, phone, assigned_to, assigned_at, created_at, status, next_action_at) values
    ('Antigo 187', '51999991871', cor, now() - interval '3 days', now() - interval '3 days', 'assigned', now() - interval '2 days'),
    ('Novo 187', '51999991872', cor, now(), now(), 'assigned', null);

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.leads where full_name like '% 187';
  reset role;
  perform pg_temp.ok(v_n = 1, 'corretor só vê o lead de depois do recomeço');
  v_overdue := public.overdue_lead_count(cor);
  perform pg_temp.ok(v_overdue = 0, 'lead antigo atrasado não trava o check-in');

  perform set_config('request.jwt.claims', json_build_object('sub', ger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.leads where full_name like '% 187';
  perform pg_temp.ok(v_n = 2, 'gerente continua vendo os leads antigos da equipe');
  perform pg_temp.ok((select slug from public.meus_links_de_daily() where team_id = v_time) = 'daily187',
    'gerente recebe o link do daily da equipe dele');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', out_ger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.meus_links_de_daily() where team_id = v_time),
    'gerente de outra equipe não recebe o link');
  reset role;
end
$$;

rollback;
