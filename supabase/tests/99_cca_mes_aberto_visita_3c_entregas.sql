-- =============================================================================
-- 0318 — aviso de visita abre o lead mesmo quando quem agenda não vê o corretor;
-- entregas do turno só nos grupos de quem pergunta.
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
  cor   uuid := '00000000-0000-0000-0000-000003180001';
  outro uuid := '00000000-0000-0000-0000-000003180002';
  v_lead uuid;
  v_link text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor,   'cor@c3180.test',   '{"full_name":"Corretor 3180"}'),
    (outro, 'outro@c3180.test', '{"full_name":"Integracao 3180"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (outro, 'broker') on conflict do nothing;

  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Lead Visita 318', '11900318001', 'attending', cor, now(), now() + interval '1 day')
  returning id into v_lead;

  -- Quem agenda (como a integração 3C) não enxerga o corretor.
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  insert into public.visits (lead_id, broker_id, scheduled_at) values (v_lead, cor, now() + interval '2 days');
  perform set_config('request.jwt.claims', '', true);

  select n.link into v_link from public.notifications n
   where n.profile_id = cor and n.kind = 'visit_scheduled' order by n.created_at desc limit 1;
  perform pg_temp.ok(v_link = '/leads?lead=' || v_lead::text,
    'o aviso da visita abre o lead, e não o Pipeline genérico (' || coalesce(v_link, '∅') || ')');

  -- Entregas do turno: sem grupo, nada volta (e não dá erro).
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok((select count(*) from public.fila_entregas_do_turno()) = 0,
    'corretor sem grupo não vê entregas de grupo nenhum');
end;
$$;

rollback;
