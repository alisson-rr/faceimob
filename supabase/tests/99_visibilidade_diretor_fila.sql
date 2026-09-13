-- =============================================================================
-- Regressão da 0141 — diretor e gerente enxergam só o que é deles.
--
-- Regra do dono (12/09/2026): corretor vê os leads que recebeu; só sócio e
-- administrador veem tudo; gerente e diretor, o que se relaciona com eles; o
-- CCA segue com a esteira inteira. Antes da 0141:
--   1. can_read_all() incluía o diretor, que lia TODOS os negócios e casos;
--   2. leads.view_queue abria a fila de qualquer roleta para ler, editar,
--      distribuir e realocar;
--   3. as policies FOR ALL de storage liberavam DELETE a quem só via o arquivo;
--   4. as métricas de marketing davam a empresa inteira a qualquer papel com
--      reports.view_finance;
--   5. existing_lead_phones aceitava lista sem teto;
--   6. lead_distribution_group e distribution_queue respondiam para qualquer id.
--
-- Cenário:
--   Equipe A 0141 (diretora: Dirce, gerente: Gil) ── Caio
--   Equipe B 0141 (gerente: Hugo)                 ── Beto
--   Ari = admin · Sofia = sócia · Cris = CCA · Mara = marketing
--   Negócio A (Caio) e Negócio B (Beto), cada um com caso no CCA.
--   Roletas: A 0141 (Caio) · B 0141 (Beto) · Geral 0141 (inativa, kind general)
--   Fila: um lead em cada roleta, um sem grupo e um na geral explícita.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got;
  end if;
  raise notice '  ok  %', label;
end;
$$;

/** Vira o usuário corrente do ponto de vista do RLS, como o PostgREST faria. */
create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, false);
$$;

do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  sofia uuid := '00000000-0000-0000-0000-000000014102';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  gil   uuid := '00000000-0000-0000-0000-000000014104';
  caio  uuid := '00000000-0000-0000-0000-000000014105';
  hugo  uuid := '00000000-0000-0000-0000-000000014106';
  beto  uuid := '00000000-0000-0000-0000-000000014107';
  cris  uuid := '00000000-0000-0000-0000-000000014108';
  mara  uuid := '00000000-0000-0000-0000-000000014109';
  tA    uuid := '00000000-0000-0000-0000-0000000141a1';
  tB    uuid := '00000000-0000-0000-0000-0000000141b1';
  gA    uuid := '00000000-0000-0000-0000-0000000141a2';
  gB    uuid := '00000000-0000-0000-0000-0000000141b2';
  gG    uuid := '00000000-0000-0000-0000-0000000141c2';
  v_stage uuid;
  v_shift uuid;
  v_deal  uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ari,   'ari@v0141.test',   '{"full_name":"Ari Admin 0141"}'),
    (sofia, 'sofia@v0141.test', '{"full_name":"Sofia Sócia 0141"}'),
    (dirce, 'dirce@v0141.test', '{"full_name":"Dirce Diretora 0141"}'),
    (gil,   'gil@v0141.test',   '{"full_name":"Gil Gerente 0141"}'),
    (caio,  'caio@v0141.test',  '{"full_name":"Caio Corretor 0141"}'),
    (hugo,  'hugo@v0141.test',  '{"full_name":"Hugo Gerente 0141"}'),
    (beto,  'beto@v0141.test',  '{"full_name":"Beto Corretor 0141"}'),
    (cris,  'cris@v0141.test',  '{"full_name":"Cris CCA 0141"}'),
    (mara,  'mara@v0141.test',  '{"full_name":"Mara Marketing 0141"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (ari, 'admin'), (sofia, 'partner'), (dirce, 'director'), (gil, 'manager'),
    (caio, 'broker'), (hugo, 'manager'), (beto, 'broker'), (cris, 'cca'),
    (mara, 'marketing')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id) values
    (tA, 'Equipe A 0141', 'equipe-a-0141', dirce, gil),
    (tB, 'Equipe B 0141', 'equipe-b-0141', null,  hugo);
  insert into public.team_members (team_id, profile_id) values (tA, caio), (tB, beto);

  -- A geral nasce INATIVA para não virar a fila de fallback dos outros testes;
  -- o alcance olha o tipo, não o `active`.
  insert into public.distribution_groups (id, name, slug, kind, active) values
    (gA, 'Roleta A 0141', 'roleta-a-0141', 'specific', true),
    (gB, 'Roleta B 0141', 'roleta-b-0141', 'specific', true),
    (gG, 'Geral 0141',    'geral-0141',    'general',  false);
  insert into public.distribution_group_members (group_id, profile_id, active) values
    (gA, caio, true), (gB, beto, true);

  insert into public.leads (full_name, phone, status, distribution_group_id) values
    ('Fila A 0141',               '11955514101', 'queued', gA),
    ('Fila B 0141',               '11955514102', 'queued', gB),
    ('Fila sem grupo 0141',       '11955514103', 'queued', null),
    ('Fila geral explícita 0141', '11955514104', 'queued', gG);
  insert into public.leads (full_name, phone, status, assigned_to, campaign_id) values
    ('Lead do Caio 0141', '11955514105', 'assigned', caio, 'camp-0141'),
    ('Lead do Beto 0141', '11955514106', 'assigned', beto, 'camp-0141');

  -- O gatilho deals_add_creator_participant põe o autor como corretor do negócio.
  select id into v_stage from public.pipeline_stages where code = 'proposal';
  insert into public.deals (stage_id, created_by, notes)
  values (v_stage, caio, 'Negócio A 0141') returning id into v_deal;
  insert into public.cca_cases (deal_id) values (v_deal);
  insert into public.deals (stage_id, created_by, notes)
  values (v_stage, beto, 'Negócio B 0141') returning id into v_deal;
  insert into public.cca_cases (deal_id) values (v_deal);

  -- Turno que cobre o dia inteiro: a fila da roleta não pode depender do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste-0141', 'Integral 0141', '00:00', '00:00', '23:59', -141)
  returning id into v_shift;
  insert into public.checkins (profile_id, shift_id, work_date) values
    (caio, v_shift, public.current_work_date()),
    (beto, v_shift, public.current_work_date());
