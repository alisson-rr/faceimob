-- =============================================================================
-- 99 · Correções da conferência da integração Meta Ads (migration 0121)
--
-- O prefixo é de dois dígitos porque o harness só varre
-- `supabase/tests/[0-9][0-9]_*.sql`; a migration coberta é a 0121.
--
-- O arquivo inteiro roda numa transação desfeita no fim: ele vem antes de
-- 99_meta_livro_sincronizacao.sql (ordem alfabética), que confere somas por
-- canal e contagens de TODAS as campanhas. Por isso cada bloco termina com
-- `reset role`: dentro da transação, `set local role` só acaba no rollback.
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. Livro: `authenticated` não grava nem altera linha 'meta_api' (o PATCH de
--      R$ 9.999 "sincronizado da Meta"); planilha direta, a importação sobre
--      dias da API e o sócio continuam passando; corretor leva 42501.
--   2. Importação: arquivo que cobre só parte de uma linha já lançada leva
--      22023 dizendo os dias; 01-31/08 depois de 01-15/08 e um arquivo com uma
--      linha por dia sobre uma linha mensal continuam substituindo.
--   3. Campanha manual homônima com outro ID e planilha na janela: a da Meta
--      não é criada, com conflito (0123; na 0121 era criada sem gasto e
--      o dobro voltava por dois furos, cobertos em 99_meta_homonima); trocado
--      o ID, a manual é adotada e o total fica certo. Homônima sem gasto na
--      janela não bloqueia nada.
--   4. Ação presa em 'executando' há mais de 15 min vira falhou no próximo
--      claim; o claim grava executed_at.
--   5. Execução de IA do cron que morreu é encerrada pela chamada do cron.
--   6. Aviso quando o desfecho muda por UPDATE, e só quando muda.
--   7. Teto do planejador: 20 tentativas por perfil e dia, só service role.
--
-- UUIDs na faixa `…-000001210001+`.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check121(cond boolean, label text)
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
create or replace function pg_temp.become121(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

/** A edge function com a service role. */
create or replace function pg_temp.servico121()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
end;
$$;

/** Payload de meta_sync_apply com uma campanha: 100/dia em agosto, 50/dia em setembro. */
create or replace function pg_temp.payload121(p_ini date, p_fim date, p_ext text, p_nome text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'janela_pedida',  jsonb_build_object('inicio', p_ini, 'fim', p_fim),
    'janela_buscada', jsonb_build_object('inicio', p_ini, 'fim', p_fim),
    'conta', jsonb_build_object(
      'name', 'Conta 0121', 'currency', 'BRL', 'timezone_name', 'America/Sao_Paulo',
      'account_status', 1, 'disable_reason', 0, 'is_prepay', false,
      'amount_spent', 0, 'spend_cap', null, 'prepay_available', null),
    'campanhas', jsonb_build_array(jsonb_build_object(
      'external_id', p_ext, 'name', p_nome, 'status', 'ACTIVE', 'effective_status', 'ACTIVE',
      'daily_budget', 100, 'lifetime_budget', null, 'budget_level', 'campaign',
      'channel', 'formulario', 'developer_suggested_id', null)),
    'insights', (
      select jsonb_agg(jsonb_build_object(
               'external_id', p_ext, 'day', d::date,
               'spend', case when d < date '2026-09-01' then 100 else 50 end,
               'impressions', 100, 'reach', 10, 'clicks', 2, 'link_clicks', 1,
               'leads_form', 0, 'conversations', 0, 'lp_leads', 0, 'lp_views', 0,
               'resultados', 0) order by d)
        from generate_series(p_ini, p_fim, interval '1 day') as d));
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres)
--   Adão = admin · Sara = sócia · Mara = marketing · Caio = corretor · Sofia = SDR
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001210001';
  soc uuid := '00000000-0000-0000-0000-000001210002';
  mkt uuid := '00000000-0000-0000-0000-000001210003';
  cor uuid := '00000000-0000-0000-0000-000001210004';
  sdr uuid := '00000000-0000-0000-0000-000001210005';
  acc uuid := '7f000000-0000-0000-0000-000001210001';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adao@t121.test',  '{"full_name":"Adão Admin 121"}'),
    (soc, 'sara@t121.test',  '{"full_name":"Sara Sócia 121"}'),
    (mkt, 'mara@t121.test',  '{"full_name":"Mara Marketing 121"}'),
    (cor, 'caio@t121.test',  '{"full_name":"Caio Corretor 121"}'),
    (sdr, 'sofia@t121.test', '{"full_name":"Sofia SDR 121"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (soc, 'partner'), (mkt, 'marketing'), (cor, 'broker'), (sdr, 'sdr')
  on conflict do nothing;

  insert into public.meta_ad_accounts (id, act_id, name, timezone_name, enabled)
  values (acc, 'act_1210001', 'Conta 0121', 'America/Sao_Paulo', true);

  insert into public.ad_campaigns (id, external_id, platform, name, total_spend, meta_account_id) values
    ('7e000000-0000-0000-0000-000001210001', 'camp-0121-p',       'meta', 'Planilha 0121',     0, null),
    ('7e000000-0000-0000-0000-000001210002', 'camp-0121-q',       'meta', 'API 0121',          0, acc),
    ('7e000000-0000-0000-0000-000001210003', 'camp-0121-v',       'meta', 'Recortes 0121',     0, null),
    ('7e000000-0000-0000-0000-000001210004', 'camp-0121-w',       'meta', 'Mensal 0121',       0, null),
    ('7e000000-0000-0000-0000-000001210005', 'lancamento-x-0121', 'meta', 'Lançamento X 0121', 0, null),
    ('7e000000-0000-0000-0000-000001210006', 'camp-0121-d',       'meta', 'Diária 0121',       0, null),
    ('7e000000-0000-0000-0000-000001210007', 'homonima-0121',     'meta', 'Homônima 0121',     0, null);

  -- Dias de Q como a sincronização grava: um por linha, procedência meta_api.
  insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend, source)
  select '7e000000-0000-0000-0000-000001210002', d::date, d::date, 10, 'meta_api'
    from generate_series(date '2026-08-01', date '2026-08-05', interval '1 day') as d;
