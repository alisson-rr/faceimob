-- =============================================================================
-- 0204 — quem criou o negócio vê cliente e participantes, mesmo sem participar.
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
  autora uuid := '00000000-0000-0000-0000-000002040001';
  dono   uuid := '00000000-0000-0000-0000-000002040002';
  fora   uuid := '00000000-0000-0000-0000-000002040003';
  v_dev uuid; v_etapa uuid; v_deal uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (autora, 'autora@a204.test', '{"full_name":"Autora 204"}'),
    (dono,   'dono@a204.test',   '{"full_name":"Dono 204"}'),
    (fora,   'fora@a204.test',   '{"full_name":"Fora 204"}');
  insert into public.user_roles (profile_id, role) values (autora, 'broker'), (dono, 'broker'), (fora, 'broker')
  on conflict do nothing;
  insert into public.developers (name, flow) values ('Construtora 204', 'internal') returning id into v_dev;
  select id into v_etapa from public.pipeline_stages order by position limit 1;
  insert into public.deals (code, developer_id, stage_id, created_by) values ('A204', v_dev, v_etapa, autora) returning id into v_deal;
  insert into public.deal_clients (deal_id, ordinal, full_name) values (v_deal, 1, 'Cliente 204');
  insert into public.deal_participants (deal_id, profile_id, role) values (v_deal, dono, 'broker');

  perform set_config('request.jwt.claims', json_build_object('sub', autora::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(exists (select 1 from public.deals where id = v_deal), 'a autora vê o negócio');
  perform pg_temp.ok((select full_name from public.deal_clients where deal_id = v_deal) = 'Cliente 204', 'e vê o nome do cliente');
  perform pg_temp.ok(exists (select 1 from public.deal_participants where deal_id = v_deal and profile_id = dono), 'e vê o corretor');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', fora::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.deal_clients where deal_id = v_deal), 'quem não criou nem participa continua sem ver');
  reset role;
end;
$$;

rollback;