end
$$;

set role authenticated;

-- -----------------------------------------------------------------------------
\echo '== 1. can_read_all: só administrador e sócio =='
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_temp.como('00000000-0000-0000-0000-000000014101');
  perform pg_temp.assert_eq(public.can_read_all(), true, 'admin lê todos os negócios');
  perform pg_temp.como('00000000-0000-0000-0000-000000014102');
  perform pg_temp.assert_eq(public.can_read_all(), true, 'sócio lê todos os negócios');
  perform pg_temp.como('00000000-0000-0000-0000-000000014103');
  perform pg_temp.assert_eq(public.can_read_all(), false, 'diretora NÃO lê todos os negócios');
  perform pg_temp.como('00000000-0000-0000-0000-000000014108');
  perform pg_temp.assert_eq(public.can_read_all(), false, 'CCA não passa por can_read_all (tem o próprio ramo)');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. negócios: diretora vê a hierarquia; CCA, sócio e admin veem tudo =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  sofia uuid := '00000000-0000-0000-0000-000000014102';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  gil   uuid := '00000000-0000-0000-0000-000000014104';
  hugo  uuid := '00000000-0000-0000-0000-000000014106';
  cris  uuid := '00000000-0000-0000-0000-000000014108';
  dA uuid;
  dB uuid;
  quem uuid;
