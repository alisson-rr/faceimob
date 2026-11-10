-- =============================================================================
-- 0328 — repasse não leva venda (Status 1 VENDA) e o repasse pode ser desfeito
-- devolvendo a venda a quem vendeu.
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
  adm   uuid := '00000000-0000-0000-0000-000003280001';
  saiu  uuid := '00000000-0000-0000-0000-000003280002';
  novo  uuid := '00000000-0000-0000-0000-000003280003';
  ger_a uuid := '00000000-0000-0000-0000-000003280004';
  ger_b uuid := '00000000-0000-0000-0000-000003280005';
  t_a uuid := gen_random_uuid();
  t_b uuid := gen_random_uuid();
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
  v_venda uuid := (select id from public.deal_status_groups where code = 'VENDA');
  d_negociando uuid;
  d_contrato uuid;
  v_n int;
begin
  -- A venda só existe com temporada aberta (award_game_points).
  if public.current_game_season() is null then
    insert into public.game_seasons (label, period_start) values ('Temporada 328', current_date);
  end if;
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,   'adm@r328.test',  '{"full_name":"Admin 328"}'),
    (saiu,  'saiu@r328.test', '{"full_name":"Saiu 328"}'),
    (novo,  'novo@r328.test', '{"full_name":"Novo 328"}'),
    (ger_a, 'gera@r328.test', '{"full_name":"Gerente A 328"}'),
    (ger_b, 'gerb@r328.test', '{"full_name":"Gerente B 328"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (saiu, 'broker'), (novo, 'broker'), (ger_a, 'manager'), (ger_b, 'manager') on conflict do nothing;
  insert into public.teams (id, name, slug, manager_id) values
    (t_a, 'Equipe A 328', 'equipe-a-328', ger_a), (t_b, 'Equipe B 328', 'equipe-b-328', ger_b);
  insert into public.team_members (team_id, profile_id) values (t_a, saiu), (t_b, novo);

  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_negociando;
  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_contrato;
  -- "04. EM CONTRATO": aberto no pipeline, mas venda para o game (0163).
  set local session_replication_role = replica;
  update public.deals set status_group_id = v_venda where id = d_contrato;
  set local session_replication_role = origin;
  perform public.award_game_points(saiu, 'venda', 'deal', d_contrato, now());

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.profiles set status = 'terminated', terminated_at = now() where id = saiu;
  update public.team_members set left_at = current_date where profile_id = saiu;

  perform pg_temp.ok(
    (select array_agg(deal_id) from public.negocios_de_corretores_inativos() where corretor_id = saiu) = array[d_negociando],
    'a lista não traz o negócio em contrato');
  v_n := public.repassar_negocios(saiu, novo, array[d_negociando, d_contrato]);
  perform pg_temp.ok(v_n = 1, format('repassa só o que está em negociação (%s)', v_n));
  perform pg_temp.ok(
    exists (select 1 from public.deal_participants where deal_id = d_contrato and profile_id = saiu and role = 'broker')
    and not exists (select 1 from public.deal_participants where deal_id = d_contrato and profile_id = novo),
    'o negócio em contrato continua com quem vendeu');

  -- Desfazer: o repasse indevido de antes da 0328 (simulado à mão) volta.
  insert into public.deal_participants (deal_id, profile_id, role) values (d_contrato, novo, 'broker');
  delete from public.deal_participants where deal_id = d_contrato and profile_id = saiu and role = 'broker';
  insert into public.deal_history (deal_id, actor_id, kind, to_value, detail)
  values (d_contrato, adm, 'comment', 'REPASSE: teste', jsonb_build_object('repasse', true, 'de', saiu, 'para', novo));
  perform pg_temp.ok(
    exists (select 1 from public.game_events where profile_id = novo and event_code = 'venda' and ref_id = d_contrato)
    and not exists (select 1 from public.game_events where profile_id = saiu and event_code = 'venda' and ref_id = d_contrato),
    'cenário: o repasse indevido deu a venda ao novo');

  perform pg_temp.ok(public.desfazer_repasse(d_contrato) = 'Saiu 328', 'desfazer devolve a quem estava');
  perform pg_temp.ok(
    (select array_agg(profile_id) from public.deal_participants where deal_id = d_contrato and role = 'broker') = array[saiu],
    'o corretor original volta sozinho ao rateio');
  perform pg_temp.ok(
    exists (select 1 from public.game_events where profile_id = saiu and event_code = 'venda' and ref_id = d_contrato)
    and not exists (select 1 from public.game_events where profile_id = novo and event_code = 'venda' and ref_id = d_contrato),
    'a venda volta para quem vendeu e sai de quem recebeu');
  perform pg_temp.ok(
    (select array_agg(profile_id) from public.deal_participants where deal_id = d_contrato and role = 'manager') = array[ger_a],
    'o gerente volta a ser o da última equipe do corretor original');
  perform pg_temp.ok(
    exists (select 1 from public.deal_history where deal_id = d_contrato and to_value like 'REPASSE DESFEITO:%'),
    'o desfazer fica no histórico');

  begin
    perform public.desfazer_repasse(d_contrato);
    raise exception 'FALHOU: desfazer duas vezes passou';
  exception when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  não desfaz duas vezes (%)', sqlerrm;
  end;
end;
$$;

rollback;
