-- =============================================================================
-- Regressão da 0044 — permissões de funcionalidade lidas pelo banco.
--
-- Antes da 0044 a aba "Funcionalidades" gravava em `role_permissions` códigos
-- que nenhuma policy nem RPC lia: o admin desligava "Realocar leads" para o
-- gerente e o gerente continuava realocando. O teste prova, para cada código
-- que passou a valer, as três pontas do contrato:
--   1. a concessão inicial reproduz quem passava antes (nada muda no deploy);
--   2. desligar a concessão faz o banco recusar (não só a tela);
--   3. admin continua passando sem linha na matriz (`is_admin()` curto-circuita).
--
-- Mais duas pontas que o rótulo da tela promete: `leads.view_queue` governa a
-- fila no SELECT e no UPDATE (se divergirem, a tela mostra o lead e o Salvar
-- casa 0 linhas em silêncio) e `menu.admin_allowed_ips` libera LER `allowed_ips`
-- para qualquer papel a quem o item for concedido.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check21(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- Escopo de sessão (is_local = false): cada statement do psql é uma transação.
create or replace function pg_temp.become21(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres, ignorando RLS)
--
--   Equipe 0044 (gerente: Gina) ── corretores: Caio, Cadu · Célio está fora
--   Adão = admin · Ciro = CCA · Mila = marketing · Saulo = sócio
--
-- `handle_new_auth_user` dá `broker` a todo mundo; os papéis extras entram aqui.
-- -----------------------------------------------------------------------------
do $$
declare
  adm   uuid := '00000000-0000-0000-0000-000000004401';
  ger   uuid := '00000000-0000-0000-0000-000000004402';
  cor   uuid := '00000000-0000-0000-0000-000000004403';
  cor2  uuid := '00000000-0000-0000-0000-000000004404';
  cor3  uuid := '00000000-0000-0000-0000-000000004405';
  cca1  uuid := '00000000-0000-0000-0000-000000004406';
  mkt   uuid := '00000000-0000-0000-0000-000000004407';
  soc   uuid := '00000000-0000-0000-0000-000000004408';
  v_team uuid;
  v_stage uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adao@perm44.test',  '{"full_name":"Adão Admin 44"}'),
    (ger,  'gina@perm44.test',  '{"full_name":"Gina Gerente 44"}'),
    (cor,  'caio@perm44.test',  '{"full_name":"Caio Corretor 44"}'),
    (cor2, 'cadu@perm44.test',  '{"full_name":"Cadu Corretor 44"}'),
    (cor3, 'celio@perm44.test', '{"full_name":"Célio Corretor 44"}'),
    (cca1, 'ciro@perm44.test',  '{"full_name":"Ciro CCA 44"}'),
    (mkt,  'mila@perm44.test',  '{"full_name":"Mila Marketing 44"}'),
    (soc,  'saulo@perm44.test', '{"full_name":"Saulo Sócio 44"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (cca1, 'cca'), (mkt, 'marketing'), (soc, 'partner')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe 0044', ger)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor), (v_team, cor2);

  insert into public.leads (full_name, phone) values ('Lead Fila 0044', '11977770441');
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead do Caio 0044', '11977770442', 'assigned', cor);

  -- Testes anteriores fecham o mês corrente; o guard de mês fechado barraria o insert.
  delete from public.closed_months where period = public.month_start(current_date);
  select id into v_stage from public.pipeline_stages where code = 'proposal';
  insert into public.deals (stage_id, created_by) values (v_stage, cor);

  insert into public.allowed_ips (label, ip_range) values ('faixa 0044', '198.51.100.44/32');
end
$$;

set role authenticated;

\echo '== 1. catálogo e concessões iniciais =='

do $$
declare
  ger uuid := '00000000-0000-0000-0000-000000004402';
  cor uuid := '00000000-0000-0000-0000-000000004403';
  n   int;
begin
  select count(*) into n from public.permissions
  where code in ('leads.view_queue','leads.reassign','leads.delete','deals.view_all',
                 'deals.edit_value','deals.delete','cca.review','reports.view_finance',
                 'teams.manage','users.manage_roles','settings.integrations','game.close_season');
  perform pg_temp.check21(n = 12, format('os 12 códigos de funcionalidade existem sem depender do seed (tem %s)', n));

  perform pg_temp.become21(ger);
  perform pg_temp.check21(public.has_permission('leads.reassign'), 'gerente nasce com leads.reassign');
  perform pg_temp.check21(public.has_permission('teams.manage'),   'gerente nasce com teams.manage');
  perform pg_temp.check21(not public.has_permission('leads.delete'), 'gerente não nasce com leads.delete');

  perform pg_temp.become21(cor);
  perform pg_temp.check21(not public.has_permission('leads.reassign'), 'corretor não realoca');