end
$$;

\echo '== 1. livro: authenticated só grava e altera linha de planilha =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000001210002';
  mkt uuid := '00000000-0000-0000-0000-000001210003';
  cor uuid := '00000000-0000-0000-0000-000001210004';
  p   uuid := '7e000000-0000-0000-0000-000001210001';
  q   uuid := '7e000000-0000-0000-0000-000001210002';
  n   bigint;
  a   record;
begin
  set local role authenticated;
  perform pg_temp.become121(mkt);

  -- O PATCH do cenário da conferência: a policy de UPDATE não alcança a linha.
  update public.ad_campaign_spend set spend = 9999 where campaign_id = q;
  get diagnostics n = row_count;
  perform pg_temp.check121(n = 0, format('PATCH em linha meta_api não casa linha nenhuma (casou %s)', n));

  begin
    insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend, source)
    values (q, '2026-08-10', '2026-08-10', 9999, 'meta_api');
    raise exception 'FALHOU: marketing gravou linha meta_api direto';
  exception when insufficient_privilege then
    raise notice '  ok  POST de linha meta_api pelo PostgREST leva 42501';
  end;

  -- Planilha direta continua entrando (é o caminho do 99_import_relatorio_meta, bloco 7).
  insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend)
  values (p, '2026-07-01', '2026-07-31', 100);
  begin
    update public.ad_campaign_spend set source = 'meta_api' where campaign_id = p;
    raise exception 'FALHOU: linha de planilha virou meta_api por update';
  exception when insufficient_privilege then
    raise notice '  ok  virar uma linha de planilha em meta_api leva 42501';
  end;
  update public.ad_campaign_spend set spend = 120 where campaign_id = p;
  get diagnostics n = row_count;
  perform pg_temp.check121(n = 1, 'corrigir o valor de uma linha de planilha continua passando');

  -- A planilha sobre dias da API: o DELETE segue aberto para a importação.
  select * into a from public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001210002","period_start":"2026-08-01","period_end":"2026-08-31","spend":500}
  ]$j$, 'agosto-0121.csv');
  perform pg_temp.check121(a.linhas = 1 and a.substituidas = 5,
    format('a planilha substitui os 5 dias da API (saíram %s)', a.substituidas));

  perform pg_temp.become121(soc);
  select * into a from public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001210001","period_start":"2026-09-01","period_end":"2026-09-30","spend":30}
  ]$j$, 'setembro-0121.csv');
  perform pg_temp.check121(a.linhas = 1, 'o sócio importa (administrador para a regra)');

  perform pg_temp.become121(cor);
  begin
    insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend)
    values (p, '2026-10-01', '2026-10-31', 1);
    raise exception 'FALHOU: corretor gravou no livro';
  exception when insufficient_privilege then
    raise notice '  ok  corretor leva 42501 ao gravar planilha direto';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check121(
    not exists (select 1 from public.ad_campaign_spend where campaign_id = q and (spend = 9999 or source = 'meta_api'))
    and (select total_spend from public.ad_campaigns where id = q) = 500,
    'Q fica só com a planilha de agosto, 500, e nenhum 9.999');
  perform pg_temp.check121(
    not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'ad_campaign_spend' and cmd = 'ALL'),
    'não sobra policy for all no livro');
