-- =============================================================================
-- 99 · Campanha homônima com gasto em uma linha só, e apoio ao áudio e ao
--      planejador (migrations 0123 e 0124)
--
-- Roda numa transação desfeita no fim, como o 99_meta_correcoes: vem antes de
-- 99_meta_livro_sincronizacao.sql, que confere somas e contagens de todas as
-- campanhas. Cada bloco termina com `reset role`.
--
-- O que cada bloco defende, e o que quebra sem ele:
--   A. Furo (a) da 0121: a manual homônima recebe planilha DEPOIS que a da
--      Meta já tem gasto da API de dias fora da janela diária. Sem o gatilho, a
--      soma das duas vira 6.750 contra 3.650 reais.
--   B. Furo (b): planilha de setembro na manual depois da da Meta ter setembro
--      (2.600 contra 2.100 na conferência). Agora é recusada na entrada.
--   C. Porta da sincronização: manual homônima com planilha na janela impede a
--      criação da campanha da Meta; trocado o ID, a adoção acerta o total.
--   D. Legado da 0121 (a criada já existe): nada é gravado e o conflito manda
--      apagar a criada antes de trocar o ID.
--   E. Recusa por perda de dias lista os intervalos reais.
--   F. Duas linhas do mesmo arquivo que se cruzam na mesma campanha.
--   G. whatsapp_inbound_messages.reserved_at e os índices do áudio.
--   H. meta_plano_tentativas_hoje().
--   I. Planilha × planilha (0124): o plano B na sincronizada apaga os dias da
--      API e a manual homônima recebia a mesma planilha, 6.650 contra 3.550.
--      E o outro sentido: plano B na sincronizada sobre dias da manual.
--   J. Falso positivo (0124): duas campanhas reais da Meta de mesmo nome, ambas
--      sincronizadas, recusavam o plano B uma por causa da outra.
--   K. Conta de anúncios com campanha não se apaga (0125): apagar zerava o
--      meta_account_id, a sincronizada virava "manual" e manual × manual não se
--      compara. E o gatilho entra em fila pelo nome antes de comparar — a
--      corrida em si precisa de duas sessões e foi provada fora daqui; o assert
--      só impede que a trava seja removida sem ninguém notar.
--
-- A e B conferem a mensagem de 0124: o lado oposto pode ter planilha (plano
-- B), então ela não fala mais em "gasto sincronizado".
--
-- UUIDs na faixa `…-000001230001+`.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check123(cond boolean, label text)
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
create or replace function pg_temp.become123(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

/** Payload de meta_sync_apply com uma campanha: 100/dia em agosto, 50/dia em setembro. */
create or replace function pg_temp.payload123(p_ini date, p_fim date, p_ext text, p_nome text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'janela_pedida',  jsonb_build_object('inicio', p_ini, 'fim', p_fim),
    'janela_buscada', jsonb_build_object('inicio', p_ini, 'fim', p_fim),
    'conta', jsonb_build_object(
      'name', 'Conta 0123', 'currency', 'BRL', 'timezone_name', 'America/Sao_Paulo',
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

/** Uma sincronização como a edge faz, com a service role. */
create or replace function pg_temp.sync123(p_ini date, p_fim date, p_ext text, p_nome text)
returns jsonb
language plpgsql
as $$
declare
  run uuid;
  r   jsonb;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  run := public.meta_sync_start('7f000000-0000-0000-0000-000001230001', 'manual', null);
  r := public.meta_sync_apply(run, pg_temp.payload123(p_ini, p_fim, p_ext, p_nome));
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', false);
  return r;
end;
$$;

/** Importa como marketing; devolve null se passou, ou a mensagem do 22023. */
create or replace function pg_temp.importa123(p_rows jsonb)
returns text
language plpgsql
as $$
declare
  msg text;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.become123('00000000-0000-0000-0000-000001230003');
  begin
    perform public.marketing_import_ad_spend(p_rows, 'arquivo-0123.csv');
  exception when invalid_parameter_value then
    msg := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', false);
  return msg;
end;
$$;

create or replace function pg_temp.lin123(p_c uuid, p_de text, p_ate text, p_spend numeric)
returns jsonb
language sql
as $$
  select jsonb_build_object('campaign_id', p_c, 'period_start', p_de, 'period_end', p_ate, 'spend', p_spend);
$$;

create or replace function pg_temp.total123(p_ids uuid[])
returns numeric
language sql
as $$
  select coalesce(sum(total_spend), 0) from public.ad_campaigns where id = any (p_ids);
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres)
--   Adão = admin · Mara = marketing · Sofia = SDR · Sara = sócia
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001230001';
  soc uuid := '00000000-0000-0000-0000-000001230002';
  mkt uuid := '00000000-0000-0000-0000-000001230003';
  sdr uuid := '00000000-0000-0000-0000-000001230004';
  acc uuid := '7f000000-0000-0000-0000-000001230001';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adao@t123.test',  '{"full_name":"Adão Admin 123"}'),
    (soc, 'sara@t123.test',  '{"full_name":"Sara Sócia 123"}'),
    (mkt, 'mara@t123.test',  '{"full_name":"Mara Marketing 123"}'),
    (sdr, 'sofia@t123.test', '{"full_name":"Sofia SDR 123"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (soc, 'partner'), (mkt, 'marketing'), (sdr, 'sdr')
  on conflict do nothing;

  insert into public.meta_ad_accounts (id, act_id, name, timezone_name, enabled)
  values (acc, 'act_1230001', 'Conta 0123', 'America/Sao_Paulo', true);

  insert into public.ad_campaigns (id, external_id, platform, name, total_spend, meta_account_id) values
    ('7e000000-0000-0000-0000-000001230001', 'residencial-y-0123', 'meta', 'Residencial Y 0123',  0, null),
    ('7e000000-0000-0000-0000-000001230002', 'vila-z-0123',        'meta', 'Vila Z 0123',         0, null),
    ('7e000000-0000-0000-0000-000001230003', 'lancamento-w-0123',  'meta', 'Lançamento W 0123',   0, null),
    ('7e000000-0000-0000-0000-000001230004', 'legado-v-0123',      'meta', 'Legado V 0123',       0, null),
    -- A que a 0121 criava ao lado da manual, sem gasto.
    ('7e000000-0000-0000-0000-000001230005', '120666123',          'meta', 'Legado V 0123',       0, acc),
    ('7e000000-0000-0000-0000-000001230006', 'parcial-0123',       'meta', 'Parcial 0123',        0, null),
    ('7e000000-0000-0000-0000-000001230007', 'cruza-0123',         'meta', 'Cruza 0123',          0, null),
    ('7e000000-0000-0000-0000-000001230008', 'alfa-q-0123',        'meta', 'Alfa Q 0123',         0, null),
    ('7e000000-0000-0000-0000-000001230009', 'alfa-q-google-0123', 'google', 'Alfa Q 0123',       0, null);
end
$$;

\echo '== A. furo (a): planilha na manual depois da da Meta ter gasto da API =='

do $$
declare
  my   uuid := '7e000000-0000-0000-0000-000001230001';
  mkt  uuid := '00000000-0000-0000-0000-000001230003';
  meta uuid;
  r    jsonb;
  msg  text;
begin
  -- Manual sem gasto: a da Meta é criada e é a fonte verdadeira.
  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120888123', '  RESIDENCIAL Y 0123 ');
  select id into meta from public.ad_campaigns where external_id = '120888123';
  perform pg_temp.check123((r->>'campanhas_criadas')::int = 1 and jsonb_array_length(r->'conflitos') = 0
    and pg_temp.total123(array[meta]) = 3650,
    format('homônima sem gasto não bloqueia: a da Meta nasce com 3.650 (%s)', r));

  -- O relatório de agosto sem coluna de ID, casado com a manual pelo nome.
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(my, '2026-08-01', '2026-08-31', 3100)));
  perform pg_temp.check123(
    msg = 'Residencial Y 0123: a campanha RESIDENCIAL Y 0123 (ID externo 120888123), de mesmo nome e sincronizada com a Meta, já tem gasto em 01/08/2026 a 31/08/2026. Lançar a planilha aqui contaria esses dias duas vezes: tire-os do arquivo ou importe-os na campanha 120888123.',
    format('a planilha na manual leva 22023 dizendo qual campanha e quais dias (%s)', msg));

  -- A outra porta: INSERT direto pelo PostgREST.
  set local role authenticated;
  perform pg_temp.become123(mkt);
  begin
    insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend)
    values (my, '2026-08-10', '2026-08-12', 300);
    raise exception 'FALHOU: INSERT direto de planilha sobre dias da API da homônima passou';
  exception when invalid_parameter_value then
    raise notice '  ok  INSERT direto de planilha na manual também leva 22023';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- A sincronização diária seguinte (01/09 a 11/09) não vê agosto; antes, a
  -- soma das duas ficava 6.750.
  r := pg_temp.sync123('2026-09-01', '2026-09-11', '120888123', 'RESIDENCIAL Y 0123');
  perform pg_temp.check123(pg_temp.total123(array[my, meta]) = 3650
    and not exists (select 1 from public.ad_campaign_spend where campaign_id = my),
    format('as duas somam 3.650, não 6.750 (%s)', pg_temp.total123(array[my, meta])));

  -- O que continua passando: dias que a da Meta não tem, e a planilha na
  -- própria campanha da Meta (o plano B quando a sincronização quebra).
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(my, '2026-07-01', '2026-07-31', 700)));
  perform pg_temp.check123(msg is null and pg_temp.total123(array[my]) = 700,
    format('planilha na manual em dias sem gasto da API passa (%s)', msg));
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(meta, '2026-08-01', '2026-08-31', 3000)));
  perform pg_temp.check123(msg is null and pg_temp.total123(array[meta]) = 3550,
    format('planilha na campanha da Meta troca os dias da API (%s)', msg));