end
$$;

\echo '== 2. leads.view_queue: lead sem dono só para quem tem a permissão =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000000004407';
  soc uuid := '00000000-0000-0000-0000-000000004408';
  ger uuid := '00000000-0000-0000-0000-000000004402';
  adm uuid := '00000000-0000-0000-0000-000000004401';
begin
  perform pg_temp.become21(mkt);
  perform pg_temp.check21(
    exists (select 1 from public.leads where full_name = 'Lead Fila 0044'),
    'marketing continua vendo a fila (concessão da 0044 reproduz a policy antiga)');

  perform pg_temp.become21(soc);
  perform pg_temp.check21(
    not exists (select 1 from public.leads where full_name = 'Lead Fila 0044'),
    'sócio (sem a permissão) não vê a fila');

  -- Desligar para o marketing tira a fila dele; só a matriz decide.
  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = false
   where role = 'marketing' and permission = 'leads.view_queue';

  perform pg_temp.become21(mkt);
  perform pg_temp.check21(
    not exists (select 1 from public.leads where full_name = 'Lead Fila 0044'),
    'marketing com a permissão desligada deixa de ver a fila');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = true
   where role = 'marketing' and permission = 'leads.view_queue';

  perform pg_temp.become21(ger);
  perform pg_temp.check21(
    exists (select 1 from public.leads where full_name = 'Lead Fila 0044'),
    'gerente vê a fila');
end
$$;

\echo '== 2b. leads.view_queue alcança a edição, não só a leitura =='

-- `leads_select` e `leads_update` têm de decidir a fila pelo MESMO predicado.
-- Enquanto o UPDATE ficou em papel cru, conceder a permissão a um corretor
-- fazia o lead sem dono aparecer na tela e todo Salvar casar 0 linhas: o
-- PostgREST devolve 204 e a tela diz "Dados salvos" sem gravar nada.
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000004401';
  cor uuid := '00000000-0000-0000-0000-000000004403';
  v_lead uuid;
  n int;
begin
  perform pg_temp.become21(adm);
  select id into v_lead from public.leads where full_name = 'Lead Fila 0044';

  perform pg_temp.become21(cor);
  update public.leads set notes = 'tentativa 0044' where id = v_lead;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'corretor sem leads.view_queue não edita o lead da fila');

  perform pg_temp.become21(adm);
  insert into public.role_permissions (role, permission, allowed)
  values ('broker', 'leads.view_queue', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(cor);
  perform pg_temp.check21(
    exists (select 1 from public.leads where id = v_lead),
    'com leads.view_queue, o corretor enxerga o lead da fila');
  update public.leads set notes = 'tentativa 0044' where id = v_lead;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 1, 'quem vê a fila também edita (row_count = 1, não 204 vazio)');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'broker' and permission = 'leads.view_queue';

  perform pg_temp.become21(cor);
  update public.leads set notes = 'depois de revogar' where id = v_lead;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'revogada a permissão, o corretor deixa de editar a fila');
end
$$;

\echo '== 3. leads.reassign: a RPC lê a matriz =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000004401';
  ger  uuid := '00000000-0000-0000-0000-000000004402';
  cor  uuid := '00000000-0000-0000-0000-000000004403';
  cor2 uuid := '00000000-0000-0000-0000-000000004404';
  v_lead uuid;
begin
  perform pg_temp.become21(adm);
  select id into v_lead from public.leads where full_name = 'Lead Fila 0044';

  perform pg_temp.become21(ger);
  perform public.reassign_lead(v_lead, cor);
  perform pg_temp.check21(
    (select assigned_to from public.leads where id = v_lead) = cor,
    'gerente com a permissão realoca para corretor da própria equipe');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = false
   where role = 'manager' and permission = 'leads.reassign';

  perform pg_temp.become21(ger);
  begin
    perform public.reassign_lead(v_lead, cor2);
    raise exception 'FALHOU: gerente realocou com a permissão desligada';
  exception
    when insufficient_privilege then
      raise notice '  ok  permissão desligada: reassign_lead recusa o gerente';
  end;
  perform pg_temp.check21(
    (select assigned_to from public.leads where id = v_lead) = cor,
    'lead continua com quem estava');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = true
   where role = 'manager' and permission = 'leads.reassign';

  -- Ligada de novo, mas o escopo (liderar a equipe do destino) continua valendo.
  perform pg_temp.become21(cor);
  begin
    perform public.reassign_lead(v_lead, cor2);
    raise exception 'FALHOU: corretor realocou lead';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor sem a permissão continua barrado';
  end;

  perform pg_temp.become21(adm);
  perform public.reassign_lead(v_lead, cor2);
  perform pg_temp.check21(
    (select assigned_to from public.leads where id = v_lead) = cor2,
    'admin realoca sem linha na matriz');