end
$$;

\echo '== 2. importação: recorte que cobre só parte de uma linha é recusado =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001210003';
  v   uuid := '7e000000-0000-0000-0000-000001210003';
  w   uuid := '7e000000-0000-0000-0000-000001210004';
  d   uuid := '7e000000-0000-0000-0000-000001210006';
  a   record;
  msg text;
begin
  set local role authenticated;
  perform pg_temp.become121(mkt);

  perform public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001210003","period_start":"2026-07-25","period_end":"2026-08-15","spend":700},
    {"campaign_id":"7e000000-0000-0000-0000-000001210003","period_start":"2026-08-16","period_end":"2026-08-20","spend":50}
  ]$j$, 'v-0121.csv');

  -- O cenário da conferência: 10-18/08 apagava as duas linhas e 16 dias sumiam.
  begin
    perform public.marketing_import_ad_spend($j$[
      {"campaign_id":"7e000000-0000-0000-0000-000001210003","period_start":"2026-08-10","period_end":"2026-08-18","spend":90}
    ]$j$, 'v-recorte-0121.csv');
    raise exception 'FALHOU: recorte parcial apagou dias fora do arquivo';
  exception when invalid_parameter_value then
    msg := sqlerrm;
  end;
  perform pg_temp.check121(
    -- A 0123 trocou "entre <min> e <max>" pelos intervalos reais.
    msg like 'Recortes 0121:%' and msg like '%16 dia(s) ficariam sem gasto: 25/07/2026 a 09/08/2026.%',
    format('recorte parcial leva 22023 dizendo a campanha e os dias que se perderiam (%s)', msg));
  perform pg_temp.check121(
    (select total_spend from public.ad_campaigns where id = v) = 750
    and (select count(*) from public.ad_campaign_spend where campaign_id = v) = 2,
    'e nada muda: o total continua 750, com as duas linhas');

  -- O caso legítimo da 0113: 01-31/08 depois de 01-15/08.
  perform public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001210004","period_start":"2026-08-01","period_end":"2026-08-15","spend":400}
  ]$j$, 'w-quinzena.csv');
  select * into a from public.marketing_import_ad_spend($j$[
    {"campaign_id":"7e000000-0000-0000-0000-000001210004","period_start":"2026-08-01","period_end":"2026-08-31","spend":900}
  ]$j$, 'w-mes.csv');
  perform pg_temp.check121(a.substituidas = 1 and (select total_spend from public.ad_campaigns where id = w) = 900,
    'o mês inteiro substitui a quinzena');

  -- Arquivo com uma linha por dia sobre uma linha mensal: a soma das linhas
  -- cobre o mês; faltando um dia, é recusado.
  perform public.marketing_import_ad_spend(jsonb_build_array(jsonb_build_object(
    'campaign_id', d, 'period_start', '2026-08-01', 'period_end', '2026-08-31', 'spend', 310)), 'd-mes.csv');
  msg := null;
  begin
    perform public.marketing_import_ad_spend(
      (select jsonb_agg(jsonb_build_object('campaign_id', d, 'period_start', x::date, 'period_end', x::date, 'spend', 12))
         from generate_series(date '2026-08-01', date '2026-08-30', interval '1 day') as x), 'd-dias-sem-31.csv');
  exception when invalid_parameter_value then
    msg := sqlerrm;
  end;
  perform pg_temp.check121(msg like '%1 dia(s) ficariam sem gasto: 31/08/2026.%',
    format('arquivo diário sem o dia 31 é recusado sobre a linha mensal (%s)', msg));
  select * into a from public.marketing_import_ad_spend(
    (select jsonb_agg(jsonb_build_object('campaign_id', d, 'period_start', x::date, 'period_end', x::date, 'spend', 12))
       from generate_series(date '2026-08-01', date '2026-08-31', interval '1 day') as x), 'd-dias.csv');
  perform pg_temp.check121(a.linhas = 31 and a.substituidas = 1
    and (select total_spend from public.ad_campaigns where id = d) = 372,
    'com os 31 dias, a linha mensal dá lugar aos dias (total 372)');
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 3. campanha manual homônima com outro ID: sem dupla contagem =='