begin
  perform pg_temp.como(ari);
  select id into dA from public.deals where notes = 'Negócio A 0141';
  select id into dB from public.deals where notes = 'Negócio B 0141';
  perform pg_temp.assert_eq(dA is not null and dB is not null, true, 'admin enxerga os dois negócios do cenário');

  perform pg_temp.como(dirce);
  perform pg_temp.assert_eq((select count(*)::int from public.deals where id in (dA, dB)), 1,
    'diretora vê só o negócio da equipe que dirige');
  perform pg_temp.assert_eq((select count(*)::int from public.deals where id = dB), 0,
    'e NÃO o negócio da outra equipe');
  perform pg_temp.assert_eq((select count(*)::int from public.cca_cases where deal_id in (dA, dB)), 1,
    'diretora vê só o caso de CCA da própria hierarquia');
  perform pg_temp.assert_eq((select count(*)::int from public.deal_participants where deal_id = dB), 0,
    'diretora não lê o rateio do negócio alheio');
  -- O gatilho deal_participants_autofill põe gerente e diretora da Equipe A no
  -- Negócio A: são várias linhas, todas do negócio dela.
  perform pg_temp.assert_eq(
    (select count(distinct n.deal_id)::int from public.deal_participant_names() n where n.deal_id in (dA, dB)), 1,
    'deal_participant_names devolve à diretora só os participantes do negócio dela');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.deal_participant_names() n where n.deal_id = dB), 0,
    'e nenhum participante do negócio alheio');
  perform pg_temp.assert_eq(public.can_see_deal(dB), false, 'can_see_deal recusa o negócio alheio à diretora');

  perform pg_temp.como(gil);
  perform pg_temp.assert_eq((select count(*)::int from public.deals where id in (dA, dB)), 1,
    'gerente continua com o negócio da própria equipe');
  perform pg_temp.como(hugo);
  perform pg_temp.assert_eq((select count(*)::int from public.deals where id = dB), 1,
    'o gerente da outra equipe continua com o dele');

  foreach quem in array array[ari, sofia, cris] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq((select count(*)::int from public.deals where id in (dA, dB)), 2,
      format('%s vê os dois negócios', quem));
    perform pg_temp.assert_eq((select count(*)::int from public.cca_cases where deal_id in (dA, dB)), 2,
      format('%s vê os dois casos da esteira', quem));
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. fila: gerente e diretora ficam com a geral e a das próprias roletas =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  sofia uuid := '00000000-0000-0000-0000-000000014102';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  gil   uuid := '00000000-0000-0000-0000-000000014104';
  caio  uuid := '00000000-0000-0000-0000-000000014105';
  hugo  uuid := '00000000-0000-0000-0000-000000014106';
  mara  uuid := '00000000-0000-0000-0000-000000014109';
  quem uuid;
  n int;
begin
  foreach quem in array array[gil, dirce] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq(
      (select count(*)::int from public.leads where full_name like 'Fila % 0141'), 3,
      format('%s vê a fila da própria roleta, a sem grupo e a geral explícita', quem));
    perform pg_temp.assert_eq(
      (select count(*)::int from public.leads where full_name = 'Fila B 0141'), 0,
      format('%s NÃO vê a fila da roleta da outra equipe', quem));
  end loop;

  perform pg_temp.como(gil);
  update public.leads set notes = 'tentativa 0141' where full_name = 'Fila B 0141';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 0, 'gerente NÃO edita lead da fila alheia');
  update public.leads set notes = 'gerente 0141' where full_name = 'Fila A 0141';
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1, 'gerente edita lead da fila da própria roleta');

  perform pg_temp.como(hugo);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name in ('Fila A 0141', 'Fila B 0141')), 1,
    'o outro gerente vê a roleta dele e não a do vizinho');

  foreach quem in array array[mara, ari, sofia] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq(
      (select count(*)::int from public.leads where full_name like 'Fila % 0141'), 4,
      format('%s segue com a fila inteira', quem));
  end loop;

  perform pg_temp.como(caio);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name like 'Fila % 0141'), 0,
    'corretor continua sem fila');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3b. criar lead sem dono com RETURNING; filiação não amplia alcance =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  gil   uuid := '00000000-0000-0000-0000-000000014104';
  caio  uuid := '00000000-0000-0000-0000-000000014105';
  beto  uuid := '00000000-0000-0000-0000-000000014107';
  mara  uuid := '00000000-0000-0000-0000-000000014109';
  gA    uuid := '00000000-0000-0000-0000-0000000141a2';
  gB    uuid := '00000000-0000-0000-0000-0000000141b2';
  v_id uuid;
  erro text;
  n int;
  quem uuid;
