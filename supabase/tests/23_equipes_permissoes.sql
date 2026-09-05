-- =============================================================================
-- Regressão da 0061 — Equipes e permissões.
--
-- Todos os casos aqui têm a mesma forma: a TELA já escondia o controle e o
-- BANCO aceitava a chamada por API. O teste faz a chamada que a tela não faz.
--
-- Cada bloco roda com `request.jwt.claims` de um usuário real do cenário, como
-- o PostgREST faria — asserção que roda como superusuário não prova RLS nenhum.
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

/** Vira o usuário corrente do ponto de vista do RLS. */
create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, false);
$$;

-- -----------------------------------------------------------------------------
-- Cenário: duas diretorias que não se tocam, cada uma com gerente e corretor
-- -----------------------------------------------------------------------------
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-00000000c101';
  adm2 uuid := '00000000-0000-0000-0000-00000000c102';
  dirA uuid := '00000000-0000-0000-0000-00000000c111';
  gerA uuid := '00000000-0000-0000-0000-00000000c112';
  corA uuid := '00000000-0000-0000-0000-00000000c113';
  dirB uuid := '00000000-0000-0000-0000-00000000c121';
  gerB uuid := '00000000-0000-0000-0000-00000000c122';
  tA   uuid := '00000000-0000-0000-0000-00000000c1a1';
  tB   uuid := '00000000-0000-0000-0000-00000000c1b1';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@eq0061.test',  '{"full_name":"Admin 0061"}'),
    (adm2, 'adm2@eq0061.test', '{"full_name":"Admin 0061 B"}'),
    (dirA, 'dira@eq0061.test', '{"full_name":"Diretor A"}'),
    (gerA, 'gera@eq0061.test', '{"full_name":"Gerente A"}'),
    (corA, 'cora@eq0061.test', '{"full_name":"Corretor A"}'),
    (dirB, 'dirb@eq0061.test', '{"full_name":"Diretor B"}'),
    (gerB, 'gerb@eq0061.test', '{"full_name":"Gerente B"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (adm2, 'admin'),
    (dirA, 'director'), (gerA, 'manager'), (corA, 'broker'),
    (dirB, 'director'), (gerB, 'manager')
  on conflict do nothing;

  insert into public.teams (id, name, slug, manager_id, director_id) values
    (tA, 'Equipe 0061 A', 'equipe-0061-a', gerA, dirA),
    (tB, 'Equipe 0061 B', 'equipe-0061-b', gerB, dirB)
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id) values
    (tA, gerA), (tA, corA), (tB, gerB)
  on conflict do nothing;
end;
$$;

set role authenticated;

-- -----------------------------------------------------------------------------
\echo '== 1. teams: diretor manda na própria equipe, não na do vizinho =='
-- -----------------------------------------------------------------------------
do $$
declare
  dirA uuid := '00000000-0000-0000-0000-00000000c111';
  dirB uuid := '00000000-0000-0000-0000-00000000c121';
  tA   uuid := '00000000-0000-0000-0000-00000000c1a1';
  tB   uuid := '00000000-0000-0000-0000-00000000c1b1';
  v_linhas int;
begin
  perform pg_temp.como(dirA);

  update public.teams set name = 'Renomeada pelo A' where id = tA;
  get diagnostics v_linhas = row_count;
  perform pg_temp.assert_eq(v_linhas, 1, 'diretor renomeia a PRÓPRIA equipe');

  -- O defeito: `has_any_role('admin','director')` sem recorte deixava passar.
  update public.teams set name = 'Invadida pelo A' where id = tB;
  get diagnostics v_linhas = row_count;
  perform pg_temp.assert_eq(v_linhas, 0, 'diretor NÃO renomeia a equipe do vizinho');
  perform pg_temp.assert_eq(
    (select name from public.teams where id = tB), 'Equipe 0061 B',
    'e o nome da equipe do vizinho continua o mesmo');

  -- Nem passa a equipe do vizinho para si, nem entrega a própria a outro.
  update public.teams set director_id = dirA where id = tB;
  get diagnostics v_linhas = row_count;
  perform pg_temp.assert_eq(v_linhas, 0, 'diretor não se põe no comando da equipe do vizinho');

  begin
    update public.teams set director_id = dirB where id = tA;
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then v_linhas := -1;
  end;
  perform pg_temp.assert_eq(v_linhas <> 1, true, 'diretor não repassa a própria equipe a outro diretor');
end;
$$;

