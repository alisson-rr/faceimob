-- =============================================================================
-- Regressão da 0128 — gestor não amplia o próprio alcance pela API.
--
-- As três chamadas abaixo passavam antes da 0128, e cada uma entregava ao
-- gestor leads e negócios que não eram dele (medido na homologação, 12/09/2026):
--   1. gerente inclui na própria equipe um corretor sem equipe;
--   2. diretor cria equipe (ou troca o gerente da sua) com gerente de fora;
--   3. gerente realoca para a equipe dele um lead de outra equipe.
-- E o que tem de continuar valendo: desligar integrante, renomear a própria
-- equipe, criar equipe sem gerente, realocar lead da fila, o admin fazendo
-- tudo — e ninguém gravando sem sessão.
--
-- Cenário:
--   Equipe A 0128 (diretor: Dirceu, gerente: Gildo) ── Caio, Cleo
--   Equipe B 0128 (gerente: Guto)                   ── Beto
--   Sandro = corretor sem equipe · Ari = admin
--   Leads: um do Beto, um do Sandro e um na fila.
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
  ari    uuid := '00000000-0000-0000-0000-000000012801';
  dirceu uuid := '00000000-0000-0000-0000-000000012802';
  gildo  uuid := '00000000-0000-0000-0000-000000012803';
  caio   uuid := '00000000-0000-0000-0000-000000012804';
  cleo   uuid := '00000000-0000-0000-0000-000000012805';
  guto   uuid := '00000000-0000-0000-0000-000000012806';
  beto   uuid := '00000000-0000-0000-0000-000000012807';
  sandro uuid := '00000000-0000-0000-0000-000000012808';
  tA     uuid := '00000000-0000-0000-0000-0000000128a1';
  tB     uuid := '00000000-0000-0000-0000-0000000128b1';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ari,    'ari@h0128.test',    '{"full_name":"Ari Admin 0128"}'),
    (dirceu, 'dirceu@h0128.test', '{"full_name":"Dirceu Diretor 0128"}'),
    (gildo,  'gildo@h0128.test',  '{"full_name":"Gildo Gerente 0128"}'),
    (caio,   'caio@h0128.test',   '{"full_name":"Caio Corretor 0128"}'),
    (cleo,   'cleo@h0128.test',   '{"full_name":"Cleo Corretora 0128"}'),
    (guto,   'guto@h0128.test',   '{"full_name":"Guto Gerente 0128"}'),
    (beto,   'beto@h0128.test',   '{"full_name":"Beto Corretor 0128"}'),
    (sandro, 'sandro@h0128.test', '{"full_name":"Sandro Sem Equipe 0128"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (ari, 'admin'), (dirceu, 'director'), (gildo, 'manager'), (guto, 'manager'),
    (caio, 'broker'), (cleo, 'broker'), (beto, 'broker'), (sandro, 'broker')
  on conflict do nothing;

  insert into public.teams (id, name, slug, director_id, manager_id) values
    (tA, 'Equipe A 0128', 'equipe-a-0128', dirceu, gildo),
    (tB, 'Equipe B 0128', 'equipe-b-0128', null,   guto);
  insert into public.team_members (team_id, profile_id) values
    (tA, caio), (tA, cleo), (tB, beto);

  insert into public.leads (full_name, phone, status, assigned_to) values
    ('Lead do Beto 0128',   '11977771281', 'assigned', beto),
    ('Lead do Sandro 0128', '11977771282', 'assigned', sandro);
  insert into public.leads (full_name, phone) values ('Lead Fila 0128', '11977771283');
end
$$;

set role authenticated;

-- Sem as concessões da 0044 o gerente seria recusado pelo motivo errado, e os
-- negativos abaixo passariam sem provar a 0128.
select pg_temp.como('00000000-0000-0000-0000-000000012803');
select pg_temp.assert_eq(
  public.has_permission('teams.manage')
    and public.has_permission('leads.reassign')
    and public.has_permission('leads.view_queue'),
  true,
  'gerente parte com teams.manage, leads.reassign e leads.view_queue');

-- -----------------------------------------------------------------------------
\echo '== 1. team_members: gerente não inclui gente de fora do alcance =='
-- -----------------------------------------------------------------------------
do $$
declare
  gildo  uuid := '00000000-0000-0000-0000-000000012803';
  cleo   uuid := '00000000-0000-0000-0000-000000012805';
  sandro uuid := '00000000-0000-0000-0000-000000012808';
  tA     uuid := '00000000-0000-0000-0000-0000000128a1';
  recusou boolean := false;
  n int;
begin
  perform pg_temp.como(gildo);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name = 'Lead do Sandro 0128'), 0,
    'gerente não enxerga o lead do corretor sem equipe');

  begin
    insert into public.team_members (team_id, profile_id) values (tA, sandro);
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'gerente NÃO inclui corretor sem equipe na equipe que lidera');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name = 'Lead do Sandro 0128'), 0,
    'e o lead dele continua fora do alcance');

  -- O que teams.manage continua governando: desligar quem já é da equipe.
  update public.team_members set left_at = now()
   where team_id = tA and profile_id = cleo and left_at is null;
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1, 'gerente desliga integrante da própria equipe');

  -- Reabrir a filiação é incluir de novo quem já saiu do alcance.
  update public.team_members set left_at = null
   where team_id = tA and profile_id = cleo;
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 0, 'gerente não reabre a filiação de quem já desligou');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. teams: diretor não põe gerente de fora na equipe =='
-- -----------------------------------------------------------------------------
do $$
declare
  dirceu uuid := '00000000-0000-0000-0000-000000012802';
  guto   uuid := '00000000-0000-0000-0000-000000012806';
  sandro uuid := '00000000-0000-0000-0000-000000012808';
  tA     uuid := '00000000-0000-0000-0000-0000000128a1';
  recusou boolean;
  n int;
  v_nova uuid;