begin
  -- createLead/createLeads fazem insert + select: com RETURNING a policy de
  -- SELECT vale para a linha nova ANTES de ela existir na tabela.
  perform pg_temp.como(ari);
  insert into public.leads (full_name, phone) values ('Criado admin 0141', '11955514111')
  returning id into v_id;
  perform pg_temp.assert_eq(v_id is not null, true, 'admin cria lead sem dono com RETURNING');

  perform pg_temp.como(gil);
  v_id := null;
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Criado gerente A 0141', '11955514112', gA) returning id into v_id;
  perform pg_temp.assert_eq(v_id is not null, true, 'gerente cria lead na roleta da equipe com RETURNING');
  v_id := null;
  insert into public.leads (full_name, phone) values ('Criado gerente geral 0141', '11955514113')
  returning id into v_id;
  perform pg_temp.assert_eq(v_id is not null, true, 'gerente cria lead sem grupo (fila geral) com RETURNING');

  erro := null;
  begin
    insert into public.leads (full_name, phone, distribution_group_id)
    values ('Criado gerente B 0141', '11955514114', gB) returning id into v_id;
  exception when insufficient_privilege then
    erro := '42501';
  end;
  perform pg_temp.assert_eq(erro, '42501', 'gerente NÃO cria e lê de volta lead na roleta da outra equipe');

  perform pg_temp.como(mara);
  v_id := null;
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Criado marketing B 0141', '11955514115', gB) returning id into v_id;
  perform pg_temp.assert_eq(v_id is not null, true, 'marketing cria lead em qualquer roleta com RETURNING');

  -- A policy lê colunas da linha e auth_queue_lead_ids() repete o predicado
  -- para as SECURITY DEFINER: se um dos dois mudar sozinho, isto quebra.
  foreach quem in array array[gil, dirce, mara] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq(
      (select count(*)::int from public.leads where assigned_to is null),
      (select count(*)::int from public.auth_queue_lead_ids()),
      format('%s: a fila da policy é a mesma de auth_queue_lead_ids', quem));
  end loop;

  -- A filiação decide o alcance: a diretora não se inclui na roleta da outra
  -- equipe, nem põe na dela quem não enxerga.
  perform pg_temp.como(dirce);
  erro := null;
  begin
    insert into public.distribution_group_members (group_id, profile_id, active) values (gB, dirce, true);
  exception when insufficient_privilege then
    erro := '42501';
  end;
  perform pg_temp.assert_eq(erro, '42501', 'diretora NÃO se inclui na roleta da outra equipe');

  erro := null;
  begin
    insert into public.distribution_group_members (group_id, profile_id, active) values (gA, beto, true);
  exception when insufficient_privilege then
    erro := '42501';
  end;
  perform pg_temp.assert_eq(erro, '42501', 'diretora NÃO põe na roleta dela corretor que não enxerga');

  update public.distribution_group_members set active = true where group_id = gB and profile_id = beto;
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 0, 'diretora não mexe na filiação da roleta alheia');

  update public.distribution_group_members set active = true where group_id = gA and profile_id = caio;
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1, 'diretora segue mexendo no corretor da equipe na roleta que alcança');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name = 'Fila B 0141'), 0,
    'e continua sem ver a fila da roleta B');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. fila alheia não se distribui, não se realoca, não se descobre =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari  uuid := '00000000-0000-0000-0000-000000014101';
  gil  uuid := '00000000-0000-0000-0000-000000014104';
  caio uuid := '00000000-0000-0000-0000-000000014105';
  hugo uuid := '00000000-0000-0000-0000-000000014106';
  gA   uuid := '00000000-0000-0000-0000-0000000141a2';
  gB   uuid := '00000000-0000-0000-0000-0000000141b2';
  gG   uuid := '00000000-0000-0000-0000-0000000141c2';
  vA uuid;
  vB uuid;
  erro text;