end
$$;

\echo '== B. furo (b): planilha de setembro na manual depois da da Meta ter setembro =='

do $$
declare
  mz   uuid := '7e000000-0000-0000-0000-000001230002';
  meta uuid;
  r    jsonb;
  msg  text;
begin
  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120777123', 'Vila Z 0123');
  select id into meta from public.ad_campaigns where external_id = '120777123';

  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(mz, '2026-09-01', '2026-09-10', 500)));
  perform pg_temp.check123(msg like 'Vila Z 0123: a campanha Vila Z 0123 (ID externo 120777123), de mesmo nome e sincronizada com a Meta, já tem gasto em 01/09/2026 a 10/09/2026.%',
    format('planilha de setembro na manual leva 22023 (%s)', msg));

  r := pg_temp.sync123('2026-09-01', '2026-09-11', '120777123', 'Vila Z 0123');
  perform pg_temp.check123(jsonb_array_length(r->'conflitos') = 0
    and pg_temp.total123(array[mz, meta]) = 3650
    and not exists (select 1 from public.ad_campaign_spend where campaign_id = mz),
    format('as duas somam o real, 3.650, e a manual fica sem gasto (%s)', pg_temp.total123(array[mz, meta])));
end
$$;

\echo '== C. porta da sincronização: manual com planilha na janela =='