do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001210003';
  acc uuid := '7f000000-0000-0000-0000-000001210001';
  mx  uuid := '7e000000-0000-0000-0000-000001210005';
  hn  uuid := '7e000000-0000-0000-0000-000001210007';
  run uuid;
  nova uuid;
  r   jsonb;
begin
  -- A planilha sem coluna de ID casou pelo nome com a manual de ID errado.
  set local role authenticated;
  perform pg_temp.become121(mkt);
  perform public.marketing_import_ad_spend(jsonb_build_array(
    jsonb_build_object('campaign_id', mx, 'period_start', '2026-08-01', 'period_end', '2026-08-31', 'spend', 3100),
    jsonb_build_object('campaign_id', hn, 'period_start', '2026-06-01', 'period_end', '2026-06-30', 'spend', 900)),
    'agosto-sem-id-0121.csv');
  reset role;

  -- A Meta devolve o mesmo nome em outra caixa, sem acento e com espaço.
  set local role service_role;
  perform pg_temp.servico121();
  run := public.meta_sync_start(acc, 'manual', null);
  r := public.meta_sync_apply(run, pg_temp.payload121(date '2026-08-01', date '2026-09-11', '121000999', '  LANCAMENTO x 0121 '));
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- 0123: a da Meta não nasce ao lado (antes nascia sem gasto, e o dobro
  -- voltava quando a manual recebia planilha depois).
  select id into nova from public.ad_campaigns where external_id = '121000999';
  perform pg_temp.check121((r->>'campanhas_criadas')::int = 0 and nova is null,
    'a campanha da Meta não é criada (nem adotada pelo nome)');
  perform pg_temp.check121(
    jsonb_array_length(r->'conflitos') = 1
    and r->'conflitos'->>0 = '121000999: a campanha Lançamento X 0121 já tem gasto lançado à mão com o ID externo lancamento-x-0121. Troque o ID externo dela para 121000999 e a próxima sincronização passa a atualizá-la.',
    format('o conflito diz qual manual e para qual ID trocar (%s)', r->'conflitos'));
  perform pg_temp.check121(
    (select total_spend from public.ad_campaigns where id = mx) = 3100
    and (select count(*) from public.ad_campaign_spend where campaign_id = mx) = 1,
    'nenhum gasto gravado: 3.100 (a planilha), e não 6.750');

  -- Seguido o conflito: a manual recebe o ID da Meta.
  set local role authenticated;
  perform pg_temp.become121(mkt);
  update public.ad_campaigns set external_id = '121000999' where id = mx;
  reset role;

  set local role service_role;
  perform pg_temp.servico121();
  run := public.meta_sync_start(acc, 'manual', null);
  r := public.meta_sync_apply(run, pg_temp.payload121(date '2026-08-01', date '2026-09-11', '121000999', 'Lançamento X 0121'));

  -- Homônima sem gasto na janela: nada a proteger, a da Meta grava o gasto.
  run := public.meta_sync_start(acc, 'manual', null);
  perform public.meta_sync_apply(run, pg_temp.payload121(date '2026-09-01', date '2026-09-11', '121000777', 'Homonima 0121'));
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check121(jsonb_array_length(r->'conflitos') = 0 and (r->>'campanhas_atualizadas')::int = 1,
    format('a manual corrigida é adotada, sem conflito (%s)', r));
  perform pg_temp.check121(
    (select total_spend from public.ad_campaigns where id = mx) = 3650
    and (select meta_account_id from public.ad_campaigns where id = mx) = acc
    and (select count(*) from public.ad_campaign_spend where campaign_id = mx) = 42,
    'e o total fica certo: agosto 3.100 + setembro 550, dia a dia');
  perform pg_temp.check121(
    (select total_spend from public.ad_campaigns where external_id = '121000777') = 550
    and (select total_spend from public.ad_campaigns where id = hn) = 900,
    'homônima com gasto fora da janela não bloqueia a da Meta');