begin
  perform pg_temp.como(dirceu);

  recusou := false;
  begin
    insert into public.teams (name, slug, director_id, manager_id)
    values ('Equipe forjada 0128', 'equipe-forjada-0128', dirceu, sandro);
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'diretor NÃO cria equipe com gerente que não enxerga');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name = 'Lead do Sandro 0128'), 0,
    'e o lead desse "gerente" continua fora do alcance do diretor');

  recusou := false;
  begin
    update public.teams set manager_id = guto where id = tA;
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'diretor NÃO troca o gerente da própria equipe por um de fora');

  update public.teams set name = 'Equipe A 0128 renomeada' where id = tA;
  get diagnostics n = row_count;
  perform pg_temp.assert_eq(n, 1, 'diretor renomeia a própria equipe (o gerente dela já é visível)');

  insert into public.teams (name, slug, director_id)
  values ('Equipe nova 0128', 'equipe-nova-0128', dirceu)
  returning id into v_nova;
  perform pg_temp.assert_eq(v_nova is not null, true, 'diretor cria equipe sem gerente (/admin/daily-teams)');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. reassign_lead: o lead de origem tem de estar ao alcance =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari   uuid := '00000000-0000-0000-0000-000000012801';
  gildo uuid := '00000000-0000-0000-0000-000000012803';
  caio  uuid := '00000000-0000-0000-0000-000000012804';
  beto  uuid := '00000000-0000-0000-0000-000000012807';
  v_beto uuid;
  v_sandro uuid;
  v_fila uuid;
  erro text;
begin
  perform pg_temp.como(ari);
  select id into v_beto   from public.leads where full_name = 'Lead do Beto 0128';
  select id into v_sandro from public.leads where full_name = 'Lead do Sandro 0128';
  select id into v_fila   from public.leads where full_name = 'Lead Fila 0128';

  perform pg_temp.como(gildo);

  -- "Não encontrado", e não "sem permissão": a segunda confirmaria que o id existe.
  erro := null;
  begin
    perform public.reassign_lead(v_beto, caio);
  exception when no_data_found then
    erro := 'P0002';
  end;
  perform pg_temp.assert_eq(erro, 'P0002', 'gerente NÃO puxa para a equipe dele o lead de outra equipe');

  erro := null;
  begin
    perform public.reassign_lead(v_sandro, caio);
  exception when no_data_found then
    erro := 'P0002';
  end;
  perform pg_temp.assert_eq(erro, 'P0002', 'gerente NÃO puxa o lead de corretor sem equipe');

  perform public.reassign_lead(v_fila, caio);
  perform pg_temp.assert_eq(
    (select assigned_to from public.leads where id = v_fila), caio,
    'gerente com leads.view_queue realoca lead da fila para a própria equipe');

  perform pg_temp.como(ari);
  perform pg_temp.assert_eq(
    (select assigned_to from public.leads where id = v_beto), beto,
    'o lead do Beto continua com o Beto');
  perform public.reassign_lead(v_beto, caio);
  perform pg_temp.assert_eq(
    (select assigned_to from public.leads where id = v_beto), caio,
    'admin realoca lead de qualquer equipe');
end
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. admin continua incluindo qualquer um =='
-- -----------------------------------------------------------------------------
do $$
declare
  ari    uuid := '00000000-0000-0000-0000-000000012801';
  gildo  uuid := '00000000-0000-0000-0000-000000012803';
  sandro uuid := '00000000-0000-0000-0000-000000012808';
  tA     uuid := '00000000-0000-0000-0000-0000000128a1';
begin
  perform pg_temp.como(ari);
  insert into public.team_members (team_id, profile_id) values (tA, sandro);

  perform pg_temp.como(gildo);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.leads where full_name = 'Lead do Sandro 0128'), 1,
    'incluído pelo admin, o corretor entra no alcance do gerente');
end
$$;

reset role;
select set_config('request.jwt.claims', null, false);

-- -----------------------------------------------------------------------------
\echo '== 5. sem sessão ninguém grava hierarquia =='
-- -----------------------------------------------------------------------------
set role anon;

do $$
declare
  recusou boolean;
begin
  recusou := false;
  begin
    insert into public.team_members (team_id, profile_id)
    values ('00000000-0000-0000-0000-0000000128b1', '00000000-0000-0000-0000-000000012805');
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'anônimo não grava filiação');

  recusou := false;
  begin
    insert into public.teams (name, slug, manager_id)
    values ('Equipe anônima 0128', 'equipe-anonima-0128', '00000000-0000-0000-0000-000000012808');
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'anônimo não cria equipe');

  -- Sem grant de EXECUTE a recusa vem antes do corpo da função (42501).
  recusou := false;
  begin
    perform public.reassign_lead(
      (select id from public.leads where full_name = 'Lead Fila 0128'),
      '00000000-0000-0000-0000-000000012804');
  exception when insufficient_privilege then
    recusou := true;
  end;
  perform pg_temp.assert_eq(recusou, true, 'anônimo não realoca lead');
end
$$;

reset role;

\echo 'hierarquia escopo ok'
