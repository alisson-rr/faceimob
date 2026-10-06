-- =============================================================================
-- 0204 — o negócio é de quem participa: quem criou e não participa não vê.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.como(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

do $$
declare
  autora uuid := '00000000-0000-0000-0000-000002040001';
  dono   uuid := '00000000-0000-0000-0000-000002040002';
  v_dev uuid; v_etapa uuid; v_deal uuid; v_novo uuid; v_dividido uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (autora, 'autora@a204.test', '{"full_name":"Autora 204"}'),
    (dono,   'dono@a204.test',   '{"full_name":"Dono 204"}');
  insert into public.user_roles (profile_id, role) values (autora, 'broker'), (dono, 'broker') on conflict do nothing;
  insert into public.developers (name, flow) values ('Construtora 204', 'internal') returning id into v_dev;
  select id into v_etapa from public.pipeline_stages where is_initial order by position limit 1;

  -- Criado pela autora e hoje só com outro corretor (retomado depois de um OFF).
  insert into public.deals (code, developer_id, stage_id, created_by) values ('A204', v_dev, v_etapa, autora) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role) values (v_deal, dono, 'broker')
  on conflict do nothing;
  -- A retomada troca os corretores: quem criou deixa de participar.
  delete from public.deal_participants where deal_id = v_deal and profile_id = autora;

  -- Criado pela autora, dividindo a venda como corretora 2.
  insert into public.deals (code, developer_id, stage_id, created_by) values ('B204', v_dev, v_etapa, autora) returning id into v_dividido;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_dividido, dono, 'broker', 1), (v_dividido, autora, 'broker', 2)
  on conflict (deal_id, profile_id, role) do update set ordinal = excluded.ordinal;

  perform pg_temp.como(autora);
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.deals where id = v_deal), 'quem criou e não participa não vê o negócio');
  perform pg_temp.ok(exists (select 1 from public.deals where id = v_dividido), 'quem divide a venda como corretor 2 continua vendo');
  -- O cadastro: o insert lê a linha recém-criada antes de os participantes entrarem.
  insert into public.deals (developer_id, stage_id, created_by, project_name)
  values (v_dev, v_etapa, autora, 'Novo 204') returning id into v_novo;
  perform pg_temp.ok(v_novo is not null and exists (select 1 from public.deals where id = v_novo), 'negócio recém-criado, ainda sem corretor, é visível a quem criou');
  reset role;

  perform pg_temp.como(dono);
  set local role authenticated;
  perform pg_temp.ok(exists (select 1 from public.deals where id = v_deal), 'o corretor do negócio vê');
  reset role;
end;
$$;

rollback;
