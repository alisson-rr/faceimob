-- =============================================================================
-- 0315 — volta do bloqueio por atrasados vai para o fim da fila, o corretor vê
-- o andamento da própria fila e o lead da campanha fica no grupo da campanha.
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
  ana  uuid := '00000000-0000-0000-0000-000003150001';
  bia  uuid := '00000000-0000-0000-0000-000003150002';
  caio uuid := '00000000-0000-0000-0000-000003150003';
  g uuid;
  g_open uuid;
  t uuid;
  l_atrasado uuid;
  ordem text;
  tipos text;
  v_origem uuid;
  v_agente uuid;
  v_lead uuid;
  v_conv uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana,  'ana@f315.test',  '{"full_name":"Ana 315"}'),
    (bia,  'bia@f315.test',  '{"full_name":"Bia 315"}'),
    (caio, 'caio@f315.test', '{"full_name":"Caio 315"}');
  insert into public.user_roles (profile_id, role) values (ana, 'broker'), (bia, 'broker'), (caio, 'broker')
  on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active) values ('Roleta 315', 'roleta-315', 'specific', true) returning id into g;
  insert into public.distribution_group_members (group_id, profile_id, active)
  values (g, ana, true), (g, bia, true), (g, caio, true);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('integral-315', 'Integral 315', '00:00', '00:00', '23:59:59.999999', -315) returning id into t;
  update public.automation_settings set overdue_block_threshold = 1 where id;

  -- Ana chegou primeiro (60 min), Bia 50, Caio 40.
  insert into public.checkins (profile_id, shift_id, work_date, checked_in_at) values
    (ana,  t, public.current_work_date(), now() - interval '60 minutes'),
    (bia,  t, public.current_work_date(), now() - interval '50 minutes'),
    (caio, t, public.current_work_date(), now() - interval '40 minutes');

  -- Ana tem um lead atrasado: sai da fila.
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Atrasado 315', '11900315001', 'attending', ana, now() - interval '30 minutes', now() - interval '5 minutes')
  returning id into l_atrasado;
  perform public.fila_registrar_bloqueios();
  perform pg_temp.ok(exists (select 1 from public.fila_bloqueios where profile_id = ana and fim is null),
    'o lead atrasado abre o bloqueio da Ana');

  -- Ela regulariza: volta, mas no FIM (antes voltava em 1º, na frente de todos).
  update public.leads set next_action_at = now() + interval '1 day' where id = l_atrasado;
  perform public.fila_registrar_bloqueios();
  select string_agg(p.full_name, ' > ' order by q.queue_position) into ordem
    from public.distribution_queue_interna(g) q join public.profiles p on p.id = q.profile_id;
  perform pg_temp.ok(ordem = 'Bia 315 > Caio 315 > Ana 315',
    'quem volta do bloqueio por atrasados entra no fim da fila (' || coalesce(ordem, '∅') || ')');

  -- O andamento conta à Ana por que ela foi para o fim.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select string_agg(tipo, ',' order by ocorreu_em, tipo) into tipos from public.minha_fila_andamento();
  perform pg_temp.ok(tipos like 'checkin%' and tipos like '%bloqueado%' and tipos like '%desbloqueado%',
    'o andamento mostra check-in, bloqueio e volta (' || coalesce(tipos, '∅') || ')');
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(not exists (select 1 from public.minha_fila_andamento() where tipo like '%bloqueado'),
    'o andamento é só da própria pessoa');
  perform set_config('request.jwt.claims', '', true);

  -- Campanha do grupo Open: o lead herda o grupo da origem...
  insert into public.distribution_groups (name, slug, kind, active) values ('Open 315', 'open-315', 'specific', true) returning id into g_open;
  insert into public.lead_sources (code, label, channel, distribution_group_id)
  values ('campanha_open_315', 'Campanha Open 315', 'whatsapp', g_open) returning id into v_origem;
  insert into public.leads (full_name, phone, status, source_id) values ('Lead Open 315', '11900315002', 'queued', v_origem)
  returning id into v_lead;
  perform pg_temp.ok((select distribution_group_id from public.leads where id = v_lead) = g_open,
    'o lead da campanha nasce no grupo da campanha');

  -- ...e a entrega da IA não o desvia para o grupo do agente.
  insert into public.sdr_agents (name, role, handoff_group_id) values ('Agente 315', 'qualifier', g) returning id into v_agente;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (v_lead, v_agente, 'active') returning id into v_conv;
  perform public.sdr_handoff(v_conv, 'qualified');
  perform pg_temp.ok((select distribution_group_id from public.leads where id = v_lead) = g_open,
    'a entrega da IA mantém o grupo da campanha');
end;
$$;

rollback;