do $$
declare
  mw  uuid := '7e000000-0000-0000-0000-000001230003';
  acc uuid := '7f000000-0000-0000-0000-000001230001';
  mkt uuid := '00000000-0000-0000-0000-000001230003';
  r   jsonb;
  msg text;
begin
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(mw, '2026-08-01', '2026-08-31', 3100)));
  perform pg_temp.check123(msg is null, format('a planilha entra na manual antes de existir a da Meta (%s)', msg));

  -- A Meta devolve o mesmo nome em outra caixa, sem acento e com espaço.
  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120999123', '  LANCAMENTO w 0123 ');
  perform pg_temp.check123((r->>'campanhas_criadas')::int = 0
    and not exists (select 1 from public.ad_campaigns where external_id = '120999123'),
    'a campanha da Meta não é criada ao lado da manual');
  perform pg_temp.check123(jsonb_array_length(r->'conflitos') = 1
    and r->'conflitos'->>0 = '120999123: a campanha Lançamento W 0123 já tem gasto lançado à mão com o ID externo lancamento-w-0123. Troque o ID externo dela para 120999123 e a próxima sincronização passa a atualizá-la.',
    format('um conflito só, dizendo para qual ID trocar (%s)', r->'conflitos'));
  perform pg_temp.check123(pg_temp.total123(array[mw]) = 3100
    and (select count(*) from public.ad_campaign_spend where campaign_id = mw) = 1,
    'nenhum gasto gravado: agosto conta uma vez, 3.100 da planilha');

  -- Seguido o conflito: só a troca do ID, nada a apagar.
  set local role authenticated;
  perform pg_temp.become123(mkt);
  update public.ad_campaigns set external_id = '120999123' where id = mw;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120999123', 'Lançamento W 0123');
  perform pg_temp.check123(jsonb_array_length(r->'conflitos') = 0 and (r->>'campanhas_atualizadas')::int = 1
    and (select meta_account_id from public.ad_campaigns where id = mw) = acc,
    format('a manual com o ID trocado é adotada (%s)', r));
  perform pg_temp.check123(pg_temp.total123(array[mw]) = 3650
    and (select count(*) from public.ad_campaign_spend where campaign_id = mw) = 42,
    'e o total fica certo: 3.650, dia a dia');
