-- =============================================================================
-- 99 · Ações na Meta, fila do gestor IA e execuções de IA (migration 0116)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`; a migration coberta é a 0116. Roda ANTES
-- de 99_meta_livro_sincronizacao.sql (ordem alfabética): nada aqui grava
-- insight nem planilha, para não mexer nas somas que aquele arquivo confere.
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. marketing.meta_manage na matriz: marketing e sócio têm; diretor e
--      corretor não.
--   2. A regra dos 30% é UMA função imutável, a mesma que o executor chama.
--   3. Corretor e diretor levam 42501 ao criar ação; marketing e sócio passam.
--   4. 100 → 130 sem confirmação devolve 'precisa_confirmar' e não grava; com
--      confirmação grava 'aprovada' com exigiu_aprendizado; 100 → 129 não pede.
--   5. Conta desligada, campanha sem conta, verba total e verba zero: 22023.
--   6. Escrita direta nas quatro tabelas é recusada (inclusive o plano, que só
--      a edge do planejador grava); corretor não enxerga nada.
--   7. Fila: validade de 24 h, duplicada devolve null, vencida decide como
--      'expirada', aprovação recalcula contra a verba ATUAL, decidir duas vezes
--      não reexecuta, IA não propõe em campanha de outra conta.
--   8. meta_action_claim duas vezes: a segunda devolve null; finish grava na
--      campanha passando pelo guard da 0115.
--   9. Ao vivo passou dos 30% sem o aviso aceito: nada na Meta, e a proposta
--      volta para a fila.
--  10. meta_ai_run_start: reuso em menos de 10 min; cron uma vez por dia.
--  11. Grants.
--
-- RLS e travas conferidas com `set local role authenticated` e
-- request.jwt.claims por pessoa. UUIDs na faixa `…-000001160001+`.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check116(cond boolean, label text)
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

/** Assume a identidade de alguém logado, como o PostgREST faria. */
create or replace function pg_temp.become116(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

/** A edge function com a service role. */
create or replace function pg_temp.servico116()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres)
--   Mara = marketing · Caio = corretor · Dora = diretora · Sara = sócia
--   Contas: ligada, desligada e outra ligada
--   Campanhas com verba 100: CBO, ABO, da conta desligada, digitada (sem
--   conta), IA e IA2 (para a fila), uma da outra conta; e uma de verba total
-- -----------------------------------------------------------------------------
do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001160001';
  cor   uuid := '00000000-0000-0000-0000-000001160002';
  dir   uuid := '00000000-0000-0000-0000-000001160003';
  soc   uuid := '00000000-0000-0000-0000-000001160004';
  liga  uuid := '7f000000-0000-0000-0000-000001160001';
  desl  uuid := '7f000000-0000-0000-0000-000001160002';
  outra uuid := '7f000000-0000-0000-0000-000001160003';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (mkt, 'mara@t116.test', '{"full_name":"Mara Marketing 116"}'),
    (cor, 'caio@t116.test', '{"full_name":"Caio Corretor 116"}'),
    (dir, 'dora@t116.test', '{"full_name":"Dora Diretora 116"}'),
    (soc, 'sara@t116.test', '{"full_name":"Sara Sócia 116"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (mkt, 'marketing'), (cor, 'broker'), (dir, 'director'), (soc, 'partner')
  on conflict do nothing;

  insert into public.meta_ad_accounts (id, act_id, name, enabled) values
    (liga,  'act_1160001', 'Conta 0116',           true),
    (desl,  'act_1160002', 'Conta desligada 0116', false),
    (outra, 'act_1160003', 'Outra conta 0116',     true);

  insert into public.developers (id, name, slug) values
    ('7d000000-0000-0000-0000-000001160001', 'Construtora 0116', 'construtora-0116')
  on conflict do nothing;

  insert into public.ad_campaigns
    (id, external_id, platform, name, status, daily_budget, lifetime_budget, meta_account_id, meta_budget_level)
  values
    ('7e000000-0000-0000-0000-000001160001', 'camp-0116-cbo',    'meta', 'CBO 0116',    'ACTIVE', 100,  null, liga,  'campaign'),
    ('7e000000-0000-0000-0000-000001160002', 'camp-0116-abo',    'meta', 'ABO 0116',    'ACTIVE', 100,  null, liga,  'adset'),
    ('7e000000-0000-0000-0000-000001160003', 'camp-0116-total',  'meta', 'Total 0116',  'ACTIVE', null, 3000, liga,  'lifetime'),
    ('7e000000-0000-0000-0000-000001160004', 'camp-0116-desl',   'meta', 'Desl 0116',   'ACTIVE', 100,  null, desl,  'campaign'),
    ('7e000000-0000-0000-0000-000001160005', 'camp-0116-manual', 'meta', 'Manual 0116', 'ACTIVE', 100,  null, null,  null),
    ('7e000000-0000-0000-0000-000001160006', 'camp-0116-ia',     'meta', 'IA 0116',     'ACTIVE', 100,  null, liga,  'campaign'),
    ('7e000000-0000-0000-0000-000001160007', 'camp-0116-ia2',    'meta', 'IA2 0116',    'ACTIVE', 100,  null, liga,  'campaign'),
    ('7e000000-0000-0000-0000-000001160008', 'camp-0116-outra',  'meta', 'Outra 0116',  'ACTIVE', 100,  null, outra, 'campaign');
end
$$;

\echo '== 1. marketing.meta_manage na matriz: marketing e sócio têm; diretor e corretor não =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001160001';
  cor uuid := '00000000-0000-0000-0000-000001160002';
  dir uuid := '00000000-0000-0000-0000-000001160003';
  soc uuid := '00000000-0000-0000-0000-000001160004';
begin
  perform pg_temp.check116(
    exists (select 1 from public.permissions
             where code = 'marketing.meta_manage' and category = 'marketing'
               and label = 'Gerenciar campanhas na Meta'),
    'o código entra no catálogo, na categoria marketing');
  perform pg_temp.check116(
    exists (select 1 from public.role_permissions
             where role = 'marketing' and permission = 'marketing.meta_manage' and allowed)
    and not exists (select 1 from public.role_permissions
                     where permission = 'marketing.meta_manage' and allowed
                       and role in ('director', 'manager', 'broker', 'cca', 'sdr')),
    'a migration concede ao marketing, e não a diretor, gerente, corretor, CCA nem SDR');

  set local role authenticated;
  perform pg_temp.become116(mkt);
  perform pg_temp.check116(public.has_permission('marketing.meta_manage'), 'marketing tem');
  perform pg_temp.become116(soc);
  perform pg_temp.check116(public.has_permission('marketing.meta_manage'), 'sócio tem (is_admin, 0097)');
  perform pg_temp.become116(dir);
  perform pg_temp.check116(not public.has_permission('marketing.meta_manage'), 'diretor não tem sem o switch');
  perform pg_temp.become116(cor);
  perform pg_temp.check116(not public.has_permission('marketing.meta_manage'), 'corretor não tem');
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 2. a regra dos 30% mora numa função imutável só =='

do $$
begin
  perform pg_temp.check116(public.meta_action_precisa_aprendizado(100, 130), '100 → 130 (+30%) pede confirmação');
  perform pg_temp.check116(not public.meta_action_precisa_aprendizado(100, 129), '100 → 129 não pede');
  perform pg_temp.check116(not public.meta_action_precisa_aprendizado(100, 40), 'redução nunca pede');
  perform pg_temp.check116(
    not public.meta_action_precisa_aprendizado(0, 50)
    and not public.meta_action_precisa_aprendizado(null, 50)
    and not public.meta_action_precisa_aprendizado(100, null),
    'sem verba atual (ou sem verba nova) não há variação: devolve false, nunca nulo');
  perform pg_temp.check116(
    (select p.provolatile = 'i' from pg_proc p
      where p.oid = 'public.meta_action_precisa_aprendizado(numeric,numeric)'::regprocedure),
    'é immutable: o executor faz a mesma conta com a verba lida ao vivo');
end
$$;

\echo '== 3. criar ação: corretor e diretor levam 42501; marketing e sócio passam =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001160001';
  cor uuid := '00000000-0000-0000-0000-000001160002';
  dir uuid := '00000000-0000-0000-0000-000001160003';
  soc uuid := '00000000-0000-0000-0000-000001160004';
  cbo uuid := '7e000000-0000-0000-0000-000001160001';
  r   jsonb;
  v   record;
begin
  set local role authenticated;

  perform pg_temp.become116(cor);
  begin
    perform public.meta_action_create(cbo, 'pausar');
    raise exception 'FALHOU: corretor pausou campanha na Meta';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_action_create';
  end;

  perform pg_temp.become116(dir);
  begin
    perform public.meta_action_create(cbo, 'pausar');
    raise exception 'FALHOU: diretor pausou campanha sem o switch';
  exception when insufficient_privilege then
    raise notice '  ok  diretor leva 42501 em meta_action_create';
  end;

  perform pg_temp.become116(mkt);
  r := public.meta_action_create(cbo, 'pausar');
  perform pg_temp.check116(r->>'status' = 'aprovada' and r->>'action_id' is not null,
    format('marketing pausa: a ação nasce aprovada (%s)', r));
  select * into v from public.meta_actions where id = (r->>'action_id')::uuid;
  perform pg_temp.check116(v.origem = 'manual' and v.requested_by = mkt and v.decided_by = mkt
    and v.decided_at is not null and v.account_id = '7f000000-0000-0000-0000-000001160001'
    and v.campaign_external_id = 'camp-0116-cbo' and v.campaign_name = 'CBO 0116'
    and v.verba_nova is null and not v.exigiu_aprendizado,
    'pedida e decidida por quem clicou, com a foto da campanha e da conta');

  perform pg_temp.become116(soc);
  r := public.meta_action_create(cbo, 'ativar');
  perform pg_temp.check116(r->>'status' = 'aprovada', 'sócio ativa (é administrador para a matriz)');

  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 4. verba: +30% pede confirmação e não grava; confirmado grava; +29% não pede =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001160001';
  cbo uuid := '7e000000-0000-0000-0000-000001160001';
  abo uuid := '7e000000-0000-0000-0000-000001160002';
  n0  int;
  r   jsonb;
  v   record;
begin
  select count(*) into n0 from public.meta_actions where campaign_id = cbo and acao = 'verba';

  set local role authenticated;
  perform pg_temp.become116(mkt);

  r := public.meta_action_create(cbo, 'verba', 130);
  perform pg_temp.check116(r->>'status' = 'precisa_confirmar' and (r->>'variacao')::numeric = 0.30
    and (r->>'verba_atual')::numeric = 100 and (r->>'verba_nova')::numeric = 130,
    format('100 → 130 sem confirmação devolve precisa_confirmar com a variação (%s)', r));
  perform pg_temp.check116(
    (select count(*) from public.meta_actions where campaign_id = cbo and acao = 'verba') = n0,
    'e não cria linha nenhuma');

  r := public.meta_action_create(cbo, 'verba', 130, true);
  select * into v from public.meta_actions where id = (r->>'action_id')::uuid;
  perform pg_temp.check116(r->>'status' = 'aprovada' and v.status = 'aprovada' and v.exigiu_aprendizado
    and v.variacao = 0.30 and v.verba_anterior = 100 and v.verba_nova = 130,
    'com confirmação: aprovada, exigiu_aprendizado = true, de 100 para 130');

  r := public.meta_action_create(cbo, 'verba', 129);
  select * into v from public.meta_actions where id = (r->>'action_id')::uuid;
  perform pg_temp.check116(r->>'status' = 'aprovada' and not v.exigiu_aprendizado and v.variacao = 0.29,
    '100 → 129 não pede confirmação');

  r := public.meta_action_create(abo, 'verba', 110);
  perform pg_temp.check116(r->>'status' = 'aprovada', 'verba nos conjuntos (ABO) também passa');

  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 5. conta desligada, campanha sem conta, verba total e verba zero: 22023 =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001160001';
  cbo   uuid := '7e000000-0000-0000-0000-000001160001';
  total uuid := '7e000000-0000-0000-0000-000001160003';
  desl  uuid := '7e000000-0000-0000-0000-000001160004';
  manu  uuid := '7e000000-0000-0000-0000-000001160005';
begin
  set local role authenticated;
  perform pg_temp.become116(mkt);

  begin
    perform public.meta_action_create(desl, 'pausar');
    raise exception 'FALHOU: ação em campanha de conta desligada';
  exception when invalid_parameter_value then
    raise notice '  ok  campanha de conta desligada é recusada (22023)';
  end;
  begin
    perform public.meta_action_create(manu, 'pausar');
    raise exception 'FALHOU: ação em campanha sem conta de anúncios';
  exception when invalid_parameter_value then
    raise notice '  ok  campanha digitada, sem conta de anúncios, é recusada (22023)';
  end;
  begin
    perform public.meta_action_create(total, 'verba', 200);
    raise exception 'FALHOU: verba diária em campanha de verba total';
  exception when invalid_parameter_value then
    raise notice '  ok  verba em campanha de verba total é recusada (22023)';
  end;
  begin
    perform public.meta_action_create(cbo, 'verba', 0);
    raise exception 'FALHOU: verba zero aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  verba menor ou igual a zero é recusada (22023)';
  end;
  begin
    perform public.meta_action_create(cbo, 'verba');
    raise exception 'FALHOU: verba sem valor aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  verba sem valor é recusada (22023)';
  end;
  begin
    perform public.meta_action_create(cbo, 'excluir');
    raise exception 'FALHOU: ação desconhecida aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  ação fora de pausar, ativar e verba é recusada (22023)';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check116(
    not exists (select 1 from public.meta_actions where campaign_id in (total, desl, manu)),
    'nenhuma recusa deixou linha');
end
$$;

\echo '== 6. escrita direta recusada; só as RPCs gravam; corretor não enxerga =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001160001';
  cor uuid := '00000000-0000-0000-0000-000001160002';
  cbo uuid := '7e000000-0000-0000-0000-000001160001';
  n   int;
begin
  set local role authenticated;
  perform pg_temp.become116(mkt);

  begin
    insert into public.meta_actions (campaign_external_id, origem, acao, status, decided_at)
    values ('camp-0116-forjada', 'manual', 'pausar', 'aprovada', now());
    raise exception 'FALHOU: marketing inseriu ação direto';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto em meta_actions é recusado (RLS)';
  end;
  begin
    update public.meta_actions set status = 'executada' where campaign_id = cbo;
    raise exception 'FALHOU: marketing editou ação direto';
  exception when insufficient_privilege then
    raise notice '  ok  update direto em meta_actions é recusado';
  end;
  begin
    delete from public.meta_actions where campaign_id = cbo;
    raise exception 'FALHOU: marketing apagou o histórico';
  exception when insufficient_privilege then
    raise notice '  ok  delete direto em meta_actions é recusado';
  end;
  begin
    insert into public.meta_campaign_plans (developer_id, padrao, formato, canal, verba_diaria, nome, plano)
    values ('7d000000-0000-0000-0000-000001160001', 'mcmv', 'imagem', 'formulario', 50,
            'CONSTRUTORA 0116 | FORMULARIO', '{"interesses":[{"id":"inventado"}]}');
    raise exception 'FALHOU: plano gravado direto pelo PostgREST';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto em meta_campaign_plans é recusado: só a edge do planejador grava';
  end;
  begin
    insert into public.meta_ai_runs (kind, account_id, trigger)
    values ('gestor', '7f000000-0000-0000-0000-000001160001', 'manual');
    raise exception 'FALHOU: execução de IA criada direto';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto em meta_ai_runs é recusado';
  end;
  begin
    insert into public.meta_alerts (account_id, kind, dedupe_key, mensagem)
    values ('7f000000-0000-0000-0000-000001160001', 'sync_falhou', 'forjado-0116', 'forjado');
    raise exception 'FALHOU: alerta criado direto';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto em meta_alerts é recusado';
  end;

  select count(*) into n from public.meta_actions where campaign_external_id like 'camp-0116-%';
  perform pg_temp.check116(n >= 5, format('marketing lê o histórico de ações (%s)', n));

  perform pg_temp.become116(cor);
  select (select count(*) from public.meta_actions) + (select count(*) from public.meta_ai_runs)
       + (select count(*) from public.meta_campaign_plans) + (select count(*) from public.meta_alerts)
    into n;
  perform pg_temp.check116(n = 0, format('corretor não enxerga ações, execuções, planos nem alertas (viu %s)', n));

  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 7. fila do gestor IA: validade, duplicada, vencida, verba atual, decidir duas vezes =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001160001';
  cor   uuid := '00000000-0000-0000-0000-000001160002';
  liga  uuid := '7f000000-0000-0000-0000-000001160001';
  ia    uuid := '7e000000-0000-0000-0000-000001160006';
  ia2   uuid := '7e000000-0000-0000-0000-000001160007';
  outra uuid := '7e000000-0000-0000-0000-000001160008';
  run   uuid;
  p1    uuid;
  p2    uuid;
  p3    uuid;
  p4    uuid;
  r     jsonb;
  t     timestamptz;
  v     record;
begin
  set local role service_role;
  perform pg_temp.servico116();
  select s.run_id into run from public.meta_ai_run_start('gestor', liga, 'cron', '{}') s;

  p1 := public.meta_action_propose(run, ia, 'pausar', null, 'Custo por resultado 3x a média do canal.');
  p2 := public.meta_action_propose(run, ia, 'pausar', null, 'A mesma de novo.');
  perform pg_temp.check116(p1 is not null and p2 is null, 'proposta duplicada devolve null');

  p3 := public.meta_action_propose(run, ia2, 'verba', 125, 'Escalar 25%.');

  begin
    perform public.meta_action_propose(run, outra, 'pausar', null, 'Fora da conta.');
    raise exception 'FALHOU: IA propôs em campanha de outra conta';
  exception when invalid_parameter_value then
    raise notice '  ok  a IA não propõe em campanha de outra conta (22023)';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_actions where id = p1;
  perform pg_temp.check116(v.status = 'proposta' and v.origem = 'ia' and v.ai_run_id = run
    and v.decided_by is null and v.decided_at is null
    and v.expires_at between clock_timestamp() + interval '23 hours 59 minutes'
                         and clock_timestamp() + interval '24 hours',
    'a proposta nasce sem decisão e com validade de 24 h');

  -- p1 vence. E a sincronização baixa a verba de IA2 para 90 depois da
  -- proposta: 90 → 125 é +38,9%, e a aprovação tem de perceber.
  update public.meta_actions set expires_at = clock_timestamp() - interval '1 minute' where id = p1;
  update public.ad_campaigns set daily_budget = 90 where id = ia2;

  set local role authenticated;
  perform pg_temp.become116(mkt);
  r := public.meta_action_decide(p1, 'aprovar');
  perform pg_temp.check116(r->>'status' = 'expirada', format('decidir proposta vencida devolve expirada (%s)', r));

  perform pg_temp.become116(cor);
  begin
    perform public.meta_action_decide(p3, 'aprovar');
    raise exception 'FALHOU: corretor decidiu a fila';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_action_decide';
  end;

  perform pg_temp.become116(mkt);
  r := public.meta_action_decide(p3, 'aprovar');
  perform pg_temp.check116(r->>'status' = 'precisa_confirmar' and (r->>'variacao')::numeric = 0.3889
    and (r->>'verba_atual')::numeric = 90,
    format('a aprovação recalcula contra a verba ATUAL: 90 → 125 pede confirmação (%s)', r));
  r := public.meta_action_decide(p3, 'aprovar', true);
  perform pg_temp.check116(r->>'status' = 'aprovada', 'com a confirmação, aprovada');
  select decided_at into t from public.meta_actions where id = p3;

  begin
    perform public.meta_action_decide(p3, 'aprovar', true);
    raise exception 'FALHOU: aprovou duas vezes';
  exception when object_not_in_prerequisite_state then
    raise notice '  ok  decidir duas vezes não reexecuta (55000)';
  end;
  begin
    perform public.meta_action_decide(p3, 'recusar');
    raise exception 'FALHOU: recusou depois de aprovada';
  exception when object_not_in_prerequisite_state then
    raise notice '  ok  nem recusa depois de aprovada (55000)';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_actions where id = p1;
  perform pg_temp.check116(v.status = 'expirada' and v.decided_by is null, 'a vencida fica expirada, sem decisão');
  select * into v from public.meta_actions where id = p3;
  perform pg_temp.check116(v.status = 'aprovada' and v.decided_by = mkt and v.decided_at = t
    and v.verba_anterior = 90 and v.variacao = 0.3889 and v.exigiu_aprendizado,
    'a decisão é de quem decidiu, uma vez só, contra a verba de 90');

  -- Vencida a anterior, a mesma campanha recebe proposta nova; e recusar grava quem recusou.
  set local role service_role;
  perform pg_temp.servico116();
  p4 := public.meta_action_propose(run, ia, 'pausar', null, 'De novo, no dia seguinte.');
  reset role;
  perform pg_temp.check116(p4 is not null, 'depois de vencida, a campanha recebe proposta nova');

  set local role authenticated;
  perform pg_temp.become116(mkt);
  r := public.meta_action_decide(p4, 'recusar');
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check116(r->>'status' = 'recusada'
    and (select status from public.meta_actions where id = p4) = 'recusada'
    and (select decided_by from public.meta_actions where id = p4) = mkt,
    'recusar grava a decisão e quem decidiu');
end
$$;

\echo '== 8. o executor: claim duas vezes devolve null; finish grava na campanha =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001160001';
  cbo   uuid := '7e000000-0000-0000-0000-000001160001';
  ia2   uuid := '7e000000-0000-0000-0000-000001160007';
  pausa uuid;
  ativa uuid;
  verba uuid;
  c1    jsonb;
  c2    jsonb;
  v     record;
begin
  select id into pausa from public.meta_actions where campaign_id = cbo and acao = 'pausar' and status = 'aprovada';
  select id into ativa from public.meta_actions where campaign_id = cbo and acao = 'ativar' and status = 'aprovada';
  select id into verba from public.meta_actions where campaign_id = ia2 and acao = 'verba' and status = 'aprovada';

  set local role authenticated;
  perform pg_temp.become116(mkt);
  begin
    perform public.meta_action_claim(pausa);
    raise exception 'FALHOU: usuário logado reivindicou execução';
  exception when insufficient_privilege then
    raise notice '  ok  meta_action_claim não é chamável por authenticated';
  end;
  begin
    perform public.meta_action_finish(pausa, 'executada', '{}'::jsonb, null);
    raise exception 'FALHOU: usuário logado encerrou execução';
  exception when insufficient_privilege then
    raise notice '  ok  meta_action_finish não é chamável por authenticated';
  end;
  reset role;

  set local role service_role;
  perform pg_temp.servico116();
  c1 := public.meta_action_claim(pausa);
  c2 := public.meta_action_claim(pausa);
  perform pg_temp.check116(c1 is not null and c2 is null, 'meta_action_claim duas vezes: a segunda devolve null');
  perform pg_temp.check116(c1->>'act_id' = 'act_1160001' and c1->>'campaign_external_id' = 'camp-0116-cbo'
    and c1->>'acao' = 'pausar' and c1->>'meta_budget_level' = 'campaign',
    format('o claim devolve conta, campanha, ação e nível da verba (%s)', c1));

  perform public.meta_action_finish(pausa, 'executada', '{"meta":{"success":true}}'::jsonb, null);
  perform public.meta_action_finish(pausa, 'executada', '{"meta":{"success":true}}'::jsonb, null);

  c1 := public.meta_action_claim(verba);
  perform pg_temp.check116((c1->>'verba_nova')::numeric = 125 and (c1->>'exigiu_aprendizado')::boolean,
    'o claim leva a verba nova e se a pessoa aceitou o aviso de aprendizado');
  perform public.meta_action_finish(verba, 'parcial',
    '{"depois":{"verba_diaria":113.33},"conjuntos":[{"id":"1","de":6000,"para":8333,"ok":true},{"id":"2","de":3000,"para":4167,"ok":false}]}'::jsonb,
    'Um conjunto recusou a verba nova.');

  begin
    perform public.meta_action_finish(ativa, 'executada', '{}'::jsonb, null);
    raise exception 'FALHOU: encerrou ação que não foi reivindicada';
  exception when object_not_in_prerequisite_state then
    raise notice '  ok  finish sem claim leva 55000';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_actions where id = pausa;
  perform pg_temp.check116(v.status = 'executada' and v.executed_at is not null and v.erro is null
    and v.resultado = '{"meta":{"success":true}}'::jsonb,
    'executada, com o resultado da Meta; repetir o encerramento não mudou nada');
  perform pg_temp.check116((select status from public.ad_campaigns where id = cbo) = 'PAUSED',
    'a pausa aparece na campanha sem esperar a sincronização (passando pelo guard da 0115)');
  select * into v from public.meta_actions where id = verba;
  perform pg_temp.check116(v.status = 'parcial' and v.erro = 'Um conjunto recusou a verba nova.'
    and jsonb_array_length(v.resultado->'conjuntos') = 2,
    'parcial fica registrado conjunto por conjunto, com o erro');
  perform pg_temp.check116((select daily_budget from public.ad_campaigns where id = ia2) = 113.33,
    'parcial grava na campanha o total que a Meta aceitou, não a verba pedida');
  perform pg_temp.check116((select status from public.meta_actions where id = ativa) = 'aprovada',
    'a ativação não reivindicada continua aprovada');
end
$$;

\echo '== 9. ao vivo passou dos 30% sem aviso aceito: nada na Meta, e a proposta volta para a fila =='

do $$
declare
  mkt  uuid := '00000000-0000-0000-0000-000001160001';
  liga uuid := '7f000000-0000-0000-0000-000001160001';
  ia   uuid := '7e000000-0000-0000-0000-000001160006';
  abo  uuid := '7e000000-0000-0000-0000-000001160002';
  run  uuid;
  p    uuid;
  m    uuid;
  r    jsonb;
  v    record;
begin
  set local role service_role;
  perform pg_temp.servico116();
  select s.run_id into run from public.meta_ai_run_start('gestor', liga, 'cron', '{}') s;
  p := public.meta_action_propose(run, ia, 'verba', 120, 'Escalar 20%.');
  reset role;

  set local role authenticated;
  perform pg_temp.become116(mkt);
  r := public.meta_action_decide(p, 'aprovar');
  perform pg_temp.check116(r->>'status' = 'aprovada', 'no banco, 100 → 120 não pede o aviso');
  r := public.meta_action_create(abo, 'verba', 105);
  m := (r->>'action_id')::uuid;
  reset role;

  -- O executor lê a Meta: a verba de verdade é 50, e subir para 120 é +140%.
  set local role service_role;
  perform pg_temp.servico116();
  perform pg_temp.check116(public.meta_action_precisa_aprendizado(50, 120),
    'a mesma função, com a verba lida ao vivo, pede o aviso');
  perform public.meta_action_claim(p);
  perform public.meta_action_finish(p, 'precisa_confirmar', '{"verba_ao_vivo":50,"variacao":1.4}'::jsonb, null);
  perform public.meta_action_claim(m);
  perform public.meta_action_finish(m, 'precisa_confirmar', '{"verba_ao_vivo":60,"variacao":0.75}'::jsonb, null);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_actions where id = p;
  perform pg_temp.check116(v.status = 'proposta' and v.decided_by is null and v.decided_at is null
    and v.erro like '%aprendizado%' and v.resultado->>'verba_ao_vivo' = '50',
    'a proposta da IA volta para a fila, sem decisão, com o motivo');
  select * into v from public.meta_actions where id = m;
  perform pg_temp.check116(v.status = 'falhou' and v.erro like '%aprendizado%',
    'a manual encerra como falhou: a tela manda uma nova, já confirmada');

  set local role authenticated;
  perform pg_temp.become116(mkt);
  r := public.meta_action_decide(p, 'aprovar', true);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check116(r->>'status' = 'aprovada'
    and (select exigiu_aprendizado from public.meta_actions where id = p),
    'aprovada de novo, agora com o aviso aceito: o executor pode subir a verba');
end
$$;

\echo '== 10. execuções de IA: reuso em menos de 10 min; cron uma vez por dia =='

do $$
declare
  mkt  uuid := '00000000-0000-0000-0000-000001160001';
  cor  uuid := '00000000-0000-0000-0000-000001160002';
  dir  uuid := '00000000-0000-0000-0000-000001160003';
  soc  uuid := '00000000-0000-0000-0000-000001160004';
  liga uuid := '7f000000-0000-0000-0000-000001160001';
  desl uuid := '7f000000-0000-0000-0000-000001160002';
  r1   record;
  r2   record;
  r3   record;
  r4   record;
  c1   record;
  c2   record;
  v    record;
begin
  set local role authenticated;
  perform pg_temp.become116(cor);
  begin
    perform * from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
    raise exception 'FALHOU: corretor rodou análise de IA';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_ai_run_start';
  end;
  perform pg_temp.become116(dir);
  begin
    perform * from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
    raise exception 'FALHOU: diretor rodou análise de IA sem o switch';
  exception when insufficient_privilege then
    raise notice '  ok  diretor leva 42501 em meta_ai_run_start';
  end;

  perform pg_temp.become116(mkt);
  begin
    perform * from public.meta_ai_run_start('gestor', liga, 'cron', '{}');
    raise exception 'FALHOU: usuário logado se passou pelo cron';
  exception when insufficient_privilege then
    raise notice '  ok  execução agendada é só da service role';
  end;
  begin
    perform * from public.meta_ai_run_start('nota_anuncios', desl, 'manual', '{"dias":7}');
    raise exception 'FALHOU: análise em conta desligada';
  exception when invalid_parameter_value then
    raise notice '  ok  conta desligada não roda IA (22023)';
  end;

  select * into r1 from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
  select * into r2 from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
  perform pg_temp.check116(not r1.reused and r2.reused and r2.run_id = r1.run_id,
    'repetido enquanto a primeira roda: reused = true, mesma execução');
  select * into r3 from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":30}');
  perform pg_temp.check116(not r3.reused and r3.run_id <> r1.run_id, 'outro período: execução nova');

  begin
    perform public.meta_ai_run_finish(r1.run_id, 'ok', '{}'::jsonb, null, 'gpt-4o-mini', 10, 10);
    raise exception 'FALHOU: usuário logado encerrou análise';
  exception when insufficient_privilege then
    raise notice '  ok  meta_ai_run_finish não é chamável por authenticated';
  end;
  reset role;

  set local role service_role;
  perform pg_temp.servico116();
  begin
    perform public.meta_ai_run_finish(r1.run_id, 'ok', null, null, 'gpt-4o-mini', 10, 10);
    raise exception 'FALHOU: análise ok sem resultado';
  exception when invalid_parameter_value then
    raise notice '  ok  análise ok sem resultado é recusada (22023)';
  end;
  perform public.meta_ai_run_finish(r1.run_id, 'ok', '{"anuncios":[]}'::jsonb, null, 'gpt-4o-mini', 1200, 300);
  reset role;

  set local role authenticated;
  perform pg_temp.become116(soc);
  select * into r4 from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
  perform pg_temp.check116(r4.reused and r4.run_id = r1.run_id,
    'repetido em menos de 10 min depois de ok: reused = true, sem nova chamada de IA (o sócio passa)');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  update public.meta_ai_runs
     set started_at = started_at - interval '11 minutes', finished_at = finished_at - interval '11 minutes'
   where id = r1.run_id;

  set local role authenticated;
  perform pg_temp.become116(mkt);
  select * into r4 from public.meta_ai_run_start('nota_anuncios', liga, 'manual', '{"dias":7}');
  perform pg_temp.check116(not r4.reused and r4.run_id <> r1.run_id, 'passados 10 min, análise nova');
  reset role;

  set local role service_role;
  perform pg_temp.servico116();
  select * into c1 from public.meta_ai_run_start('gestor', liga, 'cron', '{}');
  select * into c2 from public.meta_ai_run_start('gestor', liga, 'cron', '{}');
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check116(c1.reused and c2.reused and c2.run_id = c1.run_id
    and (select count(*) from public.meta_ai_runs
          where account_id = liga and kind = 'gestor' and trigger = 'cron') = 1,
    'cron: uma execução por conta, tipo e dia');

  select * into v from public.meta_ai_runs where id = r1.run_id;
  perform pg_temp.check116(v.status = 'ok' and v.model = 'gpt-4o-mini' and v.tokens_in = 1200
    and v.tokens_out = 300 and v.requested_by = mkt and v.trigger = 'manual',
    'a execução guarda modelo, tokens e quem pediu');
end
$$;

\echo '== 11. grants: nada para anon; executor, proposta e encerramento só service =='

do $$
begin
  perform pg_temp.check116(
    not has_function_privilege('anon', 'public.meta_action_create(uuid,text,numeric,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.meta_action_decide(uuid,text,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.meta_ai_run_start(text,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.meta_action_precisa_aprendizado(numeric,numeric)', 'execute'),
    'nada da 0116 é chamável sem sessão');
  perform pg_temp.check116(
    has_function_privilege('authenticated', 'public.meta_action_create(uuid,text,numeric,boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.meta_action_decide(uuid,text,boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.meta_ai_run_start(text,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_action_claim(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_action_finish(uuid,text,jsonb,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_action_propose(uuid,uuid,text,numeric,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_ai_run_finish(uuid,text,jsonb,text,text,int,int)', 'execute'),
    'o usuário logado cria, decide e pede análise; executar, propor e encerrar é da service role');
  perform pg_temp.check116(
    has_function_privilege('service_role', 'public.meta_action_claim(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.meta_action_finish(uuid,text,jsonb,text)', 'execute')
    and has_function_privilege('service_role', 'public.meta_action_propose(uuid,uuid,text,numeric,text)', 'execute')
    and has_function_privilege('service_role', 'public.meta_ai_run_finish(uuid,text,jsonb,text,text,int,int)', 'execute')
    and has_function_privilege('service_role', 'public.meta_action_precisa_aprendizado(numeric,numeric)', 'execute')
    and has_function_privilege('authenticated', 'public.meta_action_precisa_aprendizado(numeric,numeric)', 'execute'),
    'o executor chama a regra dos 30% com a verba ao vivo');
  perform pg_temp.check116(
    not has_function_privilege('authenticated', 'public.meta_action_validar(uuid,text,numeric)', 'execute')
    and not has_function_privilege('service_role', 'public.meta_action_validar(uuid,text,numeric)', 'execute'),
    'as travas comuns de criar, aprovar e propor são internas');
  perform pg_temp.check116(
    not has_table_privilege('authenticated', 'public.meta_actions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.meta_actions', 'DELETE')
    and not has_table_privilege('anon', 'public.meta_actions', 'SELECT')
    and not exists (select 1 from pg_policies
                     where schemaname = 'public'
                       and tablename in ('meta_actions', 'meta_ai_runs', 'meta_campaign_plans', 'meta_alerts')
                       and cmd <> 'SELECT'),
    'as quatro tabelas só têm policy de leitura; update e delete revogados');
end
$$;

\echo 'OK 0116 meta ações e IA'