-- Equipe órfã (sem diretor): adotável só por quem JÁ enxerga o gerente dela.
--
-- A 0061 aceitava qualquer diretor em qualquer órfã, e órfã não é caso de
-- canto: `teams.director_id` é `on delete set null`, então excluir um diretor
-- orfana a diretoria inteira. Com `teams_select` aberto, um PATCH em /teams
-- bastava para o vizinho adotar e passar a enxergar todos os membros. A 0068
-- recorta pelo gerente visível.
do $$
declare
  dirA uuid := '00000000-0000-0000-0000-00000000c111';
  dirB uuid := '00000000-0000-0000-0000-00000000c121';
  orfa uuid := '00000000-0000-0000-0000-00000000c1c1';
  gerA uuid := '00000000-0000-0000-0000-00000000c112';
  v_linhas int;
begin
  perform pg_temp.como('00000000-0000-0000-0000-00000000c101'); -- admin cria
  insert into public.teams (id, name, slug, manager_id) values (orfa, 'Órfã 0061', 'orfa-0061', gerA)
  on conflict do nothing;

  -- O negativo primeiro: dirB não enxerga gerA (ele é da subárvore de dirA).
  perform pg_temp.como(dirB);
  update public.teams set director_id = dirB where id = orfa;
  get diagnostics v_linhas = row_count;
  perform pg_temp.assert_eq(v_linhas, 0, 'diretor NÃO adota órfã de gerente que não enxerga');
  perform pg_temp.assert_eq(
    (select director_id from public.teams where id = orfa), null::uuid,
    'e a órfã continua sem diretoria');

  perform pg_temp.como(dirA);
  update public.teams set director_id = dirA where id = orfa;
  get diagnostics v_linhas = row_count;
  perform pg_temp.assert_eq(v_linhas, 1, 'equipe sem diretor é adotada por quem já enxerga o gerente');
end;
$$;

-- -----------------------------------------------------------------------------
\echo '== 2. profiles: gerente não troca o e-mail de acesso do subordinado =='
-- -----------------------------------------------------------------------------
do $$
declare
  gerA uuid := '00000000-0000-0000-0000-00000000c112';
  corA uuid := '00000000-0000-0000-0000-00000000c113';
  v_recusou boolean := false;
begin
  perform pg_temp.como(gerA);

  -- O que o gerente PODE: desligar/suspender quem gerencia (0012).
  update public.profiles set status = 'suspended' where id = corA;
  perform pg_temp.assert_eq(
    (select status from public.profiles where id = corA), 'suspended',
    'gerente continua podendo suspender o subordinado');
  update public.profiles set status = 'active' where id = corA;

  -- O que não pode: `profiles.email` é o espelho do e-mail do Auth. Trocar aqui
  -- criaria um login que não existe.
  begin
    update public.profiles set email = 'sequestrado@eq0061.test' where id = corA;
  exception when insufficient_privilege then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'gerente NÃO troca o e-mail de acesso do subordinado');
  perform pg_temp.assert_eq(
    (select email from public.profiles where id = corA), 'cora@eq0061.test',
    'e o e-mail ficou como estava');
end;
$$;

-- -----------------------------------------------------------------------------
\echo '== 3. goals: diretor grava meta da própria diretoria =='
-- -----------------------------------------------------------------------------
do $$
declare
  dirA uuid := '00000000-0000-0000-0000-00000000c111';
  corA uuid := '00000000-0000-0000-0000-00000000c113';
  gerB uuid := '00000000-0000-0000-0000-00000000c122';
  v_recusou boolean := false;
begin
  perform pg_temp.como(dirA);

  insert into public.goals (scope, profile_id, period_type, period, metric, target)
  values ('profile', corA, 'month', date_trunc('month', current_date)::date, 'vgv', 1000)
  on conflict do nothing;
  perform pg_temp.assert_eq(
    exists (select 1 from public.goals where scope = 'profile' and profile_id = corA),
    true, 'diretor grava meta de quem está na própria diretoria');

  begin
    insert into public.goals (scope, profile_id, period_type, period, metric, target)
    values ('profile', gerB, 'month', date_trunc('month', current_date)::date, 'vgv', 9999);
  exception when insufficient_privilege then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'diretor NÃO grava meta de perfil de outra diretoria');

  -- Meta global continua aberta a diretor: é a meta da empresa e a tela a oferece.
  insert into public.goals (scope, period_type, period, metric, target)
  values ('global', 'month', date_trunc('month', current_date)::date, 'sales', 10)
  on conflict do nothing;
  perform pg_temp.assert_eq(
    exists (select 1 from public.goals where scope = 'global' and metric = 'sales'),
    true, 'meta global continua ao alcance do diretor');