end
$$;

\echo '== D. legado da 0121: a criada ao lado já existe =='

do $$
declare
  mv    uuid := '7e000000-0000-0000-0000-000001230004';
  criada uuid := '7e000000-0000-0000-0000-000001230005';
  r     jsonb;
  msg   text;
begin
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(mv, '2026-08-01', '2026-08-31', 3100)));
  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120666123', 'Legado V 0123');
  perform pg_temp.check123(msg is null and jsonb_array_length(r->'conflitos') = 1
    and r->'conflitos'->>0 = '120666123: a campanha Legado V 0123 já tem gasto lançado à mão com o ID externo legado-v-0123. Troque o ID externo dela para 120666123 e a próxima sincronização passa a atualizá-la. Antes, apague a campanha 120666123 criada pela sincronização: o ID externo é único.',
    format('o conflito manda apagar a criada antes de trocar o ID (%s)', r->'conflitos'));
  perform pg_temp.check123(
    not exists (select 1 from public.ad_campaign_spend where campaign_id = criada)
    and not exists (select 1 from public.meta_campaign_insights_daily where campaign_id = criada)
    and pg_temp.total123(array[mv, criada]) = 3100,
    'e a criada continua sem gasto: agosto conta uma vez');
end
$$;

\echo '== E. perda de dias: a mensagem lista os intervalos reais =='

do $$
declare
  pc    uuid := '7e000000-0000-0000-0000-000001230006';
  antes text;
  msg   text;
begin
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(pc, '2026-08-01', '2026-08-31', 3100)));
  select string_agg(format('%s|%s|%s', period_start, period_end, spend), ';') into antes
    from public.ad_campaign_spend where campaign_id = pc;

  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(pc, '2026-08-10', '2026-08-20', 1100)));
  perform pg_temp.check123(
    msg = 'Parcial 0123: o arquivo cobre só parte do gasto já lançado de 01/08/2026 a 31/08/2026, e 20 dia(s) ficariam sem gasto: 01/08/2026 a 09/08/2026, 21/08/2026 a 31/08/2026. Importe um arquivo que cubra de 01/08/2026 a 31/08/2026 inteiro.',
    format('os dois pedaços perdidos aparecem, não só o mínimo e o máximo (%s)', msg));
  perform pg_temp.check123(
    (select string_agg(format('%s|%s|%s', period_start, period_end, spend), ';')
       from public.ad_campaign_spend where campaign_id = pc) = antes,
    'e o livro não muda');
  perform pg_temp.check123(
    public.faixas_de_dias(array[date '2026-08-05', date '2026-08-03', date '2026-08-04', date '2026-08-09', date '2026-08-04'])
      = '03/08/2026 a 05/08/2026, 09/08/2026',
    'faixas_de_dias agrupa consecutivos, fora de ordem e repetidos; dia solto sai sozinho');
