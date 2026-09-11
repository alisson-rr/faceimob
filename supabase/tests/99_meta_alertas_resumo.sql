-- =============================================================================
-- 99 · Estado da conta, alertas da Meta e resumo diário (migration 0117)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`. Roda entre 99_meta_acoes_ia.sql e
-- 99_meta_livro_sincronizacao.sql (ordem alfabética); este último confere somas
-- de meta_metricas de 01 a 11/09, então o último bloco daqui apaga tudo o que
-- foi criado (campanhas, insights, leads e a conta).
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. meta_classifica_conta: status, bloqueio, limite de gastos e pré-pago,
--      nunca balance (o defeito do sistema antigo).
--   2. Limites: corretor e diretor levam 42501; valor fora da faixa, 22023;
--      escrita direta na tabela é recusada.
--   3. Estado: duas avaliações com o mesmo estado geram UM aviso; a volta a
--      rodar gera "voltou a rodar"; a sócia que também é marketing recebe uma
--      vez; corretor e diretor não recebem.
--   4. Gasto sem lead não abre se a Meta viu conversa nem se o CRM tem lead;
--      abre com as duas fontes zeradas; fecha quando a condição some. Custo por
--      resultado com o nome "segundo a Meta". O sócio recebe; o corretor não.
--   5. Sincronização que falhou: nada de aviso de saldo, um só sync_falhou,
--      números congelados; o modo só-estado (cron leve) recalcula o estado.
--   6. Verba do mês: aviso no percentual, esgotada em 100%, e "dados desde
--      dd/mm" quando o mês não está todo sincronizado.
--   7. Resumo: sem conta ligada não enfileira; duas vezes no dia insere uma;
--      vai para sócio e diretor; começa pelo aviso de falha; cabe em 1.000.
--   8. Acesso com `set local role authenticated`: corretor não vê alertas;
--      ninguém logado chama a avaliação, o resumo nem o aviso; nenhuma função
--      recebe telefone.
--   9. O cron do resumo.
--
-- UUIDs na faixa `…-000001170001+`.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check117(cond boolean, label text)
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
create or replace function pg_temp.become117(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

/** A edge function (ou o cron) com a service role. */
create or replace function pg_temp.servico117()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
end;
$$;

/** Quantos avisos deste tipo a pessoa recebeu (todas as linhas: sino e WhatsApp). */
create or replace function pg_temp.avisos117(p_profile uuid, p_kind text)
returns int
language sql
as $$
  select count(*)::int from public.notifications where profile_id = p_profile and kind = p_kind;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres)
--   Mara = marketing · Caio = corretor · Dora = diretora · Sara = sócia E
--   marketing (todo perfil nasce corretor, 0002)
--   Conta 0117 e quatro campanhas: conversa (a Meta viu conversa), crm (o CRM
--   tem lead), zerada (nada nas duas fontes) e cara (custo por resultado alto)
-- -----------------------------------------------------------------------------
do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  cor   uuid := '00000000-0000-0000-0000-000001170002';
  dir   uuid := '00000000-0000-0000-0000-000001170003';
  soc   uuid := '00000000-0000-0000-0000-000001170004';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (mkt, 'mara@t117.test', '{"full_name":"Mara Marketing 117"}'),
    (cor, 'caio@t117.test', '{"full_name":"Caio Corretor 117"}'),
    (dir, 'dora@t117.test', '{"full_name":"Dora Diretora 117"}'),
    (soc, 'sara@t117.test', '{"full_name":"Sara Sócia 117"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (mkt, 'marketing'), (dir, 'director'), (soc, 'partner'), (soc, 'marketing')
  on conflict do nothing;

  insert into public.meta_ad_accounts (id, act_id, name, timezone_name, enabled)
  values (conta, 'act_1170001', 'Conta 0117', 'America/Sao_Paulo', true);

  insert into public.ad_campaigns
    (id, external_id, platform, name, status, daily_budget, meta_account_id, meta_channel, meta_budget_level)
  values
    ('7e000000-0000-0000-0000-000001170001', 'camp-0117-conversa', 'meta', 'Conversa 0117', 'ACTIVE', 50, conta, 'formulario',   'campaign'),
    ('7e000000-0000-0000-0000-000001170002', 'camp-0117-crm',      'meta', 'CRM 0117',      'ACTIVE', 50, conta, 'landing_page', 'campaign'),
    ('7e000000-0000-0000-0000-000001170003', 'camp-0117-zerada',   'meta', 'Zerada 0117',   'ACTIVE', 50, conta, 'landing_page', 'campaign'),
    ('7e000000-0000-0000-0000-000001170004', 'camp-0117-cara',     'meta', 'Cara 0117',     'ACTIVE', 50, conta, 'formulario',   'campaign');
end
$$;

\echo '== 1. meta_classifica_conta: status, bloqueio, limite de gastos e pré-pago; nunca balance =='

do $$
begin
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, false, null, 0, 98000, 100) = 'rodando',
    'pós-paga ativa, sem limite de gastos e com muito gasto (o "balance" alto de antes) = rodando');
  perform pg_temp.check117(public.meta_classifica_conta(3, 0, false, null, 0, 0, 100) = 'sem_saldo',
    'status 3 (pagamento pendente) = sem_saldo');
  perform pg_temp.check117(public.meta_classifica_conta(9, 0, false, null, 0, 0, 100) = 'saldo_baixo',
    'status 9 (período de tolerância) = saldo_baixo');
  perform pg_temp.check117(public.meta_classifica_conta(1, 1, false, null, 0, 0, 100) = 'bloqueada',
    'disable_reason 1 (política de anúncios) = bloqueada');
  perform pg_temp.check117(public.meta_classifica_conta(1, 3, false, null, 0, 0, 100) = 'sem_saldo',
    'disable_reason 3 (risco de pagamento) = sem_saldo, não bloqueio');
  perform pg_temp.check117(public.meta_classifica_conta(2, 3, false, null, 0, 0, 100) = 'bloqueada',
    'status 2 (desativada) = bloqueada');
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, false, null, 1000, 1000, 100) = 'sem_saldo',
    'limite de gastos atingido = sem_saldo');
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, false, null, 1000, 950, 100) = 'saldo_baixo',
    'limite de gastos com R$ 50 restantes e limite de alerta R$ 100 = saldo_baixo');
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, true, 0, 0, 0, 100) = 'sem_saldo'
    and public.meta_classifica_conta(1, 0, true, 80, 0, 0, 100) = 'saldo_baixo'
    and public.meta_classifica_conta(1, 0, true, 500, 0, 0, 100) = 'rodando',
    'pré-paga: zerada = sem_saldo; abaixo do limite = saldo_baixo; acima = rodando');
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, true, null, 0, 0, 100) = 'rodando',
    'pré-paga sem saldo lido (o parser falhou) decide só pelo status');
  perform pg_temp.check117(public.meta_classifica_conta(1, 0, false, null, 1000, 950, null) = 'rodando',
    'sem limite de alerta, restante pequeno não vira saldo_baixo por valor');
  perform pg_temp.check117(public.meta_classifica_conta(null, null, null, null, null, null, 100) = 'desconhecido',
    'sem leitura da Meta = desconhecido');
  perform pg_temp.check117(
    (select p.provolatile = 'i' from pg_proc p
      where p.oid = 'public.meta_classifica_conta(int,int,boolean,numeric,numeric,numeric,numeric)'::regprocedure),
    'é immutable: uma regra, sem estado');
end
$$;

\echo '== 2. limites: corretor e diretor levam 42501; fora da faixa, 22023; tabela só pela RPC =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  cor   uuid := '00000000-0000-0000-0000-000001170002';
  dir   uuid := '00000000-0000-0000-0000-000001170003';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  v     record;
begin
  set local role authenticated;

  perform pg_temp.become117(cor);
  begin
    perform public.meta_account_thresholds_set(conta, 100, 50, 3, null, 85, 100);
    raise exception 'FALHOU: corretor mudou limite de alerta';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_account_thresholds_set';
  end;

  perform pg_temp.become117(dir);
  begin
    perform public.meta_account_thresholds_set(conta, 100, 50, 3, null, 85, 100);
    raise exception 'FALHOU: diretor mudou limite sem o switch';
  exception when insufficient_privilege then
    raise notice '  ok  diretor leva 42501 (lê os números, não mexe sem marketing.meta_manage)';
  end;

  perform pg_temp.become117(mkt);
  begin
    perform public.meta_account_thresholds_set(conta, 100, 50, 0, null, 85, 100);
    raise exception 'FALHOU: janela de 0 dias aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  janela do gasto sem lead fora de 1 a 30 leva 22023';
  end;
  begin
    perform public.meta_account_thresholds_set(conta, 100, 50, 3, null, 40, 100);
    raise exception 'FALHOU: aviso de verba em 40%% aceito';
  exception when invalid_parameter_value then
    raise notice '  ok  aviso de verba fora de 50 a 100%% leva 22023';
  end;
  begin
    perform public.meta_account_thresholds_set(conta, -1, 50, 3, null, 85, 100);
    raise exception 'FALHOU: limite negativo aceito';
  exception when invalid_parameter_value then
    raise notice '  ok  limite negativo leva 22023';
  end;
  begin
    perform public.meta_account_thresholds_set(gen_random_uuid(), 100, 50, 3, null, 85, 100);
    raise exception 'FALHOU: conta inexistente aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  conta inexistente leva 22023';
  end;
  begin
    update public.meta_ad_accounts set cpl_limite = 1 where id = conta;
    raise exception 'FALHOU: marketing mudou limite direto na tabela';
  exception when insufficient_privilege then
    raise notice '  ok  update direto em meta_ad_accounts é recusado: só a RPC grava';
  end;

  perform public.meta_account_thresholds_set(conta, 100, 50, 3, null, 85, 100);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_ad_accounts where id = conta;
  perform pg_temp.check117(v.cpl_limite = 100 and v.gasto_sem_lead_limite = 50 and v.gasto_sem_lead_dias = 3
    and v.verba_mensal is null and v.verba_aviso_pct = 85 and v.saldo_baixo_limite = 100,
    'marketing grava os limites; verba vazia fica nula (alerta desligado)');
  perform pg_temp.check117(v.balance_state = 'desconhecido',
    'sem leitura da Meta, a reavaliação do salvar não inventa estado');
end
$$;

\echo '== 3. estado: o mesmo estado duas vezes avisa UMA; a volta avisa "voltou a rodar" =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  cor   uuid := '00000000-0000-0000-0000-000001170002';
  dir   uuid := '00000000-0000-0000-0000-000001170003';
  soc   uuid := '00000000-0000-0000-0000-000001170004';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  r1    jsonb;
  r2    jsonb;
  r3    jsonb;
  v     record;
begin
  -- A sincronização deu certo e trouxe "pagamento pendente".
  insert into public.meta_sync_runs (account_id, trigger, status, window_start, window_end, started_at, finished_at)
  values (conta, 'cron', 'ok', hoje - 40, hoje,
          clock_timestamp() - interval '3 hours', clock_timestamp() - interval '3 hours');
  update public.meta_ad_accounts
     set account_status = 3, disable_reason = 0, is_prepay = false, spend_cap = 0, amount_spent = 0,
         account_checked_at = clock_timestamp(), last_sync_ok_at = clock_timestamp()
   where id = conta;

  set local role service_role;
  perform pg_temp.servico117();
  r1 := public.meta_avaliar_alertas(conta);
  r2 := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117(r1->>'estado_conta' = 'sem_saldo' and r2->>'estado_conta' = 'sem_saldo'
    and r1 ? 'abertos' and r1 ? 'novos' and r1 ? 'resolvidos',
    format('a avaliação devolve {estado_conta, abertos, novos, resolvidos} (%s)', r1));
  select * into v from public.meta_ad_accounts where id = conta;
  perform pg_temp.check117(v.balance_state = 'sem_saldo' and v.balance_state_changed_at is not null,
    'balance_state e balance_state_changed_at gravados');
  perform pg_temp.check117(pg_temp.avisos117(soc, 'meta_conta_estado') = 2,
    'duas avaliações com o mesmo estado: UM aviso (sino + WhatsApp), mesmo a sócia sendo também marketing');
  perform pg_temp.check117(pg_temp.avisos117(mkt, 'meta_conta_estado') = 2, 'o marketing recebe');
  perform pg_temp.check117(pg_temp.avisos117(cor, 'meta_conta_estado') = 0
    and pg_temp.avisos117(dir, 'meta_conta_estado') = 0,
    'corretor e diretor não recebem aviso de conta');
  perform pg_temp.check117(exists (
    select 1 from public.notifications
     where profile_id = soc and kind = 'meta_conta_estado' and channel = 'whatsapp'
       and title = 'Conta de anúncios sem saldo: Conta 0117'
       and body like '%pagamento pendente%' and body like '%Verificado em%' and link = '/marketing'),
    'o aviso diz o que a Meta disse, quando, e leva a /marketing');

  update public.meta_ad_accounts set account_status = 1, account_checked_at = clock_timestamp() where id = conta;
  set local role service_role;
  perform pg_temp.servico117();
  r3 := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117(r3->>'estado_conta' = 'rodando'
    and (select count(*) from public.notifications
          where profile_id = soc and kind = 'meta_conta_estado'
            and title = 'A conta de anúncios Conta 0117 voltou a rodar') = 2,
    'a volta de sem_saldo para rodando avisa "voltou a rodar"');
end
$$;

\echo '== 4. gasto sem lead e custo por resultado: duas fontes, dedupe, fecha sozinho =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  cor   uuid := '00000000-0000-0000-0000-000001170002';
  dir   uuid := '00000000-0000-0000-0000-000001170003';
  soc   uuid := '00000000-0000-0000-0000-000001170004';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  a     uuid := '7e000000-0000-0000-0000-000001170001';
  b     uuid := '7e000000-0000-0000-0000-000001170002';
  cc    uuid := '7e000000-0000-0000-0000-000001170003';
  d     uuid := '7e000000-0000-0000-0000-000001170004';
  hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  r     jsonb;
  v     record;
begin
  insert into public.meta_campaign_insights_daily
    (campaign_id, day, spend, leads_form, conversations, lp_leads, resultados)
  values
    (a,  hoje,     60,  0, 2, 0, 0),  -- gastou, mas a Meta viu conversa
    (b,  hoje,     60,  0, 0, 0, 0),  -- gastou, zero na Meta, mas o CRM tem lead
    (cc, hoje,     30,  0, 0, 0, 0),
    (cc, hoje - 1, 30,  0, 0, 0, 0),  -- 60 em dois dias, zero nas duas fontes
    (d,  hoje - 1, 300, 2, 0, 0, 2);  -- custo por resultado 150 com limite 100
  insert into public.leads (full_name, phone, campaign_id)
  values ('Lead CRM 0117', '11917170001', 'camp-0117-crm');

  set local role service_role;
  perform pg_temp.servico117();
  r := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117((r->>'novos')::int = 2, format('dois alertas novos (%s)', r));
  perform pg_temp.check117(not exists (select 1 from public.meta_alerts where campaign_id = a and resolved_at is null),
    'gasto sem lead NÃO abre quando a Meta viu conversa');
  perform pg_temp.check117(not exists (select 1 from public.meta_alerts where campaign_id = b and resolved_at is null),
    'gasto sem lead NÃO abre quando o CRM tem lead da campanha');
  select * into v from public.meta_alerts where campaign_id = cc and resolved_at is null;
  perform pg_temp.check117(v.kind = 'gasto_sem_lead' and v.valor = 60 and v.limite = 50
    and v.dedupe_key = 'gasto_sem_lead:' || cc and v.notified_at is not null
    and v.mensagem like 'Gasto sem lead: R$ 60,00 em Zerada 0117 nos últimos 3 dias%',
    format('abre com Meta e CRM zerados, com o valor e o limite (%s)', v.mensagem));
  select * into v from public.meta_alerts where campaign_id = d and resolved_at is null;
  perform pg_temp.check117(v.kind = 'cpl_alto' and v.valor = 150
    and v.mensagem like 'Custo por resultado (segundo a Meta) acima do limite: R$ 150,00 em Cara 0117%',
    format('o alerta de custo leva o nome "segundo a Meta" (%s)', v.mensagem));

  perform pg_temp.check117(pg_temp.avisos117(soc, 'meta_alerta') = 2 and pg_temp.avisos117(mkt, 'meta_alerta') = 2,
    'o sócio (e o marketing) recebe UM aviso com os dois alertas, no sino e no WhatsApp');
  perform pg_temp.check117(pg_temp.avisos117(cor, 'meta_alerta') = 0 and pg_temp.avisos117(dir, 'meta_alerta') = 0,
    'o corretor não recebe; o diretor também não (alerta é de quem opera a campanha)');
  perform pg_temp.check117(exists (
    select 1 from public.notifications
     where profile_id = soc and kind = 'meta_alerta' and channel = 'whatsapp'
       and title = '2 alertas novos da Meta na conta Conta 0117'
       and body like '%Gasto sem lead%' and body like '%Custo por resultado (segundo a Meta) acima do limite%'),
    'o WhatsApp junta os alertas que abriram juntos');

  set local role service_role;
  perform pg_temp.servico117();
  r := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117((r->>'novos')::int = 0 and pg_temp.avisos117(soc, 'meta_alerta') = 2
    and (select count(*) from public.meta_alerts where account_id = conta and resolved_at is null) = 2,
    'avaliar de novo não repete o aviso nem duplica o alerta');

  -- A condição some: chega lead da campanha zerada.
  insert into public.leads (full_name, phone, campaign_id)
  values ('Lead Zerada 0117', '11917170002', 'camp-0117-zerada');
  set local role service_role;
  perform pg_temp.servico117();
  r := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117((r->>'resolvidos')::int = 1
    and exists (select 1 from public.meta_alerts where campaign_id = cc and resolved_at is not null)
    and not exists (select 1 from public.meta_alerts where campaign_id = cc and resolved_at is null),
    'gasto sem lead fecha sozinho quando o lead chega');

  -- Limite novo vale já: 150 fica abaixo de 200 e o alerta de custo fecha.
  set local role authenticated;
  perform pg_temp.become117(mkt);
  perform public.meta_account_thresholds_set(conta, 200, 50, 3, null, 85, 100);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117(not exists (select 1 from public.meta_alerts where campaign_id = d and resolved_at is null)
    and pg_temp.avisos117(soc, 'meta_alerta') = 2,
    'subir o limite pela tela fecha o alerta de custo na hora, sem aviso');
end
$$;

\echo '== 5. sincronização que falhou: sem aviso de saldo, um sync_falhou, números congelados =='

do $$
declare
  soc   uuid := '00000000-0000-0000-0000-000001170004';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  cc    uuid := '7e000000-0000-0000-0000-000001170003';
  n_est int;
  r1    jsonb;
  r2    jsonb;
  r     jsonb;
  v     record;
begin
  -- A sincronização seguinte falhou. Os campos da conta dizem "pagamento
  -- pendente" e o lead da zerada sumiu: com dado velho, nada disso vale.
  insert into public.meta_sync_runs (account_id, trigger, status, error, started_at, finished_at)
  values (conta, 'cron', 'falhou', 'Token de acesso expirado',
          clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 hour');
  update public.meta_ad_accounts
     set account_status = 3, last_sync_error = 'Token de acesso expirado'
   where id = conta;
  delete from public.leads where campaign_id = 'camp-0117-zerada';
  n_est := pg_temp.avisos117(soc, 'meta_conta_estado');

  set local role service_role;
  perform pg_temp.servico117();
  r1 := public.meta_avaliar_alertas(conta);
  r2 := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117((select balance_state from public.meta_ad_accounts where id = conta) = 'rodando'
    and pg_temp.avisos117(soc, 'meta_conta_estado') = n_est,
    'falha de sincronização não recalcula o estado nem gera aviso de saldo');
  select * into v from public.meta_alerts where account_id = conta and kind = 'sync_falhou' and resolved_at is null;
  perform pg_temp.check117(v.mensagem like 'A sincronização com a Meta falhou na conta Conta 0117 em %: Token de acesso expirado.%'
    and v.mensagem like '%última sincronização boa%',
    format('sync_falhou diz a falha, a data e a última sincronização boa (%s)', v.mensagem));
  perform pg_temp.check117((r1->>'novos')::int = 1 and (r2->>'novos')::int = 0
    and (select count(*) from public.meta_alerts where account_id = conta and kind = 'sync_falhou') = 1
    and pg_temp.avisos117(soc, 'meta_sync_falhou') = 2,
    'duas falhas seguidas: um alerta e um aviso só');
  perform pg_temp.check117(not exists (select 1 from public.meta_alerts where campaign_id = cc and resolved_at is null),
    'com a sincronização falhada, o alerta de número não reabre por falta de dado');

  -- O cron leve leu a conta na Meta com sucesso: o modo só-estado vale.
  set local role service_role;
  perform pg_temp.servico117();
  r := public.meta_avaliar_alertas(conta, true);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117(r->>'estado_conta' = 'sem_saldo'
    and pg_temp.avisos117(soc, 'meta_conta_estado') = n_est + 2
    and (r->>'novos')::int = 0,
    'modo só-estado recalcula e avisa a transição');
  perform pg_temp.check117(
    exists (select 1 from public.meta_alerts where account_id = conta and kind = 'sync_falhou' and resolved_at is null)
    and not exists (select 1 from public.meta_alerts where campaign_id = cc and resolved_at is null),
    'modo só-estado não abre nem fecha alerta');

  -- Sincronização boa de novo.
  insert into public.meta_sync_runs (account_id, trigger, status, started_at, finished_at)
  values (conta, 'cron', 'ok', clock_timestamp(), clock_timestamp());
  update public.meta_ad_accounts
     set account_status = 1, last_sync_error = null, last_sync_ok_at = clock_timestamp(),
         account_checked_at = clock_timestamp()
   where id = conta;
  set local role service_role;
  perform pg_temp.servico117();
  r := public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117(
    not exists (select 1 from public.meta_alerts where account_id = conta and kind = 'sync_falhou' and resolved_at is null)
    and r->>'estado_conta' = 'rodando',
    'a sincronização boa fecha o sync_falhou e o estado volta a ser lido');
  perform pg_temp.check117(exists (select 1 from public.meta_alerts where campaign_id = cc and resolved_at is null),
    'com número novo, a zerada (sem o lead) volta a disparar');
end
$$;

\echo '== 6. verba do mês: aviso no percentual, esgotada em 100%, e "dados desde" com mês parcial =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  soc   uuid := '00000000-0000-0000-0000-000001170004';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  mes   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  total numeric;
  msg   text;
begin
  select sum(i.spend) into total
    from public.meta_campaign_insights_daily i
    join public.ad_campaigns c on c.id = i.campaign_id
   where c.meta_account_id = conta and i.day between mes and hoje;

  set local role authenticated;
  perform pg_temp.become117(mkt);
  perform public.meta_account_thresholds_set(conta, 200, 50, 3, round(total / 0.9, 2), 85, 100);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select mensagem into msg from public.meta_alerts
   where account_id = conta and kind = 'verba_mes_aviso' and resolved_at is null;
  perform pg_temp.check117(msg like 'Verba do mês perto do fim na conta Conta 0117: '
      || public.meta_brl(total) || ' gastos no mês segundo a Meta, '
      || floor(total * 100 / round(total / 0.9, 2))::int || '% da verba de ' || public.meta_brl(round(total / 0.9, 2)) || '.'
    and msg not like '%dados desde%'
    and not exists (select 1 from public.meta_alerts
                     where account_id = conta and kind = 'verba_mes_esgotada' and resolved_at is null),
    format('90%% da verba com o mês todo sincronizado: só o aviso (%s)', msg));

  -- A conta só está sincronizada desde hoje.
  update public.meta_sync_runs set window_start = hoje where account_id = conta and status = 'ok';
  set local role service_role;
  perform pg_temp.servico117();
  perform public.meta_avaliar_alertas(conta);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select mensagem into msg from public.meta_alerts
   where account_id = conta and kind = 'verba_mes_aviso' and resolved_at is null;
  -- No dia 1 o mês começa hoje e está completo: o texto certo é o do total.
  perform pg_temp.check117(
    (hoje > mes) = (msg like '%dados desde ' || to_char(hoje, 'DD/MM') || ' (o mês não está todo sincronizado)%')
    and (hoje > mes) = (msg not like '%gastos no mês%'),
    format('mês sincronizado só em parte: "dados desde dd/mm", sem chamar a soma de total do mês (%s)', msg));

  set local role authenticated;
  perform pg_temp.become117(mkt);
  perform public.meta_account_thresholds_set(conta, 200, 50, 3, total, 85, 100);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117(
    exists (select 1 from public.meta_alerts where account_id = conta and kind = 'verba_mes_esgotada' and resolved_at is null)
    and exists (select 1 from public.meta_alerts where account_id = conta and kind = 'verba_mes_aviso' and resolved_at is null)
    and exists (select 1 from public.notifications
                 where profile_id = soc and kind = 'meta_alerta' and title = 'Verba do mês esgotada: Conta 0117'),
    'em 100% abre também "verba do mês esgotada", com aviso');

  set local role authenticated;
  perform pg_temp.become117(mkt);
  perform public.meta_account_thresholds_set(conta, 200, 50, 3, null, 85, 100);
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check117(not exists (
    select 1 from public.meta_alerts
     where account_id = conta and kind in ('verba_mes_aviso', 'verba_mes_esgotada') and resolved_at is null),
    'verba desligada fecha os dois');
end
$$;

\echo '== 7. resumo diário: uma vez por dia, sócio e diretor, começa pela falha =='

do $$
declare
  mkt     uuid := '00000000-0000-0000-0000-000001170001';
  cor     uuid := '00000000-0000-0000-0000-000001170002';
  dir     uuid := '00000000-0000-0000-0000-000001170003';
  soc     uuid := '00000000-0000-0000-0000-000001170004';
  conta   uuid := '7f000000-0000-0000-0000-000001170001';
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  ontem   date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  ligadas uuid[];
  n0      int;
  n1      int;
  n2      int;
  v       record;
begin
  -- Sem conta ligada, não há o que resumir.
  select array_agg(id) into ligadas from public.meta_ad_accounts where enabled;
  update public.meta_ad_accounts set enabled = false where id = any (ligadas);
  set local role service_role;
  perform pg_temp.servico117();
  n0 := public.meta_enfileirar_resumo_diario();
  reset role;
  perform set_config('request.jwt.claims', '', false);
  update public.meta_ad_accounts set enabled = true where id = any (ligadas);
  perform pg_temp.check117(n0 = 0 and pg_temp.avisos117(soc, 'meta_resumo_diario') = 0,
    'sem conta ligada, o resumo não enfileira nada');

  -- Um lead do CRM ontem na campanha cara; a última sincronização boa foi ontem.
  insert into public.leads (full_name, phone, campaign_id, created_at)
  values ('Lead Ontem 0117', '11917170003', 'camp-0117-cara', (ontem + time '15:00') at time zone 'America/Sao_Paulo');
  update public.meta_ad_accounts
     set last_sync_ok_at = (ontem + time '06:05') at time zone 'America/Sao_Paulo'
   where id = conta;

  set local role service_role;
  perform pg_temp.servico117();
  n1 := public.meta_enfileirar_resumo_diario();
  n2 := public.meta_enfileirar_resumo_diario();
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117(n1 >= 2 and n2 = 0,
    format('duas vezes no mesmo dia: insere uma (%s e depois %s)', n1, n2));
  perform pg_temp.check117(pg_temp.avisos117(soc, 'meta_resumo_diario') = 1
    and pg_temp.avisos117(dir, 'meta_resumo_diario') = 1,
    'vai para a sócia e para o diretor, uma linha por pessoa');
  perform pg_temp.check117(pg_temp.avisos117(cor, 'meta_resumo_diario') = 0
    and pg_temp.avisos117(mkt, 'meta_resumo_diario') = 0,
    'corretor e marketing não recebem o resumo');

  select title, body, channel, link into v
    from public.notifications where profile_id = soc and kind = 'meta_resumo_diario';
  perform pg_temp.check117(v.channel = 'whatsapp' and v.link = '/marketing'
    and v.title = 'Resumo da Meta de ontem (' || to_char(ontem, 'DD/MM') || ')',
    'só WhatsApp, com o dia no título');
  perform pg_temp.check117(v.body like 'A sincronização de hoje falhou; números até ' || to_char(ontem, 'DD/MM') || '.%',
    format('com a última sincronização boa de ontem, o texto começa pelo aviso (%s)', left(v.body, 80)));
  perform pg_temp.check117(v.body like '%Gasto: R$ 330,00.%'
    and v.body like '%Leads no CRM: 1. Resultados segundo a Meta: 2.%'
    and v.body like '%CPL do CRM: R$ 330,00.%',
    'gasto de ontem, leads do CRM, resultados segundo a Meta e CPL do CRM');
  perform pg_temp.check117(v.body like '%Melhor custo por resultado (campanhas com gasto a partir de R$ 20): Cara 0117, R$ 150,00.%'
    and v.body not like '%Pior:%',
    'melhor campanha entre as de gasto a partir de R$ 20 (a zerada, sem resultado, fica fora)');
  perform pg_temp.check117(v.body like '%Alertas abertos: 1. Gasto sem lead (Zerada 0117).%',
    'alertas abertos, com quantidade e título');
  perform pg_temp.check117(length(v.title) + 2 + length(v.body) <= 1000,
    'título e corpo cabem em 1.000 caracteres');
end
$$;

\echo '== 8. acesso: RLS com usuário logado, grants e nenhum telefone vindo de parâmetro =='

do $$
declare
  mkt   uuid := '00000000-0000-0000-0000-000001170001';
  cor   uuid := '00000000-0000-0000-0000-000001170002';
  conta uuid := '7f000000-0000-0000-0000-000001170001';
  n     int;
begin
  set local role authenticated;

  perform pg_temp.become117(cor);
  select count(*) into n from public.meta_alerts;
  perform pg_temp.check117(n = 0, format('corretor não enxerga alerta (viu %s)', n));
  begin
    perform public.meta_avaliar_alertas(conta);
    raise exception 'FALHOU: corretor chamou a avaliação';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_avaliar_alertas';
  end;

  perform pg_temp.become117(mkt);
  select count(*) into n from public.meta_alerts where account_id = conta;
  perform pg_temp.check117(n >= 1, format('marketing lê os alertas da conta (%s)', n));
  begin
    perform public.meta_avaliar_alertas(conta);
    raise exception 'FALHOU: usuário logado chamou a avaliação';
  exception when insufficient_privilege then
    raise notice '  ok  nem o marketing chama a avaliação direto: é da sincronização (service role)';
  end;
  begin
    perform public.meta_enfileirar_resumo_diario();
    raise exception 'FALHOU: usuário logado enfileirou o resumo';
  exception when insufficient_privilege then
    raise notice '  ok  usuário logado leva 42501 em meta_enfileirar_resumo_diario';
  end;
  begin
    perform public.meta_notificar('meta_alerta', 'forjado', 'forjado');
    raise exception 'FALHOU: usuário logado mandou aviso';
  exception when insufficient_privilege then
    raise notice '  ok  meta_notificar é interna';
  end;
  begin
    update public.meta_alerts set resolved_at = now() where account_id = conta;
    raise exception 'FALHOU: marketing fechou alerta direto';
  exception when insufficient_privilege then
    raise notice '  ok  update direto em meta_alerts é recusado';
  end;

  -- O sino do marketing mostra os avisos dele (in_app) e só os dele.
  select count(*) into n from public.notifications
   where kind in ('meta_conta_estado', 'meta_alerta', 'meta_sync_falhou');
  perform pg_temp.check117(n >= 1
    and not exists (select 1 from public.notifications where profile_id <> mkt or channel <> 'in_app'),
    format('o sino do marketing traz os avisos da Meta, só os dele (%s)', n));

  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check117(
    not has_function_privilege('anon', 'public.meta_account_thresholds_set(uuid,numeric,numeric,int,numeric,int,numeric)', 'execute')
    and has_function_privilege('authenticated', 'public.meta_account_thresholds_set(uuid,numeric,numeric,int,numeric,int,numeric)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_avaliar_alertas(uuid,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_enfileirar_resumo_diario()', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_classifica_conta(int,int,boolean,numeric,numeric,numeric,numeric)', 'execute')
    and has_function_privilege('service_role', 'public.meta_avaliar_alertas(uuid,boolean)', 'execute')
    and has_function_privilege('service_role', 'public.meta_enfileirar_resumo_diario()', 'execute')
    and not has_function_privilege('service_role', 'public.meta_notificar(text,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_brl(numeric)', 'execute'),
    'grants: limites para o logado; avaliar e resumo só service role; ajudantes internos');

  perform pg_temp.check117(
    not exists (
      select 1 from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('meta_classifica_conta', 'meta_notificar', 'meta_avaliar_alertas',
                           'meta_account_thresholds_set', 'meta_enfileirar_resumo_diario')
         and exists (select 1 from unnest(coalesce(p.proargnames, '{}'::text[])) as arg
                      where arg ~* '(phone|telefone|fone|whats|destino|numero)'))
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'notifications'
                       and column_name ~* '(phone|telefone)'),
    'nenhuma função da 0117 recebe telefone: o destino é sempre o perfil');
end
$$;

\echo '== 9. o cron do resumo =='

do $$
begin
  perform pg_temp.check117(exists (
    select 1 from cron.job
     where jobname = 'faceimob-meta-resumo-diario'
       and schedule = '0 11 * * *'
       and command like '%meta_enfileirar_resumo_diario()%'),
    'faceimob-meta-resumo-diario agendado às 11:00 UTC (08:00 em São Paulo)');
end
$$;

\echo '== limpeza: nada daqui entra nas somas do teste seguinte =='

do $$
begin
  delete from public.leads where campaign_id like 'camp-0117-%';
  delete from public.ad_campaigns where external_id like 'camp-0117-%';
  delete from public.meta_ad_accounts where act_id = 'act_1170001';
  perform pg_temp.check117(
    not exists (select 1 from public.meta_campaign_insights_daily i
                  join public.ad_campaigns c on c.id = i.campaign_id
                 where c.external_id like 'camp-0117-%')
    and not exists (select 1 from public.meta_ad_accounts where act_id = 'act_1170001'),
    'campanhas, insights, alertas e conta do teste apagados');
end
$$;

\echo 'OK 0117 meta alertas e resumo'