end;
$$;

-- -----------------------------------------------------------------------------
\echo '== 4. user_roles: a instalacao nao fica sem administrador =='
-- -----------------------------------------------------------------------------
-- Em transacao com rollback: o guard conta TODOS os admins do banco, e o
-- cenario precisa dos dois do teste e de mais nenhum.
begin;

reset role;
delete from public.user_roles
 where role = 'admin'
   and profile_id not in ('00000000-0000-0000-0000-00000000c101',
                          '00000000-0000-0000-0000-00000000c102');
set role authenticated;

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-00000000c101';
  adm2 uuid := '00000000-0000-0000-0000-00000000c102';
  v_recusou boolean := false;
begin
  perform pg_temp.como(adm);

  -- Com dois admins, rebaixar o outro continua valendo.
  perform public.set_profile_roles(adm2, array['broker']::app_role[]);
  perform pg_temp.assert_eq(
    (select count(*)::int from public.user_roles where role = 'admin'),
    1, 'com dois admins, rebaixar um deixa o outro');

  -- O buraco real: `user_roles_admin_write` e `for all using is_admin()`, entao
  -- o admin apagava a propria linha DIRETO na tabela, sem passar pela RPC.
  v_recusou := false;
  begin
    delete from public.user_roles where profile_id = adm and role = 'admin';
  exception when raise_exception then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true,
    'o ultimo admin nao some nem por delete direto em user_roles');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.user_roles where role = 'admin'), 1,
    'e continua havendo um administrador');

  -- Pela ficha e a mesma coisa: a RPC apaga a linha e cai no mesmo gatilho.
  v_recusou := false;
  begin
    perform public.set_profile_roles(adm, array['broker']::app_role[]);
  exception when raise_exception then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'o ultimo admin tambem nao se rebaixa pela ficha');

  -- A outra porta: `user_roles_admin_write` e `for all`, entao UPDATE tambem
  -- passa. Trocar o papel da linha em vez de apaga-la esvaziava a instalacao
  -- sem o gatilho de DELETE disparar.
  v_recusou := false;
  begin
    update public.user_roles set role = 'broker' where profile_id = adm and role = 'admin';
  exception when raise_exception then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true,
    'o ultimo admin nao some por UPDATE do papel direto na tabela');
  perform pg_temp.assert_eq(
    (select count(*)::int from public.user_roles where role = 'admin'), 1,
    'e continua havendo um administrador depois da tentativa de UPDATE');
end;
$$;

-- Excluir o PERFIL do ultimo admin continua possivel: cascata nao e "retirar o
-- papel de alguem que fica". (Fora do bloco: apagar em auth.users e do dono.)
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000c101';
select pg_temp.assert_eq(
  exists (select 1 from public.user_roles
           where profile_id = '00000000-0000-0000-0000-00000000c101'), false,
  'excluir o perfil leva os papeis junto, sem o gatilho travar a cascata');

rollback;

-- -----------------------------------------------------------------------------
\echo '== 5. deals.edit_value: o switch passa a negar de verdade =='
-- -----------------------------------------------------------------------------
-- O gatilho é a trava; a policy `deals_update` decide a LINHA e não é assunto
-- deste teste. Por isso a atualização roda como dono da tabela (RLS fora) com o
-- JWT do corretor: o que sobra em jogo é exatamente `has_permission`.
reset role;

select pg_temp.assert_eq(
  exists (select 1 from public.permissions where code = 'deals.edit_value'),
  true, 'deals.edit_value continua no catálogo');

select pg_temp.assert_eq(
  exists (select 1 from public.role_permissions
           where role = 'broker' and permission = 'deals.edit_value' and allowed),
  true, 'corretor nasce com a permissão — nada muda no dia do deploy');

do $$
declare
  corA  uuid := '00000000-0000-0000-0000-00000000c113';
  negId uuid := '00000000-0000-0000-0000-00000000c1d1';
  v_recusou boolean := false;