begin
  perform pg_temp.como(ari);
  select id into vA from public.leads where full_name = 'Fila A 0141';
  select id into vB from public.leads where full_name = 'Fila B 0141';

  perform pg_temp.como(gil);

  erro := null;
  begin
    perform public.distribute_queued_lead(vB);
  exception when no_data_found then
    erro := 'P0002';
  end;
  perform pg_temp.assert_eq(erro, 'P0002', 'gerente NÃO dispara a roleta de lead da fila alheia');

  -- "Não encontrado", e não "sem permissão": a segunda confirmaria que o id existe.
  erro := null;
  begin
    perform public.reassign_lead(vB, caio);
  exception when no_data_found then
    erro := 'P0002';
  end;
  perform pg_temp.assert_eq(erro, 'P0002', 'gerente NÃO puxa para a equipe dele o lead da fila alheia');

  perform pg_temp.assert_eq(public.can_write_lead(vB), false, 'gerente não anexa nem comenta no lead da fila alheia');
  perform pg_temp.assert_eq(public.can_write_lead(vA), true, 'e segue anexando no da própria roleta');

  perform pg_temp.assert_eq(public.lead_distribution_group(vB), null::uuid,
    'lead_distribution_group não revela a roleta de lead que o gerente não vê');
  perform pg_temp.assert_eq(public.lead_distribution_group(vA), gA,
    'e responde para o lead que ele vê');

  perform pg_temp.assert_eq(gA in (select public.auth_distribution_group_ids()), true, 'a roleta da equipe está no alcance');
  perform pg_temp.assert_eq(gG in (select public.auth_distribution_group_ids()), true, 'a fila geral está no alcance');
  perform pg_temp.assert_eq(gB in (select public.auth_distribution_group_ids()), false, 'a roleta da outra equipe não está');

  perform pg_temp.como(hugo);
  perform pg_temp.assert_eq(public.lead_distribution_group(vB), gB, 'o gerente da roleta B descobre o grupo do lead dele');

  perform pg_temp.como(gil);
  perform public.reassign_lead(vA, caio);
  perform pg_temp.assert_eq((select assigned_to from public.leads where id = vA), caio,
    'gerente realoca lead da fila da própria roleta');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 5. distribution_queue: nome e posição só de roleta ao alcance =='
-- -----------------------------------------------------------------------------
do $$
declare
  gil  uuid := '00000000-0000-0000-0000-000000014104';
  hugo uuid := '00000000-0000-0000-0000-000000014106';
  beto uuid := '00000000-0000-0000-0000-000000014107';
  gB   uuid := '00000000-0000-0000-0000-0000000141b2';
begin
  perform pg_temp.como(hugo);
  perform pg_temp.assert_eq((select count(*)::int from public.distribution_queue(gB)), 1,
    'gerente lista a fila da roleta da equipe dele');
  perform pg_temp.como(beto);
  perform pg_temp.assert_eq((select count(*)::int from public.distribution_queue(gB)), 1,
    'corretor vê a própria posição na roleta (tela de Check-in)');
  perform pg_temp.como(gil);
  perform pg_temp.assert_eq((select count(*)::int from public.distribution_queue(gB)), 0,
    'gerente NÃO lista quem está na roleta da outra equipe');
end
$$;

reset role;
select set_config('request.jwt.claims', '', false);

-- Sem sessão é o cron (assign_queued_leads) e as edge functions com service
-- role: a roleta não pode perder a fila por causa da trava.
select pg_temp.assert_eq(
  (select count(*)::int from public.distribution_queue('00000000-0000-0000-0000-0000000141b2')), 1,
  'sem sessão (cron) a roleta continua enxergando a fila');

-- -----------------------------------------------------------------------------
\echo '== 5b. aviso de lead sem atendimento só a quem alcança a roleta =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  gil   uuid := '00000000-0000-0000-0000-000000014104';
  hugo  uuid := '00000000-0000-0000-0000-000000014106';
  beto  uuid := '00000000-0000-0000-0000-000000014107';
  gB    uuid := '00000000-0000-0000-0000-0000000141b2';
  v_lead uuid;
  v_max  int;
  i int;
