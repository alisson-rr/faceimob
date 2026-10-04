-- =============================================================================
-- 0220 — roleta igualitária: com vários leads esperando, cada corretor recebe
-- um; quem tem lead esperando "Atender" sai da vez até atender.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

update public.automation_settings set leads_recomeco_em = null, leads_paused = false;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  cora uuid := '00000000-0000-0000-0000-000002200001';
  corb uuid := '00000000-0000-0000-0000-000002200002';
  v_group uuid;
  v_shift uuid;
  l1 uuid; l2 uuid; l3 uuid;
  v_a int; v_b int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cora, 'cora@r220.test', '{"full_name":"Corretora A 220"}'),
    (corb, 'corb@r220.test', '{"full_name":"Corretor B 220"}');
  insert into public.user_roles (profile_id, role) values (cora, 'broker'), (corb, 'broker') on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active)
    values ('Roleta 220', 'roleta-220', 'specific', true) returning id into v_group;
  insert into public.distribution_group_members (group_id, profile_id, active)
    values (v_group, cora, true), (v_group, corb, true);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
    values ('teste-220', 'Integral 220', '00:00', '00:00', '23:59', -220) returning id into v_shift;
  -- A chegou primeiro: é a primeira da fila.
  insert into public.checkins (profile_id, shift_id, work_date, checked_in_at) values
    (cora, v_shift, public.current_work_date(), now() - interval '2 hours'),
    (corb, v_shift, public.current_work_date(), now() - interval '1 hour');

  -- Três leads esperando quando a roleta abre (a fila da noite).
  insert into public.leads (full_name, phone, distribution_group_id, status, created_at) values
    ('Lead 220 #1', '11900220001', v_group, 'queued', now() - interval '10 hours') returning id into l1;
  insert into public.leads (full_name, phone, distribution_group_id, status, created_at) values
    ('Lead 220 #2', '11900220002', v_group, 'queued', now() - interval '9 hours') returning id into l2;
  insert into public.leads (full_name, phone, distribution_group_id, status, created_at) values
    ('Lead 220 #3', '11900220003', v_group, 'queued', now() - interval '8 hours') returning id into l3;

  perform public.assign_lead(l1);
  perform public.assign_lead(l2);
  perform public.assign_lead(l3);

  select count(*) into v_a from public.leads where id in (l1, l2, l3) and assigned_to = cora;
  select count(*) into v_b from public.leads where id in (l1, l2, l3) and assigned_to = corb;
  perform pg_temp.ok(v_a = 1 and v_b = 1, format('um para cada: A=%s, B=%s', v_a, v_b));
  perform pg_temp.ok((select status from public.leads where id = l3) = 'queued',
    'o terceiro espera alguém atender, não cai em quem já tem lead');
  perform pg_temp.ok((select assigned_to from public.leads where id = l1) = cora,
    'o primeiro lead vai para quem chegou primeiro');

  -- A clica em "Atender": volta para a vez e recebe o próximo.
  update public.lead_assignments set responded_at = now()
   where lead_id = l1 and released_at is null;
  perform public.assign_lead(l3);
  perform pg_temp.ok((select assigned_to from public.leads where id = l3) = cora,
    'depois de atender, A volta para a vez e recebe o próximo');

  perform pg_temp.ok(
    (select count(*) from public.distribution_queue_interna(v_group)) = 0,
    'com os dois esperando Atender, a fila está vazia');
end;
$$;

rollback;