begin
  insert into public.deals (id, stage_id, vgv_gross)
  select negId, s.id, 100000 from public.pipeline_stages s where s.code = 'lead'
  on conflict do nothing;

  perform pg_temp.como(corA);

  -- Com a concessão que a migration semeia, o corretor edita como antes.
  update public.deals set vgv_gross = 110000 where id = negId;
  perform pg_temp.assert_eq(
    (select vgv_gross from public.deals where id = negId), 110000::numeric,
    'com a permissão, editar VGV continua funcionando');

  -- Desligar o switch nega — é o que a tela de Permissões promete.
  update public.role_permissions set allowed = false
   where role = 'broker' and permission = 'deals.edit_value';
  begin
    update public.deals set vgv_gross = 999999 where id = negId;
  exception when insufficient_privilege then v_recusou := true;
  end;
  perform pg_temp.assert_eq(v_recusou, true, 'sem a permissão, o banco recusa a edição de VGV');
  perform pg_temp.assert_eq(
    (select vgv_gross from public.deals where id = negId), 110000::numeric,
    'e o valor não mudou');

  -- Campo que não é VGV continua livre: o gatilho é por coluna.
  update public.deals set notes = 'anotação sem VGV' where id = negId;
  perform pg_temp.assert_eq(
    (select notes from public.deals where id = negId), 'anotação sem VGV',
    'editar outro campo do negócio não é barrado pelo gatilho de VGV');

  update public.role_permissions set allowed = true
   where role = 'broker' and permission = 'deals.edit_value';
end;
$$;

-- -----------------------------------------------------------------------------
\echo '== 6. os três códigos sem leitor continuam sem leitor =='
-- -----------------------------------------------------------------------------
-- A 0061 chegou a APAGAR os três do catálogo, e a exclusão não sobrevivia ao
-- seed (`supabase/seed.sql` os reinsere depois de todas as migrations). O que
-- este teste pode garantir de verdade é o que não muda com seed nenhum: nenhuma
-- policy ou RPC lê os três, então a tela tem de continuar dizendo "Ainda sem
-- efeito" (`src/lib/featurePermissions.ts`, coberto por vitest).
select pg_temp.assert_eq(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%has_permission(''deals.view_all'')%'),
  0, 'nenhuma funcao do schema public le deals.view_all');

select pg_temp.assert_eq(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') like '%deals.view_all%'),
  0, 'nenhuma policy le deals.view_all');

select pg_temp.assert_eq(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosrc like '%has_permission(''users.manage_roles'')%'
        or p.prosrc like '%has_permission(''game.close_season'')%')),
  0, 'nem users.manage_roles nem game.close_season tem leitor');

-- -----------------------------------------------------------------------------
\echo '== 7. stage_permissions semeada =='
-- -----------------------------------------------------------------------------
-- Sem a semente, `db:reset` em banco limpo deixa a matriz vazia e só o admin
-- move negócio. `>= 39` e não `= 39`: outro arquivo do harness pode ter
-- concedido etapa antes deste rodar, e o que importa é a semente ter entrado.
select pg_temp.assert_eq(
  (select count(*)::int from public.stage_permissions) >= 39,
  true, 'db:reset em banco limpo já nasce com a matriz de etapas');

select pg_temp.assert_eq(
  (select sp.can_enter from public.stage_permissions sp
     join public.pipeline_stages s on s.id = sp.stage_id
    where s.code = 'approved' and sp.role = 'broker'),
  false, 'a semente respeita a 0052: corretor não entra em Aprovado');

select pg_temp.assert_eq(
  (select sp.can_enter from public.stage_permissions sp
     join public.pipeline_stages s on s.id = sp.stage_id
    where s.code = 'approved' and sp.role = 'cca'),
  true, 'e o CCA entra');

-- -----------------------------------------------------------------------------
\echo '== 8. access_provision_log: leitura só de admin =='
-- -----------------------------------------------------------------------------
insert into public.access_provision_log (actor_id, profile_id, action, email)
values ('00000000-0000-0000-0000-00000000c101',
        '00000000-0000-0000-0000-00000000c113',
        'reset', 'cora@eq0061.test');

set role authenticated;

select pg_temp.como('00000000-0000-0000-0000-00000000c113');
select pg_temp.assert_eq(
  (select count(*)::int from public.access_provision_log), 0,
  'corretor não lê a trilha de provisionamento');

select pg_temp.como('00000000-0000-0000-0000-00000000c101');
select pg_temp.assert_eq(
  (select count(*)::int from public.access_provision_log) > 0, true,
  'admin lê a trilha');

reset role;
select set_config('request.jwt.claims', null, false);

\echo 'equipes e permissoes ok'