end
$$;

\echo '== 4. leads.delete / deals.delete: sem concessão, só admin =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000004401';
  ger uuid := '00000000-0000-0000-0000-000000004402';
  cor uuid := '00000000-0000-0000-0000-000000004403';
  v_lead uuid;
  v_deal uuid;
  n int;
begin
  perform pg_temp.become21(adm);
  select id into v_lead from public.leads where full_name = 'Lead do Caio 0044';
  select id into v_deal from public.deals where created_by = cor order by created_at desc limit 1;

  -- RLS filtra o DELETE em silêncio: a prova é o row_count.
  perform pg_temp.become21(ger);
  delete from public.leads where id = v_lead;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'gerente (vê o lead da equipe) não o exclui sem leads.delete');

  perform pg_temp.become21(adm);
  insert into public.role_permissions (role, permission, allowed)
  values ('manager', 'leads.delete', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(ger);
  delete from public.leads where id = v_lead;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 1, 'com leads.delete concedido, o gerente exclui');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'manager' and permission = 'leads.delete';

  -- deals.delete: o corretor vê o negócio que criou, mas não o exclui.
  perform pg_temp.become21(cor);
  perform pg_temp.check21(exists (select 1 from public.deals where id = v_deal),
    'corretor enxerga o negócio que criou');
  delete from public.deals where id = v_deal;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'corretor não exclui negócio sem deals.delete');

  perform pg_temp.become21(adm);
  insert into public.role_permissions (role, permission, allowed)
  values ('broker', 'deals.delete', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(cor);
  delete from public.deals where id = v_deal;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 1, 'com deals.delete concedido, o corretor exclui');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'broker' and permission = 'deals.delete';
end
$$;

\echo '== 5. cca.review: editar negócio em análise e mexer na esteira =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000004401';
  cca1 uuid := '00000000-0000-0000-0000-000000004406';
  cor  uuid := '00000000-0000-0000-0000-000000004403';
  v_deal uuid;
  v_qual text;
begin
  -- Negócio novo para o CCA (o do bloco 4 foi excluído de propósito).
  reset role;
  select id into v_deal from public.deals where created_by = cor order by created_at desc limit 1;
  if v_deal is null then
    insert into public.deals (stage_id, created_by)
    select id, cor from public.pipeline_stages where code = 'proposal'
    returning id into v_deal;
  end if;
  set role authenticated;

  perform pg_temp.become21(cca1);
  perform pg_temp.check21(public.can_edit_deal(v_deal), 'CCA edita negócio em análise (cca.review de fábrica)');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = false
   where role = 'cca' and permission = 'cca.review';

  perform pg_temp.become21(cca1);
  perform pg_temp.check21(not public.can_edit_deal(v_deal), 'cca.review desligado: CCA deixa de editar o negócio');
  begin
    insert into public.cca_cases (deal_id) values (v_deal);
    raise exception 'FALHOU: CCA abriu caso com cca.review desligado';
  exception
    when insufficient_privilege then
      raise notice '  ok  cca.review desligado: cca_cases_write recusa';
  end;

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = true
   where role = 'cca' and permission = 'cca.review';

  select pg_get_expr(p.polqual, p.polrelid) into v_qual
  from pg_policy p where p.polname = 'developer_submissions_write'
    and p.polrelid = 'public.developer_submissions'::regclass;
  perform pg_temp.check21(position('cca.review' in v_qual) > 0,
    'developer_submissions_write também lê cca.review');
end
$$;

\echo '== 6. teams.manage: a permissão é a capacidade, liderar é o escopo =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000004401';
  ger  uuid := '00000000-0000-0000-0000-000000004402';
  cor3 uuid := '00000000-0000-0000-0000-000000004405';
  v_team uuid;
  n int;
begin
  select id into v_team from public.teams where name = 'Equipe 0044';

  perform pg_temp.become21(ger);
  insert into public.team_members (team_id, profile_id) values (v_team, cor3);
  perform pg_temp.check21(true, 'gerente inclui integrante na equipe que lidera');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = false
   where role = 'manager' and permission = 'teams.manage';

  perform pg_temp.become21(ger);
  update public.team_members set left_at = now()
   where team_id = v_team and profile_id = cor3;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'teams.manage desligado: gerente não desliga integrante');

  perform pg_temp.become21(adm);
  update public.role_permissions set allowed = true
   where role = 'manager' and permission = 'teams.manage';

  perform pg_temp.become21(ger);
  update public.team_members set left_at = now()
   where team_id = v_team and profile_id = cor3;
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 1, 'teams.manage ligado: gerente desliga integrante');
end
$$;

