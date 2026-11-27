-- 0369 — gerente da equipe de um corretor do negócio vê e confere, mesmo sem estar gravado como gerente nele.
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
  su   uuid := '00000000-0000-0000-0000-000003690001';
  arq  uuid := '00000000-0000-0000-0000-000003690002';
  dai  uuid := '00000000-0000-0000-0000-000003690003';
  fora uuid := '00000000-0000-0000-0000-000003690004';
  t_su uuid;
  v_deal uuid;
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (su, 'su@c369.test', '{"full_name":"Corretora gerente 369"}'),
    (arq, 'arq@c369.test', '{"full_name":"Gerente 369"}'),
    (dai, 'dai@c369.test', '{"full_name":"Corretora 369"}'),
    (fora, 'fora@c369.test', '{"full_name":"Gerente de fora 369"}');
  insert into public.user_roles (profile_id, role) values
    (su, 'broker'), (su, 'manager'), (arq, 'manager'), (dai, 'broker'), (fora, 'manager') on conflict do nothing;
  insert into public.teams (name, manager_id, director_id) values ('Equipe Su 369', su, arq) returning id into t_su;
  insert into public.team_members (team_id, profile_id) values (t_su, su);

  insert into public.deals (stage_id, created_by, document_review_status, month_base)
    values (v_stage, su, 'pending', public.month_start(coalesce(public.current_season_month(), current_date)))
    returning id into v_deal;
  -- Gravado sem a corretora-gerente como gerente (o caso de antes da correção do front).
  alter table public.deal_participants disable trigger user;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, su, 'broker', 1), (v_deal, dai, 'broker', 2), (v_deal, arq, 'manager', 1);
  alter table public.deal_participants enable trigger user;

  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.lidera_corretor_do_negocio(v_deal), 'a corretora-gerente lidera um corretor do negócio');
  perform pg_temp.ok(exists (select 1 from public.minhas_conferencias_pendentes_ids() x where x.deal_id = v_deal),
    'a conferência aparece na lista dela');

  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(not public.lidera_corretor_do_negocio(v_deal), 'gerente de outra equipe não lidera');
  perform pg_temp.ok(not exists (select 1 from public.minhas_conferencias_pendentes_ids() x where x.deal_id = v_deal),
    'gerente de fora não vê a conferência');
end;
$$;

rollback;