end
$$;

\echo '== F. duas linhas do mesmo arquivo que se cruzam =='

do $$
declare
  cc  uuid := '7e000000-0000-0000-0000-000001230007';
  msg text;
begin
  -- O cenário da conferência: o delete da segunda apagava a primeira e 9 dias sumiam.
  msg := pg_temp.importa123(jsonb_build_array(
    pg_temp.lin123(cc, '2026-08-01', '2026-08-20', 2000),
    pg_temp.lin123(cc, '2026-08-10', '2026-08-31', 2200)));
  perform pg_temp.check123(
    msg = 'Cruza 0123: o arquivo traz dois períodos que se cruzam (01/08/2026 a 20/08/2026 e 10/08/2026 a 31/08/2026). Cada dia entra numa linha só: junte as linhas ou corrija as datas.',
    format('arquivo com períodos que se cruzam leva 22023 (%s)', msg));
  perform pg_temp.check123(not exists (select 1 from public.ad_campaign_spend where campaign_id = cc),
    'e nada é gravado');

  msg := pg_temp.importa123(jsonb_build_array(
    pg_temp.lin123(cc, '2026-08-01', '2026-08-15', 1500),
    pg_temp.lin123(cc, '2026-08-16', '2026-08-31', 1600)));
  perform pg_temp.check123(msg is null and pg_temp.total123(array[cc]) = 3100,
    format('quinzenas vizinhas continuam passando (%s)', msg));
end
$$;

\echo '== G. reserva do áudio: reserved_at e índices =='

do $$
declare
  sdr uuid := '00000000-0000-0000-0000-000001230004';
  v   record;
begin
  perform pg_temp.check123(
    (select is_nullable = 'NO' and column_default = 'now()'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'whatsapp_inbound_messages' and column_name = 'reserved_at'),
    'reserved_at é not null com default now()');

  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, outcome, media_type, detail)
  values ('wamid.0123.audio', '5511900123001', 'sdr_turn', 'audio', 'áudio em processamento')
  returning reserved_at, created_at into v;
  perform pg_temp.check123(v.reserved_at is not null, 'a reserva sem reserved_at explícito ganha a hora do insert');

  perform pg_temp.check123(
    (select pg_get_indexdef(i.indexrelid) like '%(from_phone, media_type, created_at)'
       from pg_index i where i.indexrelid = 'public.whatsapp_inbound_teto_audio_idx'::regclass),
    'índice do teto: (from_phone, media_type, created_at)');
  perform pg_temp.check123(
    (select pg_get_indexdef(i.indexrelid) like '%(reserved_at) WHERE (detail ~~ ''áudio em processamento\%''::text)'
       from pg_index i where i.indexrelid = 'public.whatsapp_inbound_reserva_audio_idx'::regclass),
    'índice da varredura: reserved_at, só das reservas em andamento');

  -- A tela só marca tratada: reserved_at é da service role.
  set local role authenticated;
  perform pg_temp.become123(sdr);
  begin
    update public.whatsapp_inbound_messages set reserved_at = now() where provider_message_id = 'wamid.0123.audio';
    raise exception 'FALHOU: SDR regravou reserved_at';
  exception when insufficient_privilege then
    raise notice '  ok  SDR não grava reserved_at (42501)';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== H. meta_plano_tentativas_hoje() =='

do $$
declare
  soc uuid := '00000000-0000-0000-0000-000001230002';
  mkt uuid := '00000000-0000-0000-0000-000001230003';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n_mkt int;
  n_soc int;
  n_sem int;