end
$$;

\echo '== 4. ação presa em executando vira falhou no próximo claim =='

do $$
declare
  acc     uuid := '7f000000-0000-0000-0000-000001210001';
  velha   uuid := '7a000000-0000-0000-0000-000001210001';
  legado  uuid := '7a000000-0000-0000-0000-000001210002';
  recente uuid := '7a000000-0000-0000-0000-000001210003';
  aprov   uuid := '7a000000-0000-0000-0000-000001210004';
  c       jsonb;
  v       record;
begin
  insert into public.meta_actions
    (id, account_id, campaign_external_id, campaign_name, origem, acao, status, decided_at, executed_at)
  values
    (velha,   acc, 'camp-0121-q', 'API 0121', 'manual', 'pausar', 'executando',
       clock_timestamp() - interval '1 hour', clock_timestamp() - interval '20 minutes'),
    -- Presa antes da 0121, sem o carimbo do claim.
    (legado,  acc, 'camp-0121-q', 'API 0121', 'manual', 'ativar', 'executando',
       clock_timestamp() - interval '1 hour', null),
    (recente, acc, 'camp-0121-q', 'API 0121', 'manual', 'pausar', 'executando',
       clock_timestamp() - interval '1 hour', clock_timestamp() - interval '5 minutes'),
    (aprov,   acc, 'camp-0121-q', 'API 0121', 'manual', 'ativar', 'aprovada',
       clock_timestamp() - interval '1 hour', null);

  set local role service_role;
  perform pg_temp.servico121();
  c := public.meta_action_claim(aprov);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_actions where id = velha;
  perform pg_temp.check121(v.status = 'falhou'
    and v.erro = 'Interrompida no meio: confira no Gerenciador, pode ter sido aplicada em parte',
    format('a de 20 min vira falhou, avisando que pode ter sido aplicada em parte (%s)', v.status));
  perform pg_temp.check121((select status from public.meta_actions where id = legado) = 'falhou',
    'a presa antes da 0121, sem executed_at, também sai');
  perform pg_temp.check121((select status from public.meta_actions where id = recente) = 'executando',
    'a de 5 min continua em execução');
  select * into v from public.meta_actions where id = aprov;
  perform pg_temp.check121(c is not null and v.status = 'executando'
    and v.executed_at > clock_timestamp() - interval '1 minute',
    'o claim grava executed_at: é o marco dos 15 min');
end
$$;

\echo '== 5. execução de IA do cron que morreu é encerrada pelo cron =='

do $$
declare
  acc   uuid := '7f000000-0000-0000-0000-000001210001';
  morta uuid := '7b000000-0000-0000-0000-000001210001';
  rr    record;
  v     record;
begin
  insert into public.meta_ai_runs (id, kind, account_id, trigger, status, started_at)
  values (morta, 'gestor', acc, 'cron', 'rodando', clock_timestamp() - interval '20 minutes');

  set local role service_role;
  perform pg_temp.servico121();
  select * into rr from public.meta_ai_run_start('gestor', acc, 'cron', '{}');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into v from public.meta_ai_runs where id = morta;
  perform pg_temp.check121(rr.reused and rr.run_id = morta,
    'o cron do mesmo dia continua recebendo a execução do dia (uma por dia)');
  perform pg_temp.check121(v.status = 'falhou' and v.error like 'Interrompida%' and v.finished_at is not null,
    format('mas ela sai de rodando: a tela não mostra "rodando" para sempre (%s)', v.status));
end
$$;

\echo '== 6. aviso quando o desfecho muda por UPDATE, e só quando muda =='

do $$
declare
  sdr    uuid := '00000000-0000-0000-0000-000001210005';
  v_grp  uuid;
  v_lead uuid;
  v_conv uuid;
