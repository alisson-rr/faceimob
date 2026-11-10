-- =============================================================================
-- 0329 — Consulta CPF: mostra com quem está e resgata o negócio de corretor
-- desligado/suspenso (sem reabrir), nunca venda nem negócio de corretor ativo.
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
  adm   uuid := '00000000-0000-0000-0000-000003290001';
  saiu  uuid := '00000000-0000-0000-0000-000003290002';
  ativo uuid := '00000000-0000-0000-0000-000003290003';
  novo  uuid := '00000000-0000-0000-0000-000003290004';
  ger_a uuid := '00000000-0000-0000-0000-000003290005';
  ger_b uuid := '00000000-0000-0000-0000-000003290006';
  t_a uuid := gen_random_uuid();
  t_b uuid := gen_random_uuid();
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
  d_inativo uuid;
  d_venda uuid;
  d_ativo uuid;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,   'adm@c329.test',   '{"full_name":"Admin 329"}'),
    (saiu,  'saiu@c329.test',  '{"full_name":"Saiu 329"}'),
    (ativo, 'ativo@c329.test', '{"full_name":"Ativo 329"}'),
    (novo,  'novo@c329.test',  '{"full_name":"Novo 329"}'),
    (ger_a, 'gera@c329.test',  '{"full_name":"Gerente A 329"}'),
    (ger_b, 'gerb@c329.test',  '{"full_name":"Gerente B 329"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (saiu, 'broker'), (ativo, 'broker'), (novo, 'broker'),
    (ger_a, 'manager'), (ger_b, 'manager') on conflict do nothing;
  insert into public.teams (id, name, slug, manager_id) values
    (t_a, 'Equipe A 329', 'equipe-a-329', ger_a), (t_b, 'Equipe B 329', 'equipe-b-329', ger_b);
  insert into public.team_members (team_id, profile_id) values (t_a, saiu), (t_a, ativo), (t_b, novo);
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals (stage_id, created_by, status_detail) values (v_stage, saiu, '06. ENVIO DE RP') returning id into d_inativo;
  insert into public.deal_clients (deal_id, full_name, cpf, ordinal) values (d_inativo, 'CLIENTE INATIVO', '111.444.777-35', 1);
  insert into public.deals (stage_id, created_by) values (v_stage, saiu) returning id into d_venda;
  insert into public.deal_clients (deal_id, full_name, cpf, ordinal) values (d_venda, 'CLIENTE VENDA', '52998224725', 1);
  set local session_replication_role = replica;
  update public.deals set status_group_id = (select id from public.deal_status_groups where code = 'VENDA') where id = d_venda;
  set local session_replication_role = origin;
  insert into public.deals (stage_id, created_by) values (v_stage, ativo) returning id into d_ativo;
  insert into public.deal_clients (deal_id, full_name, cpf, ordinal) values (d_ativo, 'CLIENTE ATIVO', '39053344705', 1);
  insert into public.deal_history (deal_id, actor_id, kind, to_value) values (d_inativo, saiu, 'comment', 'Cliente sumiu.');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.profiles set status = 'terminated', terminated_at = now() where id = saiu;

  perform set_config('request.jwt.claims', json_build_object('sub', novo, 'role', 'authenticated')::text, true);

  select * into r from public.negocio_do_cpf('11144477735');
  perform pg_temp.ok(r.deal_id = d_inativo and r.corretor = 'Saiu 329' and r.gerente = 'Gerente A 329'
    and r.corretor_inativo and r.pode_resgatar and r.ultimo_comentario_em is not null,
    'corretor desligado: mostra com quem está, data do último comentário e libera o resgate');
  select * into r from public.negocio_do_cpf('52998224725');
  perform pg_temp.ok(not r.pode_resgatar, 'venda (Status 1 VENDA) de corretor desligado não é resgatável');
  select * into r from public.negocio_do_cpf('39053344705');
  perform pg_temp.ok(r.situacao = 'ativo' and not r.corretor_inativo and not r.pode_resgatar,
    'corretor ativo: só informa, não resgata');

  perform public.assumir_negocio_do_cpf(d_inativo, 'Cliente me procurou.');
  perform pg_temp.ok(
    (select array_agg(profile_id) from public.deal_participants where deal_id = d_inativo and role = 'broker') = array[novo],
    'resgate: quem resgatou fica sozinho no rateio');
  perform pg_temp.ok(
    (select array_agg(profile_id) from public.deal_participants where deal_id = d_inativo and role = 'manager') = array[ger_b],
    'resgate: o gerente passa a ser o da equipe de quem resgatou');
  perform pg_temp.ok((select status_detail from public.deals where id = d_inativo) = '06. ENVIO DE RP',
    'resgate de corretor inativo não reabre em PROPOSTA');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = d_inativo
    and to_value like 'NEGÓCIO RESGATADO NA CONSULTA DE CPF%Saiu 329%'), 'o resgate fica no histórico');

  begin
    perform public.assumir_negocio_do_cpf(d_venda, 'Quero a venda.');
    raise exception 'FALHOU: resgatou a venda';
  exception when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  venda não é resgatada (%)', sqlerrm;
  end;
  begin
    perform public.assumir_negocio_do_cpf(d_ativo, 'Quero esse cliente.');
    raise exception 'FALHOU: resgatou de corretor ativo';
  exception when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  negócio de corretor ativo não é resgatado (%)', sqlerrm;
  end;
end;
$$;

rollback;