begin
  perform pg_temp.check123(
    has_function_privilege('authenticated', 'public.meta_plano_tentativas_hoje()', 'execute')
    and not has_function_privilege('anon', 'public.meta_plano_tentativas_hoje()', 'execute'),
    'authenticated executa; anon não');
  perform pg_temp.check123(
    (select p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
       from pg_proc p where p.oid = 'public.meta_plano_tentativas_hoje()'::regprocedure),
    'security definer com search_path fixo');

  insert into public.meta_plano_tentativas (profile_id, dia)
  select mkt, hoje from generate_series(1, 3)
  union all select mkt, hoje - 1 from generate_series(1, 2)
  union all select soc, hoje;

  set local role authenticated;
  perform pg_temp.become123(mkt);
  n_mkt := public.meta_plano_tentativas_hoje();
  perform pg_temp.become123(soc);
  n_soc := public.meta_plano_tentativas_hoje();
  perform set_config('request.jwt.claims', '', false);
  n_sem := public.meta_plano_tentativas_hoje();
  reset role;

  perform pg_temp.check123(n_mkt = 3, format('conta só as de hoje de quem pergunta (%s)', n_mkt));
  perform pg_temp.check123(n_soc = 1, format('cada um vê a sua conta (%s)', n_soc));
  perform pg_temp.check123(n_sem = 0, format('sem sessão, 0 (%s)', n_sem));

  set local role anon;
  begin
    perform public.meta_plano_tentativas_hoje();
    raise exception 'FALHOU: anon leu o contador';
  exception when insufficient_privilege then
    raise notice '  ok  anon leva 42501';
  end;
  reset role;
end
$$;

\echo '== I. planilha × planilha: plano B na sincronizada e a manual homônima =='

do $$
declare
  ma   uuid := '7e000000-0000-0000-0000-000001230008';
  goo  uuid := '7e000000-0000-0000-0000-000001230009';
  meta uuid;
  r    jsonb;
  msg  text;
begin
  r := pg_temp.sync123('2026-08-01', '2026-09-11', '120555123', 'Alfa Q 0123');
  select id into meta from public.ad_campaigns where external_id = '120555123';
  perform pg_temp.check123((r->>'campanhas_criadas')::int = 1 and pg_temp.total123(array[meta]) = 3650,
    format('a Q-ALFA nasce com 3.650 ao lado da manual sem gasto (%s)', r));

  -- A do Google de mesmo nome é outro gasto: não entra no par.
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(goo, '2026-08-01', '2026-08-31', 3100)));
  perform pg_temp.check123(msg is null, format('planilha na homônima do Google passa (%s)', msg));

  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(meta, '2026-08-01', '2026-08-31', 3000)));
  perform pg_temp.check123(msg is null and pg_temp.total123(array[meta]) = 3550
    and not exists (select 1 from public.ad_campaign_spend
                     where campaign_id = meta and source = 'meta_api' and period_start < date '2026-09-01'),
    format('o plano B na sincronizada troca agosto da API pela planilha (%s)', msg));

  -- O furo: sem gasto meta_api em agosto do lado oposto, a 0123 deixava passar.
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(ma, '2026-08-01', '2026-08-31', 3100)));
  perform pg_temp.check123(
    msg = 'Alfa Q 0123: a campanha Alfa Q 0123 (ID externo 120555123), de mesmo nome e sincronizada com a Meta, já tem gasto em 01/08/2026 a 31/08/2026. Lançar a planilha aqui contaria esses dias duas vezes: tire-os do arquivo ou importe-os na campanha 120555123.',
    format('planilha na manual sobre o plano B da sincronizada leva 22023 (%s)', msg));
  perform pg_temp.check123(pg_temp.total123(array[ma, meta]) = 3550
    and not exists (select 1 from public.ad_campaign_spend where campaign_id = ma),
    format('as duas somam 3.550, não 6.650 (%s)', pg_temp.total123(array[ma, meta])));

  -- O outro sentido: a manual tem julho; o plano B de julho na sincronizada.
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(ma, '2026-07-01', '2026-07-31', 700)));
  perform pg_temp.check123(msg is null, format('planilha na manual em dias sem gasto da sincronizada passa (%s)', msg));
  msg := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(meta, '2026-07-01', '2026-07-31', 700)));
  perform pg_temp.check123(
    msg = 'Alfa Q 0123: a campanha Alfa Q 0123 (ID externo alfa-q-0123), de mesmo nome e lançada à mão, já tem gasto em 01/07/2026 a 31/07/2026. Lançar a planilha aqui contaria esses dias duas vezes: tire-os do arquivo ou importe-os na campanha alfa-q-0123.',
    format('plano B na sincronizada sobre dias da manual leva 22023 (%s)', msg));
  perform pg_temp.check123(pg_temp.total123(array[ma, meta]) = 4250,
    format('julho conta uma vez: 700 + 3.550 (%s)', pg_temp.total123(array[ma, meta])));
