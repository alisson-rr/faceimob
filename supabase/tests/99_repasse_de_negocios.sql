-- =============================================================================
-- 0327 — repasse dos negócios de corretor desligado para corretor ativo.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.falha(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU: % — a chamada passou', p_label;
exception when others then
  if sqlerrm like 'FALHOU:%' then raise; end if;
  raise notice '  ok  % (%)', p_label, sqlerrm;
end;
$$;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-000003270001';
  saiu  uuid := '00000000-0000-0000-0000-000003270002';
  novo  uuid := '00000000-0000-0000-0000-000003270003';
  ger_a uuid := '00000000-0000-0000-0000-000003270004';
  ger_b uuid := '00000000-0000-0000-0000-000003270005';
  colega uuid := '00000000-0000-0000-0000-000003270006';
  t_a uuid := gen_random_uuid();
  t_b uuid := gen_random_uuid();
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
  d_aberto uuid;
  d_ganho uuid;
  d_dois uuid;
  v_n int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,   'adm@r327.test',   '{"full_name":"Admin 327"}'),
    (saiu,  'saiu@r327.test',  '{"full_name":"Saiu 327"}'),
    (novo,  'novo@r327.test',  '{"full_name":"Novo 327"}'),
    (ger_a, 'gera@r327.test',  '{"full_name":"Gerente A 327"}'),
    (ger_b, 'gerb@r327.test',  '{"full_name":"Gerente B 327"}'),
    (colega,'col@r327.test',   '{"full_name":"Colega 327"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (saiu, 'broker'), (novo, 'broker'), (colega, 'broker'),
    (ger_a, 'manager'), (ger_b, 'manager') on conflict do nothing;
  insert into public.teams (id, name, slug, manager_id) values
    (t_a, 'Equipe A 327', 'equipe-a-327', ger_a), (t_b, 'Equipe B 327', 'equipe-b-327', ger_b);
  insert into public.team_members (team_id, profile_id) values (t_a, saiu), (t_a, colega), (t_b, novo);

  -- Negócios do corretor que saiu (o criador entra como corretor e traz o gerente A).
  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_aberto;
  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_ganho;
  -- O desfecho sai da etapa (0102), e a etapa de venda exige a conferência
  -- aprovada (0028) — mesmo caminho do 23_gamificacao.
  update public.deals set document_review_status = 'approved' where id = d_ganho;
  update public.deals set stage_id = (select id from public.pipeline_stages where code = 'closed') where id = d_ganho;
  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_dois;
  insert into public.deal_participants (deal_id, profile_id, role) values (d_dois, colega, 'broker');

  perform pg_temp.ok((select outcome = 'won' from public.deals where id = d_ganho), 'cenário: um negócio ganho');
  update public.profiles set status = 'terminated' where id = saiu;

  perform set_config('request.jwt.claims', json_build_object('sub', novo, 'role', 'authenticated')::text, true);
  perform pg_temp.falha('select * from public.negocios_de_corretores_inativos()', 'corretor não lista os negócios de inativos');
  perform pg_temp.falha(format('select public.repassar_negocios(%L, %L, array[%L]::uuid[])', saiu, novo, d_aberto),
    'corretor não repassa');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(
    (select count(*) from public.negocios_de_corretores_inativos() where corretor_id = saiu) = 2,
    'a lista traz só os 2 negócios abertos do inativo (o ganho fica fora)');
  perform pg_temp.falha(format('select public.repassar_negocios(%L, %L, array[%L]::uuid[])', novo, colega, d_aberto),
    'não repassa de quem ainda está ativo');

  v_n := public.repassar_negocios(saiu, novo, array[d_aberto, d_ganho, d_dois]);
  perform pg_temp.ok(v_n = 2, format('repassa só os abertos (%s)', v_n));

  perform pg_temp.ok(
    (select array_agg(profile_id order by profile_id) from public.deal_participants where deal_id = d_aberto and role = 'broker') = array[novo]
    and (select share_pct from public.deal_participants where deal_id = d_aberto and profile_id = novo and role = 'broker') = 100,
    'negócio só do inativo: o novo fica com 100% do rateio');
  perform pg_temp.ok(
    (select array_agg(profile_id) from public.deal_participants where deal_id = d_aberto and role = 'manager') = array[ger_b],
    'o gerente passa a ser o da equipe do novo corretor');
  perform pg_temp.ok(
    exists (select 1 from public.deal_participants where deal_id = d_ganho and profile_id = saiu and role = 'broker'),
    'negócio ganho continua com quem vendeu');
  perform pg_temp.ok(
    (select count(*) from public.deal_participants where deal_id = d_dois and role = 'broker') = 2
    and exists (select 1 from public.deal_participants where deal_id = d_dois and role = 'manager' and profile_id = ger_a)
    and exists (select 1 from public.deal_participants where deal_id = d_dois and role = 'manager' and profile_id = ger_b),
    'com colega no negócio: rateio a dois e fica o gerente de cada um');
  perform pg_temp.ok(
    exists (select 1 from public.deal_history where deal_id = d_aberto and to_value like 'REPASSE:%'),
    'o repasse fica no histórico do negócio');
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.repassar_negocios(uuid, uuid, uuid[])', 'execute'), 'anon não repassa');

rollback;
