-- =============================================================================
-- 0200 — fila da roleta em ordem de chegada: check-in fixa a posição, novo
-- check-in vai para o fim, quem recebe vai para o fim e quem recebeu ontem não
-- fura a fila de hoje.
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
  ana  uuid := '00000000-0000-0000-0000-000002000001';
  bia  uuid := '00000000-0000-0000-0000-000002000002';
  caio uuid := '00000000-0000-0000-0000-000002000003';
  duda uuid := '00000000-0000-0000-0000-000002000004';
  g uuid;
  t uuid;
  l_ontem uuid;
  l_ana uuid;
  ordem text;
  l_novo uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana,  'ana@f200.test',  '{"full_name":"Ana 200"}'),
    (bia,  'bia@f200.test',  '{"full_name":"Bia 200"}'),
    (caio, 'caio@f200.test', '{"full_name":"Caio 200"}'),
    (duda, 'duda@f200.test', '{"full_name":"Duda 200"}');
  insert into public.user_roles (profile_id, role) values (ana, 'broker'), (bia, 'broker'), (caio, 'broker'), (duda, 'broker')
  on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active) values ('Roleta 200', 'roleta-200', 'specific', true) returning id into g;
  insert into public.distribution_group_members (group_id, profile_id, active)
  values (g, ana, true), (g, bia, true), (g, caio, true), (g, duda, true);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('integral-200', 'Integral 200', '00:00', '00:00', '23:59:59.999999', -200) returning id into t;

  -- Ana 60 min atrás, Bia 50, Caio 40, Duda 10.
  insert into public.checkins (profile_id, shift_id, work_date, checked_in_at) values
    (ana,  t, public.current_work_date(), now() - interval '60 minutes'),
    (bia,  t, public.current_work_date(), now() - interval '50 minutes'),
    (caio, t, public.current_work_date(), now() - interval '40 minutes'),
    (duda, t, public.current_work_date(), now() - interval '10 minutes');

  -- Caio recebeu ontem; Ana recebeu há 5 minutos.
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Ontem 200', '11900200001', 'attending', caio, now() - interval '1 day', now() + interval '1 day') returning id into l_ontem;
  -- Leads em atendimento: o "Atender" já foi clicado (responded_at), como no
  -- `claim_lead` — senão a 0220 os tiraria da vez.
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline, assigned_at, responded_at)
  values (l_ontem, caio, g, 1, now(), now() - interval '1 day', now() - interval '1 day');
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Ana 200', '11900200002', 'attending', ana, now() - interval '5 minutes', now() + interval '1 day') returning id into l_ana;
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline, assigned_at, responded_at)
  values (l_ana, ana, g, 1, now(), now() - interval '5 minutes', now() - interval '4 minutes');

  select string_agg(p.full_name, ' > ' order by q.queue_position) into ordem
    from public.distribution_queue_interna(g) q join public.profiles p on p.id = q.profile_id;
  perform pg_temp.ok(ordem = 'Bia 200 > Caio 200 > Duda 200 > Ana 200',
    'ordem de chegada: quem recebeu ontem não fura, novo check-in no fim, quem recebeu vai para o fim (' || coalesce(ordem, '∅') || ')');

  insert into public.leads (full_name, phone, distribution_group_id) values ('Novo 200', '11900200003', g) returning id into l_novo;
  perform pg_temp.ok(public.assign_lead(l_novo) = bia, 'o próximo lead vai para a primeira da fila');
end;
$$;

rollback;