end
$$;

\echo '== J. duas sincronizadas de mesmo nome: o plano B passa nas duas =='

do $$
declare
  t1 uuid;
  t2 uuid;
  r1 jsonb;
  r2 jsonb;
  m1 text;
  m2 text;
begin
  -- A segunda grava meta_api nos mesmos dias da primeira: a sincronização segue.
  r1 := pg_temp.sync123('2026-08-01', '2026-09-11', '120444123', 'Teta Q 0123');
  r2 := pg_temp.sync123('2026-08-01', '2026-09-11', '120333123', 'Teta Q 0123');
  select id into t1 from public.ad_campaigns where external_id = '120444123';
  select id into t2 from public.ad_campaigns where external_id = '120333123';
  perform pg_temp.check123(jsonb_array_length(r1->'conflitos') = 0 and jsonb_array_length(r2->'conflitos') = 0
    and pg_temp.total123(array[t1]) = 3650 and pg_temp.total123(array[t2]) = 3650,
    format('Q-T1 e Q-T2 nascem com 3.650 cada (%s / %s)', r1, r2));

  m1 := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(t1, '2026-08-01', '2026-08-31', 3000)));
  m2 := pg_temp.importa123(jsonb_build_array(pg_temp.lin123(t2, '2026-08-01', '2026-08-31', 2900)));
  perform pg_temp.check123(m1 is null and m2 is null
    and pg_temp.total123(array[t1]) = 3550 and pg_temp.total123(array[t2]) = 3450,
    format('o plano B passa nas duas (%s / %s)', m1, m2));

  r1 := pg_temp.sync123('2026-09-01', '2026-09-11', '120444123', 'Teta Q 0123');
  perform pg_temp.check123(jsonb_array_length(r1->'conflitos') = 0 and pg_temp.total123(array[t1]) = 3550,
    format('e a sincronização seguinte da Q-T1 continua gravando (%s)', r1));
end
$$;


\echo '== K. conta com campanha não se apaga; o gatilho entra em fila pelo nome =='

do $$
declare
  r      jsonb;
  c      uuid;
  apagou boolean;
begin
  r := pg_temp.sync123('2026-09-01', '2026-09-02', '120125001', 'Kapa Q 0125');
  select id into c from public.ad_campaigns where external_id = '120125001';
  perform pg_temp.check123(c is not null, format('a sincronização cria a campanha do bloco K (%s)', r));

  begin
    delete from public.meta_ad_accounts where id = '7f000000-0000-0000-0000-000001230001';
    apagou := true;
    raise exception 'desfaz';
  exception
    when restrict_violation or foreign_key_violation then apagou := false;
    when raise_exception then null;
  end;
  perform pg_temp.check123(apagou = false
    and (select meta_account_id from public.ad_campaigns where id = c) = '7f000000-0000-0000-0000-000001230001',
    'conta com campanha não se apaga: a campanha continua sincronizada e o par manual × sincronizada segue valendo');

  perform pg_temp.check123(
    position('pg_advisory_xact_lock' in pg_get_functiondef('public.ad_campaign_spend_homonima_api()'::regprocedure)) > 0,
    'o gatilho entra em fila pelo nome antes de comparar: importações simultâneas nas duas homônimas não passam juntas');
end
$$;

rollback;

\echo 'OK 0123 homônima e apoio'