begin
  v_max := coalesce((select s.roulette_max_rounds from public.automation_settings s where s.id), 5);

  insert into public.leads (full_name, phone, status, distribution_group_id)
  values ('Sem atendimento B 0141', '11955514120', 'queued', gB)
  returning id into v_lead;
  -- As voltas vencidas que release_expired_leads teria registrado, todas do Beto.
  for i in 1..v_max loop
    insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline, released_at, release_reason)
    values (v_lead, beto, gB, i, now(), now(), 'timeout');
  end loop;

  perform pg_temp.assert_eq(public.assign_lead(v_lead), null::uuid, 'no teto de voltas o lead sai da roleta');

  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications n
      where n.kind = 'lead_unattended' and n.link = '/leads?lead=' || v_lead and n.profile_id = hugo), 1,
    'o gerente da roleta B é avisado');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications n
      where n.kind = 'lead_unattended' and n.link = '/leads?lead=' || v_lead and n.profile_id = ari), 1,
    'o administrador é avisado');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.notifications n
      where n.kind = 'lead_unattended' and n.link = '/leads?lead=' || v_lead and n.profile_id in (gil, dirce)), 0,
    'gerente e diretora da outra equipe NÃO recebem o nome do cliente');
end
$$;

set role authenticated;

-- -----------------------------------------------------------------------------
\echo '== 5c. atribuições: diretora vê as da hierarquia, não as da empresa =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000014101';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  hugo  uuid := '00000000-0000-0000-0000-000000014106';
  beto  uuid := '00000000-0000-0000-0000-000000014107';
  quem uuid;
begin
  perform pg_temp.como(dirce);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.lead_assignments where profile_id = beto), 0,
    'diretora NÃO lê as atribuições do corretor da outra equipe');

  foreach quem in array array[hugo, ari] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq(
      (select count(*)::int from public.lead_assignments where profile_id = beto) > 0, true,
      format('%s lê as atribuições do Beto', quem));
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 6. marketing: fora marketing, admin e sócio, soma só o que enxerga =='
-- -----------------------------------------------------------------------------
do $$
declare
  sofia uuid := '00000000-0000-0000-0000-000000014102';
  dirce uuid := '00000000-0000-0000-0000-000000014103';
  mara  uuid := '00000000-0000-0000-0000-000000014109';
  quem uuid;
begin
  foreach quem in array array[mara, sofia] loop
    perform pg_temp.como(quem);
    perform pg_temp.assert_eq(
      (select s.leads from public.marketing_campaign_stats() s where s.campaign_id = 'camp-0141'), 2,
      format('%s conta os leads da campanha da empresa inteira', quem));
  end loop;

  perform pg_temp.como(dirce);
  perform pg_temp.assert_eq(
    (select s.leads from public.marketing_campaign_stats() s where s.campaign_id = 'camp-0141'), 1,
    'diretora conta só o lead da própria hierarquia');
  -- O resumo tem de somar EXATAMENTE o que as policies entregam a ela: é o
  -- mesmo recorte, e divergir seria a tela mostrar número que a lista não tem.
  perform pg_temp.assert_eq(
    (select coalesce(sum(s.leads), 0)::int from public.marketing_developer_summary() s),
    (select count(*)::int from public.leads),
    'resumo por construtora soma os leads que a leads_select entrega à diretora');
  perform pg_temp.assert_eq(
    (select coalesce(sum(s.deals), 0)::int from public.marketing_developer_summary() s),
    (select count(*)::int from public.deals),
    'resumo por construtora soma os negócios que a deals_select entrega à diretora');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 7. existing_lead_phones: no máximo 1.000 por chamada =='
-- -----------------------------------------------------------------------------
do $$
declare
  erro text := null;
begin
  perform pg_temp.como('00000000-0000-0000-0000-000000014104');
  begin
    perform count(*) from public.existing_lead_phones(array_fill('11955514101'::text, array[1001]));
  exception when invalid_parameter_value then
    erro := '22023';
  end;
  perform pg_temp.assert_eq(erro, '22023', 'lista com 1.001 telefones é recusada');

  perform pg_temp.assert_eq(
    (select s.lead_count from public.existing_lead_phones(array['11955514101']) s), 1,
    'a conferência de repetidos continua achando o lead de qualquer equipe');
  perform count(*) from public.existing_lead_phones(array_fill('11955514101'::text, array[1000]));
  raise notice '  ok  lista com 1.000 telefones passa';