\echo '== 7. settings.integrations: cofre pela matriz =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000004401';
  cca1 uuid := '00000000-0000-0000-0000-000000004406';
  n int;
begin
  perform pg_temp.become21(cca1);
  begin
    perform count(*) from public.list_integrations();
    raise exception 'FALHOU: CCA listou integrações sem a permissão';
  exception
    when insufficient_privilege then
      raise notice '  ok  sem settings.integrations, list_integrations recusa';
  end;
  begin
    perform public.set_integration_secret('teste44', 'api_key', 'nao-e-um-segredo-real', '{}'::jsonb);
    raise exception 'FALHOU: CCA gravou credencial sem a permissão';
  exception
    when insufficient_privilege then
      raise notice '  ok  sem settings.integrations, set_integration_secret recusa';
  end;

  perform pg_temp.become21(adm);
  insert into public.role_permissions (role, permission, allowed)
  values ('cca', 'settings.integrations', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(cca1);
  select count(*) into n from public.list_integrations();
  perform pg_temp.check21(n >= 0, 'com settings.integrations, list_integrations responde');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'cca' and permission = 'settings.integrations';
  -- Sem linha na matriz: se a chamada levantasse, o bloco inteiro falharia.
  perform count(*) from public.list_integrations();
  perform pg_temp.check21(true, 'admin lista integrações sem linha na matriz');
end
$$;

\echo '== 8. allowed_ips: conceder o menu é leitura; escrita continua do admin =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000004401';
  soc uuid := '00000000-0000-0000-0000-000000004408';
  cor uuid := '00000000-0000-0000-0000-000000004403';
  n int;
begin
  perform pg_temp.become21(soc);
  select count(*) into n from public.allowed_ips where label = 'faixa 0044';
  perform pg_temp.check21(n = 0, 'sócio sem o menu não lê allowed_ips');

  perform pg_temp.become21(adm);
  insert into public.role_permissions (role, permission, allowed)
  values ('partner', 'menu.admin_allowed_ips', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(soc);
  select count(*) into n from public.allowed_ips where label = 'faixa 0044';
  perform pg_temp.check21(n = 1, 'sócio com o menu lê a lista (a tela deixa de abrir vazia)');

  begin
    insert into public.allowed_ips (label, ip_range) values ('invasao 0044', '198.51.100.45/32');
    raise exception 'FALHOU: sócio cadastrou IP';
  exception
    when insufficient_privilege then
      raise notice '  ok  sócio não cadastra IP';
  end;
  update public.allowed_ips set active = false where label = 'faixa 0044';
  get diagnostics n = row_count;
  perform pg_temp.check21(n = 0, 'sócio não desativa IP');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'partner' and permission = 'menu.admin_allowed_ips';

  -- Alcance que a aba Menu passou a declarar ("Aplicada no banco"): o item vale
  -- para QUALQUER papel a quem o admin conceder, inclusive o corretor — que é o
  -- alvo do controle antifraude. Não é acidente; é o que a tela avisa antes.
  insert into public.role_permissions (role, permission, allowed)
  values ('broker', 'menu.admin_allowed_ips', true)
  on conflict (role, permission) do update set allowed = true;

  perform pg_temp.become21(cor);
  select count(*) into n from public.allowed_ips where label = 'faixa 0044';
  perform pg_temp.check21(n = 1, 'conceder o menu ao corretor também entrega a lista de faixas');

  perform pg_temp.become21(adm);
  delete from public.role_permissions where role = 'broker' and permission = 'menu.admin_allowed_ips';

  perform pg_temp.become21(cor);
  select count(*) into n from public.allowed_ips where label = 'faixa 0044';
  perform pg_temp.check21(n = 0, 'revogado o menu, o corretor deixa de ler as faixas');
end
$$;

reset role;
select set_config('request.jwt.claims', null, false);

-- Limpeza do que este arquivo criou (usuários ficam: os outros testes também deixam os seus).
do $$
begin
  delete from public.deals where created_by = '00000000-0000-0000-0000-000000004403';
  delete from public.leads where full_name in ('Lead Fila 0044', 'Lead do Caio 0044');
  delete from public.allowed_ips where label in ('faixa 0044', 'invasao 0044');
  delete from public.teams where name = 'Equipe 0044';
end
$$;

\echo 'permissões de funcionalidade ok'