begin
  -- Grupo sem ninguém: o lead não vai para a roleta de outro arquivo.
  insert into public.distribution_groups (name, slug, kind, active)
  values ('Parado 121', 'parado-121', 'specific', true)
  returning id into v_grp;
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Audio 121', '11900121001', v_grp)
  returning id into v_lead;
  -- Sem sessão, o carimbo sai nulo: conversa humana sem dono, avisa o SDR.
  insert into public.sdr_conversations (lead_id, status) values (v_lead, 'human')
  returning id into v_conv;

  -- A reserva do áudio, antes de baixar: 'sdr_turn' não avisa.
  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, lead_id, conversation_id, outcome, media_type, detail)
  values ('wamid.0121.audio', '5511900121001', v_lead, v_conv, 'sdr_turn', 'audio', 'áudio em processamento');
  perform pg_temp.check121(
    not exists (select 1 from public.notifications where body like '5511900121001%'),
    'a reserva do áudio não avisa ninguém');

  update public.whatsapp_inbound_messages
     set outcome = 'audio_falhou', detail = 'a transcrição falhou'
   where provider_message_id = 'wamid.0121.audio';
  perform pg_temp.check121(
    exists (select 1 from public.notifications
             where profile_id = sdr and kind = 'whatsapp_human_turn' and body like '5511900121001%'),
    'a reserva finalizada por UPDATE para audio_falhou toca o sino do SDR');

  -- Sem os avisos, a janela de repetição não esconde um disparo a mais.
  delete from public.notifications where body like '5511900121001%';
  update public.whatsapp_inbound_messages
     set outcome = 'audio_falhou', detail = 'regravado'
   where provider_message_id = 'wamid.0121.audio';
  update public.whatsapp_inbound_messages
     set handled_at = now()
   where provider_message_id = 'wamid.0121.audio';
  perform pg_temp.check121(
    not exists (select 1 from public.notifications where body like '5511900121001%'),
    'UPDATE que não muda o desfecho não avisa de novo');
end
$$;

\echo '== 7. teto do planejador: 20 tentativas por perfil e dia =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000001210002';
  mkt uuid := '00000000-0000-0000-0000-000001210003';
  i   int;
  sim int := 0;
  vigesima_primeira boolean;
  outro boolean;
  n   bigint;
begin
  perform pg_temp.check121(
    has_function_privilege('service_role', 'public.meta_plano_tentativa_registrar(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.meta_plano_tentativa_registrar(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.meta_plano_tentativa_registrar(uuid)', 'execute'),
    'só a service role registra tentativa');
  perform pg_temp.check121(
    (select p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
       from pg_proc p where p.oid = 'public.meta_plano_tentativa_registrar(uuid)'::regprocedure),
    'security definer com search_path fixo');

  -- Tentativas de ontem não contam no dia de hoje.
  insert into public.meta_plano_tentativas (profile_id, dia)
  select mkt, (now() at time zone 'America/Sao_Paulo')::date - 1 from generate_series(1, 5);

  set local role service_role;
  perform pg_temp.servico121();
  for i in 1..20 loop
    if public.meta_plano_tentativa_registrar(mkt) then
      sim := sim + 1;
    end if;
  end loop;
  vigesima_primeira := public.meta_plano_tentativa_registrar(mkt);
  outro := public.meta_plano_tentativa_registrar(soc);
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check121(sim = 20, format('as 20 primeiras do dia passam (passaram %s)', sim));
  perform pg_temp.check121(not vigesima_primeira, 'a 21ª devolve false');
  perform pg_temp.check121(
    (select count(*) from public.meta_plano_tentativas
      where profile_id = mkt and dia = (now() at time zone 'America/Sao_Paulo')::date) = 20,
    'a recusada não é registrada');
  perform pg_temp.check121(outro, 'o teto é por perfil');

  set local role authenticated;
  perform pg_temp.become121(mkt);
  select count(*) into n from public.meta_plano_tentativas;
  perform pg_temp.check121(n = 0, format('authenticated não lê as tentativas (RLS sem policy; viu %s)', n));
  begin
    insert into public.meta_plano_tentativas (profile_id) values (mkt);
    raise exception 'FALHOU: authenticated gravou tentativa';
  exception when insufficient_privilege then
    raise notice '  ok  insert direto leva 42501';
  end;
  begin
    perform public.meta_plano_tentativa_registrar(mkt);
    raise exception 'FALHOU: authenticated chamou o registro de tentativa';
  exception when insufficient_privilege then
    raise notice '  ok  meta_plano_tentativa_registrar não é chamável por authenticated';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

rollback;

\echo 'OK 0121 correções da Meta'