end
$$;

reset role;
select set_config('request.jwt.claims', '', false);

-- -----------------------------------------------------------------------------
\echo '== 8. storage: ler quem vê; gravar e apagar quem edita =='
-- -----------------------------------------------------------------------------
-- Estrutural: o harness sem Supabase não tem `storage.objects`, e o Storage
-- recusa DELETE direto na tabela. O que regride é voltar a uma policy FOR ALL,
-- que faz o USING de leitura valer também para apagar.
do $$
declare
  v_bucket text;
begin
  if to_regclass('storage.objects') is null then
    raise notice '  --  storage ausente neste ambiente: policies de bucket não conferidas';
    return;
  end if;

  foreach v_bucket in array array['deal_documents_storage', 'lead_attachments_storage'] loop
    perform pg_temp.assert_eq(
      (select count(*)::int from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (policyname = v_bucket or (policyname like v_bucket || '%' and cmd = 'ALL'))),
      0, format('%s não tem mais policy FOR ALL', v_bucket));
    perform pg_temp.assert_eq(
      (select string_agg(cmd, ',' order by cmd) from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname in (v_bucket || '_select', v_bucket || '_insert', v_bucket || '_delete')),
      'DELETE,INSERT,SELECT', format('%s separa leitura, gravação e remoção', v_bucket));
  end loop;

  perform pg_temp.assert_eq(
    (select qual from pg_policies
      where schemaname = 'storage' and policyname = 'deal_documents_storage_delete') like '%can_edit_deal%',
    true, 'apagar documento de negócio exige editar o negócio');
  -- Arquivo segue a regra da linha: com o dossiê enviado, nem sobe arquivo que a
  -- linha recusaria (órfão) nem some o de um documento que a linha protege.
  perform pg_temp.assert_eq(
    (select qual from pg_policies
      where schemaname = 'storage' and policyname = 'deal_documents_storage_delete') like '%document_review_status%',
    true, 'apagar arquivo respeita a trava do dossiê enviado, igual a deal_documents_delete');
  perform pg_temp.assert_eq(
    (select with_check from pg_policies
      where schemaname = 'storage' and policyname = 'deal_documents_storage_insert') like '%document_review_status%',
    true, 'gravar arquivo respeita a trava do dossiê enviado, igual a deal_documents_insert');
  perform pg_temp.assert_eq(
    (select qual from pg_policies
      where schemaname = 'storage' and policyname = 'lead_attachments_storage_delete') like '%can_write_lead%',
    true, 'apagar anexo de lead exige escrever no lead');
end
$$;

\echo 'visibilidade diretor e fila ok'

-- -----------------------------------------------------------------------------
-- 0148 · O motor da roleta não depende de quem o acionou
-- -----------------------------------------------------------------------------
\echo '== 7. o motor distribui igual com a sessão de alguém sem alcance na conexão =='

do $$
declare
  beto uuid := '00000000-0000-0000-0000-000000014107';
  v_lead uuid;
begin
  select id into v_lead from public.leads where full_name = 'Fila B 0141';

  -- Sessão do gerente da Equipe A ainda na conexão (como no sdr_handoff chamado
  -- por quem não alcança a roleta B): a fila da TELA recorta, o motor não.
  perform pg_temp.como('00000000-0000-0000-0000-000000014104');
  perform pg_temp.assert_eq((select count(*)::int from public.distribution_queue('00000000-0000-0000-0000-0000000141b2')), 0,
    'a fila da tela continua recortada para quem não alcança a roleta');
  perform pg_temp.assert_eq(public.assign_lead(v_lead), beto,
    'o motor atribui o lead da roleta B mesmo acionado com a sessão de quem não a alcança');
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.distribution_queue_interna(uuid)', 'execute'), false,
    'a fila interna não é chamável pela API');
end
$$;

select set_config('request.jwt.claims', '', false);
