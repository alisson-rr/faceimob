-- =============================================================================
-- 99 · Sincronização da Meta no livro do gasto (migration 0115)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`; a migration coberta é a 0115.
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. Escolher as contas é de settings.integrations; conta fora da lista é
--      desligada, não apagada.
--   2-3. Planilha de 01-31/08 e pedido de 25/08-11/09: a janela buscada começa
--      em 01/08, a linha mensal vira dias com o mesmo total, e a campanha
--      VIZINHA, com planilha de 20/07-18/08 cruzando o início estendido, não
--      perde a linha (a janela dela sai da PEDIDA, não da buscada). Campanha
--      manual é adotada com o vínculo preservado; id de outra plataforma vira
--      conflito.
--   4. Rodar a mesma sincronização de novo não muda total nenhum.
--   5. O cenário do crítico: planilha de agosto → sincronização de setembro
--      cruzando agosto → reimportação de agosto → nova sincronização. Nenhum
--      dia em dobro, nenhum dia perdido, total igual em todos os passos.
--   6. Falta de cobertura é POR campanha (vira conflito e o gasto dela não é
--      tocado); a janela nunca passa dos 37 meses da Meta; janela buscada que
--      não contém a pedida derruba a apply inteira sem gravar nada; execução
--      parada há mais de 15 min não trava a conta.
--   7. Números "segundo a Meta": só somam e dividem, alcance nulo em vários
--      dias, denominador zero é nulo, cobertura desde o primeiro dia
--      sincronizado. RLS e grants com `set local role authenticated`.
--   8. Campo que vem da Meta não se edita à mão (42501), o vínculo sim.
--
-- UUIDs na faixa `…-000001150001+`, exclusiva deste arquivo.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check115(cond boolean, label text)
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
create or replace function pg_temp.become115(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

/** A edge function com a service role. */
create or replace function pg_temp.servico115()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
end;
$$;

/** Dias de insight como a Meta devolve (time_increment=1), vazio se de > ate. */
create or replace function pg_temp.dias115(p_ext text, p_de date, p_ate date, p_spend numeric,
                                           p_impr int, p_link int, p_res int)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'external_id', p_ext, 'day', d::date, 'spend', p_spend,
           'impressions', p_impr, 'reach', 400, 'clicks', p_link + 10, 'link_clicks', p_link,
           'leads_form', p_res, 'conversations', 0, 'lp_leads', 0, 'lp_views', 5,
           'resultados', p_res) order by d), '[]'::jsonb)
    from generate_series(p_de, p_ate, interval '1 day') as d;
$$;

/**
 * Payload de meta_sync_apply. A "Meta" só devolve dias dentro da janela
 * BUSCADA — por isso cada série é recortada por ela.
 */
create or replace function pg_temp.payload115(p_ped_ini date, p_ped_fim date,
                                              p_bus_ini date, p_bus_fim date, p_com_c boolean)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'janela_pedida',  jsonb_build_object('inicio', p_ped_ini, 'fim', p_ped_fim),
    'janela_buscada', jsonb_build_object('inicio', p_bus_ini, 'fim', p_bus_fim),
    'conta', jsonb_build_object(
      'name', 'Conta 0115 (Meta)', 'currency', 'BRL', 'timezone_name', 'America/Sao_Paulo',
      'account_status', 1, 'disable_reason', 0, 'is_prepay', false,
      'amount_spent', 12345.67, 'spend_cap', 50000, 'prepay_available', null),
    'campanhas', jsonb_build_array(
      jsonb_build_object('external_id', 'camp-0115-a', 'name', 'A 0115 (Meta)', 'status', 'ACTIVE',
        'effective_status', 'ACTIVE', 'objective', 'OUTCOME_LEADS', 'daily_budget', 100,
        'lifetime_budget', null, 'budget_level', 'campaign', 'channel', 'formulario',
        'developer_suggested_id', null),
      jsonb_build_object('external_id', 'camp-0115-b', 'name', 'B 0115 (Meta)', 'status', 'ACTIVE',
        'effective_status', 'ACTIVE', 'objective', 'OUTCOME_ENGAGEMENT', 'daily_budget', 80,
        'lifetime_budget', null, 'budget_level', 'adset', 'channel', 'whatsapp',
        'developer_suggested_id', null),
      jsonb_build_object('external_id', 'camp-0115-m', 'name', 'Manual 0115 (Meta)', 'status', 'PAUSED',
        'effective_status', 'PAUSED', 'objective', 'OUTCOME_LEADS', 'daily_budget', 50,
        'lifetime_budget', null, 'budget_level', 'campaign', 'channel', 'landing_page',
        'developer_suggested_id', '7d000000-0000-0000-0000-000001150001'),
      jsonb_build_object('external_id', 'camp-0115-n', 'name', 'CONSTRUTORA 0115 | FORMULARIO', 'status', 'ARCHIVED',
        'effective_status', 'ARCHIVED', 'objective', 'OUTCOME_LEADS', 'daily_budget', null,
        'lifetime_budget', null, 'budget_level', 'campaign', 'channel', 'formulario',
        'developer_suggested_id', '7d000000-0000-0000-0000-000001150001'),
      jsonb_build_object('external_id', 'camp-0115-x', 'name', 'X 0115', 'status', 'ACTIVE',
        'effective_status', 'ACTIVE', 'objective', 'OUTCOME_LEADS', 'daily_budget', 10,
        'lifetime_budget', null, 'budget_level', 'campaign', 'channel', 'formulario',
        'developer_suggested_id', null))
      || case when p_com_c then jsonb_build_array(
      jsonb_build_object('external_id', 'camp-0115-c', 'name', 'Antiga 0115 (Meta)', 'status', 'PAUSED',
        'effective_status', 'PAUSED', 'objective', 'OUTCOME_LEADS', 'daily_budget', null,
        'lifetime_budget', null, 'budget_level', 'campaign', 'channel', 'outro',
        'developer_suggested_id', null)) else '[]'::jsonb end,
    'insights',
      pg_temp.dias115('camp-0115-a', greatest(date '2026-08-01', p_bus_ini), least(date '2026-08-31', p_bus_fim), 100, 1000, 20, 2)
      || pg_temp.dias115('camp-0115-a', greatest(date '2026-09-01', p_bus_ini), least(date '2026-09-11', p_bus_fim), 50, 1000, 20, 2)
      || pg_temp.dias115('camp-0115-b', greatest(date '2026-08-01', p_bus_ini), least(date '2026-09-11', p_bus_fim), 10, 500, 5, 1)
      || pg_temp.dias115('camp-0115-m', greatest(date '2026-09-01', p_bus_ini), least(date '2026-09-11', p_bus_fim), 20, 800, 8, 1)
      || pg_temp.dias115('camp-0115-n', greatest(date '2026-09-10', p_bus_ini), least(date '2026-09-11', p_bus_fim), 30, 0, 0, 0)
      || pg_temp.dias115('camp-0115-x', greatest(date '2026-09-01', p_bus_ini), least(date '2026-09-01', p_bus_fim), 99, 100, 1, 0)
      || case when p_com_c
           then pg_temp.dias115('camp-0115-c', greatest(date '2026-08-25', p_bus_ini), least(date '2026-09-11', p_bus_fim), 7, 100, 1, 0)
           else '[]'::jsonb end);
$$;

/** Cada dia de 01/08 a 11/09 coberto por EXATAMENTE uma linha do livro da campanha. */
create or replace function pg_temp.dias_errados115(p_campaign uuid)
returns int
language sql
as $$
  select count(*)::int
    from generate_series(date '2026-08-01', date '2026-09-11', interval '1 day') as d
   where (select count(*) from public.ad_campaign_spend s
           where s.campaign_id = p_campaign
             and d::date between s.period_start and s.period_end) <> 1;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres)
--   Adão = admin · Mara = marketing · Caio = corretor
--   A e B = campanhas cadastradas à mão, ainda sem conta de anúncios
--   M = campanha manual com vínculo (construtora, início) e gasto DIGITADO
--   X = id externo de outra plataforma (google), que a Meta também devolve
--   C = campanha com planilha que começa há 38 meses
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001150001';
  mkt uuid := '00000000-0000-0000-0000-000001150002';
  cor uuid := '00000000-0000-0000-0000-000001150003';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adao@t115.test', '{"full_name":"Adão Admin 115"}'),
    (mkt, 'mara@t115.test', '{"full_name":"Mara Marketing 115"}'),
    (cor, 'caio@t115.test', '{"full_name":"Caio Corretor 115"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (mkt, 'marketing'), (cor, 'broker')
  on conflict do nothing;

  insert into public.developers (id, name, slug) values
    ('7d000000-0000-0000-0000-000001150001', 'Construtora 0115', 'construtora-0115')
  on conflict do nothing;

  insert into public.ad_campaigns (id, external_id, platform, name, total_spend, developer_id, starts_on) values
    ('7e000000-0000-0000-0000-000001150001', 'camp-0115-a', 'meta',   'A 0115',       0,   null, null),
    ('7e000000-0000-0000-0000-000001150002', 'camp-0115-b', 'meta',   'B 0115',       0,   null, null),
    ('7e000000-0000-0000-0000-000001150003', 'camp-0115-m', 'meta',   'Manual 0115',  777,
       '7d000000-0000-0000-0000-000001150001', date '2026-08-15'),
    ('7e000000-0000-0000-0000-000001150004', 'camp-0115-x', 'google', 'Google 0115',  0,   null, null),
    ('7e000000-0000-0000-0000-000001150005', 'camp-0115-c', 'meta',   'Antiga 0115',  0,   null, null);
end
$$;

\echo '== 1. escolher as contas: settings.integrations; fora da lista = desligada =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001150001';
  mkt uuid := '00000000-0000-0000-0000-000001150002';
  cor uuid := '00000000-0000-0000-0000-000001150003';
  n   int;
begin
  set local role authenticated;

  perform pg_temp.become115(mkt);
  begin
    perform public.meta_accounts_save('[{"act_id":"act_1150001"}]');
    raise exception 'FALHOU: marketing escolheu conta de anúncios';
  exception when insufficient_privilege then
    raise notice '  ok  marketing leva 42501 ao escolher contas (é de settings.integrations)';
  end;

  perform pg_temp.become115(cor);
  begin
    perform public.meta_accounts_save('[{"act_id":"act_1150001"}]');
    raise exception 'FALHOU: corretor escolheu conta de anúncios';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 ao escolher contas';
  end;

  perform pg_temp.become115(adm);
  begin
    perform public.meta_accounts_save('[{"act_id":"1150001"}]');
    raise exception 'FALHOU: id de conta sem act_ aceito';
  exception when invalid_parameter_value then
    raise notice '  ok  id de conta fora do formato act_<números> é recusado';
  end;

  n := public.meta_accounts_save($j$[
    {"act_id":"act_1150001","name":"Conta 0115","currency":"BRL","timezone_name":"America/Sao_Paulo"},
    {"act_id":"act_1150002","name":"Conta extra 0115","currency":"BRL","timezone_name":"America/Sao_Paulo"}
  ]$j$);
  perform pg_temp.check115(n = 2, format('admin salva duas contas (salvou %s)', n));

  n := public.meta_accounts_save('[{"act_id":"act_1150001","name":"Conta 0115"}]');
  perform pg_temp.check115(n = 1, 'admin salva de novo só a primeira');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115(
    (select enabled from public.meta_ad_accounts where act_id = 'act_1150001')
    and not (select enabled from public.meta_ad_accounts where act_id = 'act_1150002'),
    'a conta que saiu da lista fica desligada, e não apagada');
end
$$;

\echo '== 2. planilha de agosto para A e de 20/07-18/08 para B =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001150002';
  v   record;
begin
  set local role authenticated;
  perform pg_temp.become115(mkt);
  perform public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001150001","period_start":"2026-08-01","period_end":"2026-08-31","spend":3100},
    {"campaign_id":"7e000000-0000-0000-0000-000001150002","period_start":"2026-07-20","period_end":"2026-08-18","spend":900}
  ]$j$, 'agosto.csv');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select total_spend, spend_source into v from public.ad_campaigns where id = '7e000000-0000-0000-0000-000001150001';
  perform pg_temp.check115(v.total_spend = 3100 and v.spend_source = 'planilha',
    format('a planilha entra pelo recálculo único, com procedência planilha (%s, %s)', v.total_spend, v.spend_source));
end
$$;

\echo '== 3. janela estendida só para quem precisa; vizinha intacta; adoção =='

do $$
declare
  a    uuid := '7e000000-0000-0000-0000-000001150001';
  b    uuid := '7e000000-0000-0000-0000-000001150002';
  m    uuid := '7e000000-0000-0000-0000-000001150003';
  x    uuid := '7e000000-0000-0000-0000-000001150004';
  acc  uuid;
  run1 uuid;
  w    date;
  r    jsonb;
  v    record;
  n    int;
begin
  select id into acc from public.meta_ad_accounts where act_id = 'act_1150001';

  set local role service_role;
  perform pg_temp.servico115();

  run1 := public.meta_sync_start(acc, 'cron', null);
  begin
    perform public.meta_sync_start(acc, 'manual', null);
    raise exception 'FALHOU: duas sincronizações simultâneas da mesma conta';
  exception when lock_not_available then
    raise notice '  ok  segunda execução simultânea leva 55P03';
  end;

  -- A e B ainda não têm conta: entram pela lista de external_ids.
  w := public.meta_sync_window(acc, array['camp-0115-a','camp-0115-b','camp-0115-m','camp-0115-n'],
                               date '2026-08-25', date '2026-09-11');
  perform pg_temp.check115(w = date '2026-08-01',
    format('a planilha de agosto que cruza a janela puxa a busca para 01/08 (veio %s)', w));

  r := public.meta_sync_apply(run1, pg_temp.payload115(
         date '2026-08-25', date '2026-09-11', w, date '2026-09-11', false));
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115((r->>'campanhas_criadas')::int = 1 and (r->>'campanhas_atualizadas')::int = 3,
    format('N é criada; A, B e M são adotadas (%s)', r));
  perform pg_temp.check115((r->>'dias')::int = 73,
    format('dias gravados: A 42 + B 18 + M 11 + N 2 (vieram %s)', r->>'dias'));
  perform pg_temp.check115(
    jsonb_array_length(r->'conflitos') = 1
    and exists (select 1 from jsonb_array_elements_text(r->'conflitos') t where t like 'camp-0115-x:%'),
    format('id externo de outra plataforma volta em conflitos (%s)', r->'conflitos'));

  -- A: agosto mensal vira dias com o mesmo total.
  select total_spend, spend_source, meta_account_id, name, status into v from public.ad_campaigns where id = a;
  perform pg_temp.check115(v.total_spend = 3650,
    format('A = agosto 3100 + setembro 550 (ficou %s)', v.total_spend));
  perform pg_temp.check115(v.spend_source = 'meta_api' and v.meta_account_id = acc,
    'A passa a ser sincronizada, com procedência meta_api');
  perform pg_temp.check115(v.name = 'A 0115 (Meta)' and v.status = 'ACTIVE', 'nome e status vêm da Meta');
  perform pg_temp.check115(
    not exists (select 1 from public.ad_campaign_spend
                 where campaign_id = a and period_start = date '2026-08-01' and period_end = date '2026-08-31'),
    'a linha mensal de agosto sumiu');
  perform pg_temp.check115(
    exists (select 1 from public.ad_campaign_spend
             where campaign_id = a and period_start = date '2026-08-14' and period_end = date '2026-08-14'
               and source = 'meta_api' and spend = 100),
    'o dia 14/08 (antes do início pedido) está no livro, vindo da Meta');
  perform pg_temp.check115(pg_temp.dias_errados115(a) = 0,
    'A: cada dia de 01/08 a 11/09 aparece exatamente uma vez no livro');
  perform pg_temp.check115(
    (select sum(spend) from public.ad_campaign_spend where campaign_id = a) = 3650,
    'A: total_spend é a soma do livro');

  -- B: a janela dela sai da PEDIDA. A planilha 20/07-18/08 cruza o início
  -- ESTENDIDO (01/08) e não pode ser apagada por causa de A.
  perform pg_temp.check115(
    exists (select 1 from public.ad_campaign_spend
             where campaign_id = b and period_start = date '2026-07-20' and period_end = date '2026-08-18'
               and source = 'planilha' and spend = 900),
    'B: a planilha 20/07-18/08 continua lá, inteira');
  select total_spend, spend_source into v from public.ad_campaigns where id = b;
  perform pg_temp.check115(v.total_spend = 1080 and v.spend_source = 'misto',
    format('B = planilha 900 + 18 dias (25/08-11/09) de 10, procedência misto (%s, %s)', v.total_spend, v.spend_source));
  select min(day) as primeiro, count(*) as n into v from public.meta_campaign_insights_daily where campaign_id = b;
  perform pg_temp.check115(v.primeiro = date '2026-08-25' and v.n = 18,
    format('B: os dias de 01 a 24/08 buscados por causa de A são ignorados (%s dias desde %s)', v.n, v.primeiro));

  -- M: adoção preserva o vínculo; o gasto digitado dá lugar ao livro.
  select * into v from public.ad_campaigns where id = m;
  perform pg_temp.check115(v.developer_id = '7d000000-0000-0000-0000-000001150001' and v.starts_on = date '2026-08-15',
    'M: construtora e início de veiculação preservados na adoção');
  perform pg_temp.check115(v.name = 'Manual 0115 (Meta)' and v.status = 'PAUSED' and v.meta_channel = 'landing_page',
    'M: nome, status e canal passam a vir da Meta');
  perform pg_temp.check115(v.total_spend = 220, format('M: o digitado (777) dá lugar a 11 dias de 20 (ficou %s)', v.total_spend));

  -- N: criada pela sincronização, sem vínculo, com a sugestão pelo nome.
  select * into v from public.ad_campaigns where external_id = 'camp-0115-n';
  perform pg_temp.check115(v.platform = 'meta' and v.developer_id is null
    and v.developer_suggested_id = '7d000000-0000-0000-0000-000001150001'
    and v.status = 'ARCHIVED' and v.total_spend = 60,
    'N: criada com a sugestão de construtora, vínculo nulo e o gasto dos dois dias');

  -- X: outra plataforma, intocada.
  select * into v from public.ad_campaigns where id = x;
  perform pg_temp.check115(v.meta_account_id is null and v.total_spend = 0 and v.name = 'Google 0115'
    and not exists (select 1 from public.ad_campaign_spend where campaign_id = x),
    'X (google) não é tocada nem ganha gasto');

  select * into v from public.meta_sync_runs where id = run1;
  perform pg_temp.check115(v.status = 'ok' and v.window_start = date '2026-08-25'
    and v.window_end = date '2026-09-11' and v.rows = 73 and v.campaigns = 4 and v.finished_at is not null,
    'a execução fecha ok com a janela pedida e as contagens');

  select * into v from public.meta_ad_accounts where id = acc;
  perform pg_temp.check115(v.name = 'Conta 0115 (Meta)' and v.amount_spent = 12345.67
    and v.account_status = 1 and v.is_prepay = false and v.last_sync_ok_at is not null
    and v.last_sync_error is null and v.account_checked_at is not null,
    'o estado cru da conta é gravado junto');
end
$$;

\echo '== 4. a mesma sincronização de novo não muda total nenhum =='

do $$
declare
  a    uuid := '7e000000-0000-0000-0000-000001150001';
  b    uuid := '7e000000-0000-0000-0000-000001150002';
  m    uuid := '7e000000-0000-0000-0000-000001150003';
  acc  uuid;
  run2 uuid;
  r    jsonb;
begin
  select id into acc from public.meta_ad_accounts where act_id = 'act_1150001';
  set local role service_role;
  perform pg_temp.servico115();
  run2 := public.meta_sync_start(acc, 'cron', null);
  r := public.meta_sync_apply(run2, pg_temp.payload115(
         date '2026-08-25', date '2026-09-11', date '2026-08-01', date '2026-09-11', false));
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115((r->>'campanhas_criadas')::int = 0 and (r->>'campanhas_atualizadas')::int = 4,
    format('na segunda vez ninguém é criado (%s)', r));
  perform pg_temp.check115(
    (select total_spend from public.ad_campaigns where id = a) = 3650
    and (select total_spend from public.ad_campaigns where id = b) = 1080
    and (select total_spend from public.ad_campaigns where id = m) = 220,
    'A, B e M com o mesmo total da primeira vez');
  perform pg_temp.check115(
    (select count(*) from public.ad_campaign_spend where campaign_id = a) = 42
    and (select count(*) from public.ad_campaign_spend where campaign_id = b) = 19,
    'o livro tem as mesmas linhas (A 42 dias; B planilha + 18 dias)');
end
$$;

\echo '== 5. planilha de agosto → sync de setembro cruzando agosto → reimporta agosto → sync =='

do $$
declare
  a    uuid := '7e000000-0000-0000-0000-000001150001';
  mkt  uuid := '00000000-0000-0000-0000-000001150002';
  acc  uuid;
  run3 uuid;
  w    date;
  v    record;
begin
  select id into acc from public.meta_ad_accounts where act_id = 'act_1150001';

  -- Alguém reimporta agosto sobre os dias da API. A campanha já é sincronizada:
  -- a importação passa porque o recálculo é definer.
  set local role authenticated;
  perform pg_temp.become115(mkt);
  perform public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001150001","period_start":"2026-08-01","period_end":"2026-08-31","spend":3100}
  ]$j$, 'agosto-de-novo.csv');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select total_spend, spend_source into v from public.ad_campaigns where id = a;
  perform pg_temp.check115(v.total_spend = 3650 and v.spend_source = 'misto',
    format('reimportar agosto troca os 31 dias pela linha mensal sem soma dupla (%s, %s)', v.total_spend, v.spend_source));
  perform pg_temp.check115((select count(*) from public.ad_campaign_spend where campaign_id = a) = 12,
    'o livro de A fica com a linha de agosto e os 11 dias de setembro');
  perform pg_temp.check115(pg_temp.dias_errados115(a) = 0,
    'depois da reimportação, nenhum dia em dobro e nenhum dia faltando');

  -- A sincronização seguinte cruza agosto de novo e troca por dias.
  set local role service_role;
  perform pg_temp.servico115();
  w := public.meta_sync_window(acc, '{}'::text[], date '2026-08-25', date '2026-09-11');
  run3 := public.meta_sync_start(acc, 'cron', null);
  perform public.meta_sync_apply(run3, pg_temp.payload115(
         date '2026-08-25', date '2026-09-11', w, date '2026-09-11', false));
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115(w = date '2026-08-01',
    'A já é da conta: a janela a considera mesmo fora da lista de external_ids');
  select total_spend, spend_source into v from public.ad_campaigns where id = a;
  perform pg_temp.check115(v.total_spend = 3650 and v.spend_source = 'meta_api',
    format('a nova sincronização volta agosto a dias com o mesmo total (%s, %s)', v.total_spend, v.spend_source));
  perform pg_temp.check115((select count(*) from public.ad_campaign_spend where campaign_id = a) = 42
    and pg_temp.dias_errados115(a) = 0,
    'A de novo com 42 dias, cada um exatamente uma vez');
end
$$;

\echo '== 6. cobertura por campanha, 37 meses, janela inválida, execução órfã =='

do $$
declare
  a     uuid := '7e000000-0000-0000-0000-000001150001';
  b     uuid := '7e000000-0000-0000-0000-000001150002';
  cc    uuid := '7e000000-0000-0000-0000-000001150005';
  mkt   uuid := '00000000-0000-0000-0000-000001150002';
  acc   uuid;
  run4  uuid;
  run5  uuid;
  velha uuid;
  w     date;
  r     jsonb;
  ok_antes timestamptz;
  v     record;
begin
  select id into acc from public.meta_ad_accounts where act_id = 'act_1150001';

  -- Agosto mensal de novo em A, e em C uma planilha que começa há 38 meses.
  set local role authenticated;
  perform pg_temp.become115(mkt);
  perform public.marketing_import_ad_spend(jsonb_build_array(
    jsonb_build_object('campaign_id', a, 'period_start', '2026-08-01', 'period_end', '2026-08-31', 'spend', 3100),
    jsonb_build_object('campaign_id', cc, 'period_start', (current_date - interval '38 months')::date,
                       'period_end', '2026-08-27', 'spend', 5000)), 'antigas.csv');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  set local role service_role;
  perform pg_temp.servico115();
  w := public.meta_sync_window(acc, array['camp-0115-c'], date '2026-08-25', date '2026-09-11');
  reset role;
  perform pg_temp.check115(w = date '2026-08-01' and w >= (current_date - interval '37 months')::date,
    format('C passaria dos 37 meses e fica fora do mínimo; a busca começa em 01/08 (veio %s)', w));

  -- A busca NÃO foi estendida: A e C ficam sem cobertura e viram conflito;
  -- B, M e N sincronizam normalmente.
  set local role service_role;
  run4 := public.meta_sync_start(acc, 'manual', null);
  r := public.meta_sync_apply(run4, pg_temp.payload115(
         date '2026-08-25', date '2026-09-11', date '2026-08-25', date '2026-09-11', true));
  reset role;

  perform pg_temp.check115(
    exists (select 1 from jsonb_array_elements_text(r->'conflitos') t where t like 'camp-0115-a:%')
    and exists (select 1 from jsonb_array_elements_text(r->'conflitos') t where t like 'camp-0115-c:%')
    and jsonb_array_length(r->'conflitos') = 3,
    format('A e C (sem cobertura) e X voltam em conflitos, sem derrubar a conta (%s)', r->'conflitos'));
  perform pg_temp.check115((r->>'dias')::int = 31, format('B 18 + M 11 + N 2 gravados (vieram %s)', r->>'dias'));
  perform pg_temp.check115(
    (select total_spend from public.ad_campaigns where id = a) = 3650
    and exists (select 1 from public.ad_campaign_spend
                 where campaign_id = a and period_start = date '2026-08-01' and period_end = date '2026-08-31')
    and (select count(*) from public.meta_campaign_insights_daily where campaign_id = a) = 42,
    'A: a planilha de agosto e os insights ficam como estavam');
  select * into v from public.ad_campaigns where id = cc;
  perform pg_temp.check115(v.total_spend = 5000 and v.meta_account_id = acc
    and (select count(*) from public.ad_campaign_spend where campaign_id = cc) = 1,
    'C: adotada, mas o gasto de planilha continua valendo');
  perform pg_temp.check115((select total_spend from public.ad_campaigns where id = b) = 1080,
    'B sincroniza normalmente ao lado dos conflitos');
  perform pg_temp.check115((select status from public.meta_sync_runs where id = run4) = 'ok',
    'a execução com conflitos fecha ok');

  -- Execução parada há mais de 15 min não trava a conta.
  insert into public.meta_sync_runs (account_id, trigger, status, started_at)
  values (acc, 'cron', 'rodando', clock_timestamp() - interval '20 minutes')
  returning id into velha;

  ok_antes := (select last_sync_ok_at from public.meta_ad_accounts where id = acc);
  set local role service_role;
  perform pg_temp.servico115();
  run5 := public.meta_sync_start(acc, 'cron', null);

  -- Janela buscada que não contém a pedida: nada é gravado.
  begin
    perform public.meta_sync_apply(run5, pg_temp.payload115(
           date '2026-08-25', date '2026-09-11', date '2026-08-26', date '2026-09-11', false));
    raise exception 'FALHOU: janela buscada menor que a pedida foi aceita';
  exception when invalid_parameter_value then
    raise notice '  ok  janela buscada que não contém a pedida leva 22023';
  end;

  begin
    perform public.meta_sync_finish(run5, 'ok', null);
    raise exception 'FALHOU: execução fechada como ok sem dados';
  exception when invalid_parameter_value then
    raise notice '  ok  meta_sync_finish não fecha como ok uma execução sem apply';
  end;

  perform public.meta_sync_finish(run5, 'falhou', 'Token expirado (190).');
  perform public.meta_sync_finish(run5, 'falhou', 'outra mensagem');

  begin
    perform public.meta_sync_apply(run5, pg_temp.payload115(
           date '2026-08-25', date '2026-09-11', date '2026-08-01', date '2026-09-11', false));
    raise exception 'FALHOU: apply aceitou execução encerrada';
  exception when object_not_in_prerequisite_state then
    raise notice '  ok  apply em execução encerrada leva 55000';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115(
    (select status from public.meta_sync_runs where id = velha) = 'falhou',
    'a execução órfã de 20 min vira falhou e não trava a conta');
  select * into v from public.meta_sync_runs where id = run5;
  perform pg_temp.check115(v.status = 'falhou' and v.error = 'Token expirado (190).',
    'a falha fica registrada, e repetir o encerramento não a sobrescreve');
  select * into v from public.meta_ad_accounts where id = acc;
  perform pg_temp.check115(v.last_sync_error = 'Token expirado (190).' and v.last_sync_ok_at = ok_antes,
    'a conta mostra a falha e mantém a data da última sincronização boa');
  perform pg_temp.check115(
    (select total_spend from public.ad_campaigns where id = a) = 3650
    and (select total_spend from public.ad_campaigns where id = b) = 1080,
    'a falha não mexeu em total nenhum');
end
$$;

\echo '== 7. números segundo a Meta; RLS com set local role =='

do $$
declare
  a   uuid := '7e000000-0000-0000-0000-000001150001';
  mkt uuid := '00000000-0000-0000-0000-000001150002';
  cor uuid := '00000000-0000-0000-0000-000001150003';
  v   record;
  n   int;
begin
  set local role authenticated;
  perform pg_temp.become115(mkt);

  select * into v from public.meta_metricas(date '2026-09-01', date '2026-09-11') where campaign_id = a;
  perform pg_temp.check115(v.spend = 550 and v.impressions = 11000 and v.link_clicks = 220 and v.dias = 11,
    format('A em setembro: soma dos dias (%s)', v));
  perform pg_temp.check115(v.reach is null, 'alcance é nulo em período de vários dias');
  perform pg_temp.check115(v.ctr = 0.02 and v.cpc = 2.50 and v.cpm = 50.00,
    format('CTR = cliques no link / impressões; CPC e CPM (%s, %s, %s)', v.ctr, v.cpc, v.cpm));
  perform pg_temp.check115(v.resultados = 22 and v.custo_por_resultado = 25.00 and v.channel = 'formulario',
    'resultados somados da coluna gravada; custo por resultado = gasto / resultados');
  perform pg_temp.check115(v.cobertura_desde = date '2026-08-25',
    format('cobertura = primeiro dia sincronizado da conta (veio %s)', v.cobertura_desde));

  select * into v from public.meta_metricas(date '2026-09-01', date '2026-09-11') where external_id = 'camp-0115-n';
  perform pg_temp.check115(v.spend = 60 and v.ctr is null and v.cpc is null and v.cpm is null
    and v.custo_por_resultado is null,
    'denominador zero devolve nulo, não zero nem erro');

  select * into v from public.meta_metricas(date '2026-09-05', date '2026-09-05') where campaign_id = a;
  perform pg_temp.check115(v.reach = 400, 'em um dia só, o alcance aparece');

  select * into v from public.meta_metricas_por_canal(date '2026-09-01', date '2026-09-11') where channel = 'formulario';
  perform pg_temp.check115(v.spend = 610 and v.resultados = 22 and v.custo_por_resultado = 27.73 and v.campanhas = 2,
    format('formulário = gasto das campanhas de formulário / resultados delas (%s)', v));
  select * into v from public.meta_metricas_por_canal(date '2026-09-01', date '2026-09-11') where channel = 'whatsapp';
  perform pg_temp.check115(v.spend = 110 and v.resultados = 11 and v.custo_por_resultado = 10.00,
    'whatsapp com o próprio gasto, nunca o gasto total');

  perform pg_temp.check115((select count(*) from public.meta_ad_accounts) >= 1
    and (select count(*) from public.meta_sync_runs) >= 1
    and (select count(*) from public.meta_campaign_insights_daily) >= 1,
    'marketing lê contas, execuções e insights');

  begin
    perform public.meta_sync_apply(gen_random_uuid(), '{}'::jsonb);
    raise exception 'FALHOU: marketing chamou meta_sync_apply';
  exception when insufficient_privilege then
    raise notice '  ok  marketing leva 42501 em meta_sync_apply';
  end;
  begin
    insert into public.meta_ad_accounts (act_id) values ('act_1159999');
    raise exception 'FALHOU: marketing inseriu conta direto';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto em meta_ad_accounts é recusado (RLS)';
  end;
  begin
    update public.meta_campaign_insights_daily set spend = 0 where campaign_id = a;
    raise exception 'FALHOU: marketing editou insight direto';
  exception when insufficient_privilege then
    raise notice '  ok  update direto em meta_campaign_insights_daily é recusado';
  end;
  begin
    delete from public.meta_sync_runs;
    raise exception 'FALHOU: marketing apagou execuções';
  exception when insufficient_privilege then
    raise notice '  ok  delete direto em meta_sync_runs é recusado';
  end;

  perform pg_temp.become115(cor);
  begin
    perform * from public.meta_metricas(date '2026-09-01', date '2026-09-11');
    raise exception 'FALHOU: corretor leu meta_metricas';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_metricas';
  end;
  begin
    perform * from public.meta_metricas_por_canal(date '2026-09-01', date '2026-09-11');
    raise exception 'FALHOU: corretor leu meta_metricas_por_canal';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_metricas_por_canal';
  end;
  begin
    perform public.meta_sync_apply(gen_random_uuid(), '{}'::jsonb);
    raise exception 'FALHOU: corretor chamou meta_sync_apply';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_sync_apply';
  end;
  begin
    perform public.meta_sync_start(gen_random_uuid(), 'manual', null);
    raise exception 'FALHOU: corretor iniciou sincronização';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 em meta_sync_start';
  end;
  select (select count(*) from public.meta_ad_accounts)
       + (select count(*) from public.meta_sync_runs)
       + (select count(*) from public.meta_campaign_insights_daily) into n;
  perform pg_temp.check115(n = 0, format('corretor não enxerga contas, execuções nem insights (viu %s)', n));

  reset role;
  perform set_config('request.jwt.claims', '', false);

  set local role service_role;
  perform pg_temp.servico115();
  select count(*) into n from public.meta_metricas(date '2026-09-01', date '2026-09-11');
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.check115(n >= 4, 'a service role (alertas e IA) lê meta_metricas');

  perform pg_temp.check115(
    not has_function_privilege('authenticated', 'public.meta_janela_campanha(uuid,date,date)', 'execute')
    and not has_function_privilege('service_role', 'public.meta_janela_campanha(uuid,date,date)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_sync_window(uuid,text[],date,date)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_sync_finish(uuid,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.meta_sync_apply(uuid,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.meta_metricas(date,date)', 'execute')
    and not has_function_privilege('anon', 'public.meta_accounts_save(jsonb)', 'execute'),
    'grants: janela interna; sync só service; nada para anon');
end
$$;

\echo '== 8. campo que vem da Meta não se edita à mão; o vínculo sim =='

do $$
declare
  a   uuid := '7e000000-0000-0000-0000-000001150001';
  x   uuid := '7e000000-0000-0000-0000-000001150004';
  mkt uuid := '00000000-0000-0000-0000-000001150002';
  acc uuid;
begin
  select id into acc from public.meta_ad_accounts where act_id = 'act_1150001';
  set local role authenticated;
  perform pg_temp.become115(mkt);

  begin
    update public.ad_campaigns set status = 'PAUSED' where id = a;
    raise exception 'FALHOU: status de campanha sincronizada editado à mão';
  exception when insufficient_privilege then
    raise notice '  ok  mudar o status de campanha sincronizada leva 42501';
  end;
  begin
    update public.ad_campaigns set external_id = 'camp-0115-a-errado' where id = a;
    raise exception 'FALHOU: external_id de campanha sincronizada trocado';
  exception when insufficient_privilege then
    raise notice '  ok  mudar o external_id de campanha sincronizada leva 42501';
  end;
  begin
    update public.ad_campaigns set total_spend = 1 where id = a;
    raise exception 'FALHOU: gasto de campanha sincronizada digitado';
  exception when insufficient_privilege then
    raise notice '  ok  digitar o gasto de campanha sincronizada leva 42501';
  end;
  begin
    insert into public.ad_campaigns (external_id, platform, name, meta_account_id)
    values ('camp-0115-forjada', 'meta', 'Forjada 0115', acc);
    raise exception 'FALHOU: campanha "sincronizada" criada à mão';
  exception when insufficient_privilege then
    raise notice '  ok  criar campanha já ligada a uma conta leva 42501';
  end;
  begin
    update public.ad_campaigns set meta_account_id = acc where id = x;
    raise exception 'FALHOU: campanha ligada a uma conta à mão';
  exception when insufficient_privilege then
    raise notice '  ok  ligar campanha a uma conta à mão leva 42501';
  end;

  -- O formulário reenvia nome e status iguais junto com o vínculo: passa.
  update public.ad_campaigns
     set name = name, status = status,
         developer_id = '7d000000-0000-0000-0000-000001150001', lead_source_id = null
   where id = a;
  update public.ad_campaigns set name = 'Google 0115 renomeada' where id = x;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check115(
    (select developer_id from public.ad_campaigns where id = a) = '7d000000-0000-0000-0000-000001150001',
    'vincular a construtora em campanha sincronizada passa');
  perform pg_temp.check115(
    (select name from public.ad_campaigns where id = x) = 'Google 0115 renomeada',
    'campanha não sincronizada continua editável');
  perform pg_temp.check115(
    (select status from public.ad_campaigns where id = a) = 'ACTIVE'
    and (select external_id from public.ad_campaigns where id = a) = 'camp-0115-a',
    'status e external_id de A continuam os da Meta');
end
$$;

\echo 'OK 0115 meta livro sincronização'
