-- =============================================================================
-- 0123 · Campanha homônima com gasto em uma linha só, e apoio ao áudio e ao
--        planejador
--
--   1. Invariante: os mesmos dias de uma campanha da Meta não contam em duas
--      linhas de ad_campaigns com o mesmo nome (sem acento, sem caixa, sem
--      espaço nas pontas). A 0121 criava a da Meta sem gasto quando a manual
--      homônima tinha gasto na janela, e deixava dois furos: a planilha lançada
--      na manual DEPOIS de a da Meta ter gasto da API (dias fora da janela) e as
--      linhas que a da Meta já tinha ficando ao lado do conflito. A regra passa
--      a valer nas duas portas de escrita:
--        - sincronização: com manual homônima com planilha na janela, a
--          campanha da Meta não é criada nem recebe gasto, e o conflito diz
--          para qual ID trocar o da manual (a adoção por external_id resolve);
--        - planilha: recusada (22023) numa campanha quando OUTRA de mesmo nome
--          tem gasto da API nos mesmos dias. Fica num gatilho do livro, e não
--          só na importação, porque o INSERT direto de planilha continua aberto
--          a admin e marketing (0121).
--   2. A recusa da importação que perde dias lista os intervalos reais.
--   3. A importação recusa duas linhas do mesmo arquivo que se cruzam na mesma
--      campanha: o delete da segunda apagava a primeira.
--   4. whatsapp_inbound_messages.reserved_at e índices do teto e da varredura
--      de reservas de áudio (contrato com o webhook).
--   5. meta_plano_tentativas_hoje(): quantas tentativas o usuário fez hoje
--      (contrato com a tela do planejador).
--
-- As funções recriadas copiam o corpo da 0121 e mudam só o que o item pede.
-- Dado que a 0121 já tenha deixado em dobro não é apagado aqui. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Dias em intervalos: "01/08/2026 a 09/08/2026, 21/08/2026 a 31/08/2026".
-- Usada pela importação (security invoker), por isso authenticated executa.
-- -----------------------------------------------------------------------------
create or replace function public.faixas_de_dias(p_dias date[])
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select string_agg(
           case when f.de = f.ate then to_char(f.de, 'DD/MM/YYYY')
                else to_char(f.de, 'DD/MM/YYYY') || ' a ' || to_char(f.ate, 'DD/MM/YYYY') end,
           ', ' order by f.de)
    from (select min(u.d) as de, max(u.d) as ate
            from (select d, d - (row_number() over (order by d))::int as grupo
                    from (select distinct unnest(p_dias) as d) as x
                   where d is not null) as u
           group by u.grupo) as f;
$$;

comment on function public.faixas_de_dias(date[]) is
  'Agrupa dias consecutivos em intervalos para mensagens ("01/08/2026 a 09/08/2026, 21/08/2026"). 0123.';

revoke all on function public.faixas_de_dias(date[]) from public, anon;
grant execute on function public.faixas_de_dias(date[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1a. Porta da planilha: gatilho do livro
--
-- AFTER, para rodar só na linha que já passou pela RLS: quem não pode gravar
-- leva o 42501 da policy, e não uma mensagem com o nome e os dias de outra
-- campanha. Definer para enxergar o gasto de todas as campanhas.
-- -----------------------------------------------------------------------------
create or replace function public.ad_campaign_spend_homonima_api()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if new.source is distinct from 'planilha' then
    return null;
  end if;

  select c.name as nome, o.name as outra, o.external_id,
         public.faixas_de_dias(array_agg(d::date)) as dias
    into v
    from public.ad_campaigns c
    join public.ad_campaigns o
      on o.id <> c.id
     and lower(public.unaccent_fallback(btrim(o.name))) = lower(public.unaccent_fallback(btrim(c.name)))
    join public.ad_campaign_spend s
      on s.campaign_id = o.id
     and s.source = 'meta_api'
     and s.period_start <= new.period_end
     and s.period_end   >= new.period_start
    cross join lateral generate_series(greatest(s.period_start, new.period_start),
                                       least(s.period_end, new.period_end), interval '1 day') as d
   where c.id = new.campaign_id
   group by c.name, o.id, o.name, o.external_id
   order by o.external_id
   limit 1;

  if found then
    raise exception '%', format(
      '%s: a campanha %s (ID externo %s), de mesmo nome, já tem gasto sincronizado da Meta em %s. Lançar a planilha aqui contaria esses dias duas vezes: tire-os do arquivo ou importe-os na campanha %s.',
      v.nome, v.outra, v.external_id, v.dias, v.external_id)
      using errcode = '22023';
  end if;
  return null;
end;
$$;

comment on function public.ad_campaign_spend_homonima_api() is
  'Gatilho do livro: recusa (22023) linha de planilha numa campanha quando outra campanha de mesmo nome normalizado tem gasto meta_api nos mesmos dias, dizendo qual e quais dias (0123).';

revoke all on function public.ad_campaign_spend_homonima_api() from public, anon, authenticated;

drop trigger if exists ad_campaign_spend_homonima_api on public.ad_campaign_spend;
create trigger ad_campaign_spend_homonima_api
  after insert or update of campaign_id, period_start, period_end, source on public.ad_campaign_spend
  for each row execute function public.ad_campaign_spend_homonima_api();

-- -----------------------------------------------------------------------------
-- 2 e 3. Importação: dias perdidos em intervalos e linhas que se cruzam
--
-- Corpo da 0121, mais a recusa de linhas do mesmo arquivo que se cruzam (antes
-- da checagem de cobertura, que as somaria) e os intervalos na mensagem. A
-- planilha sobre dias de homônima da API é barrada pelo gatilho acima.
-- -----------------------------------------------------------------------------
create or replace function public.marketing_import_ad_spend(p_rows jsonb, p_source_file text default null)
returns table (linhas int, campanhas int, substituidas int)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  r           record;
  v_perda     record;
  v_cruza     record;
  v_linhas    int := 0;
  v_troca     int := 0;
  v_removidas int;
  v_campanhas int := 0;
begin
  if not public.has_any_role('admin','marketing') then
    raise exception 'Sem permissão para importar gasto de campanha (apenas admin, sócio e marketing).'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'O relatório precisa chegar como lista de linhas.' using errcode = '22023';
  end if;

  -- O delete do laço apaga toda linha que cruza a nova, inclusive a que o
  -- próprio arquivo acabou de gravar.
  with novas as (
    select (x->>'campaign_id')::uuid  as campaign_id,
           (x->>'period_start')::date as period_start,
           (x->>'period_end')::date   as period_end,
           n
      from jsonb_array_elements(p_rows) with ordinality as t(x, n)
  )
  select coalesce(c.name, 'Campanha') as nome,
         a.period_start as a_ini, a.period_end as a_fim,
         b.period_start as b_ini, b.period_end as b_fim
    into v_cruza
    from novas a
    join novas b
      on b.campaign_id = a.campaign_id
     and b.n > a.n
     and a.period_start <= b.period_end
     and a.period_end   >= b.period_start
    left join public.ad_campaigns c on c.id = a.campaign_id
   order by a.n, b.n
   limit 1;

  if found then
    raise exception '%', format(
      '%s: o arquivo traz dois períodos que se cruzam (%s a %s e %s a %s). Cada dia entra numa linha só: junte as linhas ou corrija as datas.',
      v_cruza.nome,
      to_char(v_cruza.a_ini, 'DD/MM/YYYY'), to_char(v_cruza.a_fim, 'DD/MM/YYYY'),
      to_char(v_cruza.b_ini, 'DD/MM/YYYY'), to_char(v_cruza.b_fim, 'DD/MM/YYYY'))
      using errcode = '22023';
  end if;

  -- O delete do laço apaga a linha antiga INTEIRA. Se o arquivo cobre só parte
  -- dela, os dias de fora sumiriam do total sem ninguém ver.
  with novas as (
    select (x->>'campaign_id')::uuid  as campaign_id,
           (x->>'period_start')::date as period_start,
           (x->>'period_end')::date   as period_end
      from jsonb_array_elements(p_rows) as x
  )
  select coalesce(c.name, 'Campanha') as nome,
         s.period_start, s.period_end,
         count(*)::int  as dias,
         public.faixas_de_dias(array_agg(d::date)) as faixas
    into v_perda
    from public.ad_campaign_spend s
    left join public.ad_campaigns c on c.id = s.campaign_id
    cross join lateral generate_series(s.period_start, s.period_end, interval '1 day') as d
   where exists (select 1 from novas n
                  where n.campaign_id = s.campaign_id
                    and n.period_start <= s.period_end
                    and n.period_end   >= s.period_start)
     and not exists (select 1 from novas n
                      where n.campaign_id = s.campaign_id
                        and d::date between n.period_start and n.period_end)
   group by c.name, s.campaign_id, s.period_start, s.period_end
   order by s.period_start
   limit 1;

  if found then
    raise exception '%', format(
      '%s: o arquivo cobre só parte do gasto já lançado de %s a %s, e %s dia(s) ficariam sem gasto: %s. Importe um arquivo que cubra de %s a %s inteiro.',
      v_perda.nome,
      to_char(v_perda.period_start, 'DD/MM/YYYY'), to_char(v_perda.period_end, 'DD/MM/YYYY'),
      v_perda.dias, v_perda.faixas,
      to_char(v_perda.period_start, 'DD/MM/YYYY'), to_char(v_perda.period_end, 'DD/MM/YYYY'))
      using errcode = '22023';
  end if;

  for r in
    select (x->>'campaign_id')::uuid        as campaign_id,
           (x->>'period_start')::date       as period_start,
           (x->>'period_end')::date         as period_end,
           round((x->>'spend')::numeric, 2) as spend
    from jsonb_array_elements(p_rows) as x
  loop
    if r.campaign_id is null or r.period_start is null or r.period_end is null or r.spend is null then
      raise exception 'Linha do relatório incompleta: campanha, período e gasto são obrigatórios.'
        using errcode = '22023';
    end if;

    -- O recorte novo manda — inclusive sobre dias da sincronização: a planilha
    -- é o plano B justamente quando a sincronização quebrou.
    delete from public.ad_campaign_spend s
     where s.campaign_id  = r.campaign_id
       and s.period_start <= r.period_end
       and s.period_end   >= r.period_start;
    get diagnostics v_removidas = row_count;
    v_troca := v_troca + v_removidas;

    insert into public.ad_campaign_spend
      (campaign_id, period_start, period_end, spend, imported_by, source_file)
    values
      (r.campaign_id, r.period_start, r.period_end, r.spend, auth.uid(), nullif(btrim(p_source_file), ''));
    v_linhas := v_linhas + 1;
  end loop;

  v_campanhas := public.ad_campaign_recalc_spend(
    array(select distinct (x->>'campaign_id')::uuid from jsonb_array_elements(p_rows) as x));

  return query select v_linhas, v_campanhas, v_troca;
end;
$$;

comment on function public.marketing_import_ad_spend(jsonb, text) is
  'Grava o gasto do relatório da Meta por campanha e período, em uma transação. Reimportar o mesmo arquivo não duplica (chave campanha+período) e um recorte que cobre inteira a linha já lançada a substitui, venha ela de planilha ou da sincronização. Leva 22023: linha já lançada que o arquivo cobre só em parte (0121; os dias perdidos em intervalos, 0123), duas linhas do arquivo que se cruzam na mesma campanha (0123) e planilha sobre dias que uma homônima já tem da API (gatilho ad_campaign_spend_homonima_api, 0123). O total sai de ad_campaign_recalc_spend.';

revoke all on function public.marketing_import_ad_spend(jsonb, text) from public, anon;
grant execute on function public.marketing_import_ad_spend(jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 1b. Porta da sincronização
--
-- Corpo da 0121; a checagem da homônima sai do passo 2 e vai para o passo 1,
-- antes de criar ou atualizar: com manual homônima (sem conta) que tem
-- planilha cruzando a janela desta campanha, ela não é criada nem tocada, e
-- nenhum gasto é gravado para ela. Trocado o ID da manual para o da Meta, a
-- adoção por external_id faz o resto. Homônima sem planilha na janela não
-- bloqueia: a da Meta é criada e é a fonte verdadeira (e o gatilho acima
-- barra planilha nova na manual sobre esses dias). `v_id is not null` troca o
-- `found` do upsert, que a checagem nova sobrescreve.
-- -----------------------------------------------------------------------------
create or replace function public.meta_sync_apply(p_run_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account     uuid;
  v_status      text;
  v_ped_ini     date;
  v_ped_fim     date;
  v_bus_ini     date;
  v_bus_fim     date;
  v_tz          text;
  v_hoje        date;
  c             record;
  v_gemea       record;
  v_id          uuid;
  v_platform    text;
  v_j           daterange;
  v_fim_exigido date;
  v_n           int;
  v_criadas     int := 0;
  v_atualizadas int := 0;
  v_dias        int := 0;
  v_conflitos   text[] := '{}';
  v_pulados     text[] := '{}';
  v_todas       uuid[] := '{}';
  v_trocadas    uuid[] := '{}';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role grava a sincronização.' using errcode = '42501';
  end if;

  select r.account_id, r.status into v_account, v_status
    from public.meta_sync_runs r where r.id = p_run_id for update;
  if not found then
    raise exception 'Execução de sincronização não encontrada.' using errcode = '22023';
  end if;
  if v_status <> 'rodando' then
    raise exception 'Esta execução já foi encerrada (%).', v_status using errcode = '55000';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'conta') is distinct from 'object'
     or jsonb_typeof(p_payload->'campanhas') is distinct from 'array'
     or jsonb_typeof(p_payload->'insights') is distinct from 'array' then
    raise exception 'Payload da sincronização incompleto: conta, campanhas e insights são obrigatórios.'
      using errcode = '22023';
  end if;

  v_ped_ini := (p_payload #>> '{janela_pedida,inicio}')::date;
  v_ped_fim := (p_payload #>> '{janela_pedida,fim}')::date;
  v_bus_ini := (p_payload #>> '{janela_buscada,inicio}')::date;
  v_bus_fim := (p_payload #>> '{janela_buscada,fim}')::date;
  if v_ped_ini is null or v_ped_fim is null or v_bus_ini is null or v_bus_fim is null
     or v_ped_ini > v_ped_fim or v_bus_ini > v_bus_fim then
    raise exception 'Payload da sincronização sem janela_pedida e janela_buscada válidas.' using errcode = '22023';
  end if;
  if v_bus_ini > v_ped_ini or v_bus_fim < v_ped_fim then
    raise exception 'A janela buscada na Meta (% a %) precisa conter a pedida (% a %).',
      v_bus_ini, v_bus_fim, v_ped_ini, v_ped_fim using errcode = '22023';
  end if;

  -- "Hoje" no fuso da conta: dia depois dele não tem gasto, então uma linha do
  -- livro que passa do fim buscado só exige cobertura até aqui.
  select coalesce(nullif(p_payload #>> '{conta,timezone_name}', ''), a.timezone_name, 'America/Sao_Paulo')
    into v_tz from public.meta_ad_accounts a where a.id = v_account for update;
  begin
    v_hoje := (now() at time zone v_tz)::date;
  exception when invalid_parameter_value then
    v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
  end;

  -- 1. Upsert das campanhas. Adoção preserva developer_id, lead_source_id e
  --    período de veiculação; nome, status e verba passam a vir da Meta.
  for c in
    select btrim(x->>'external_id')                         as external_id,
           nullif(btrim(x->>'name'), '')                    as name,
           upper(nullif(btrim(x->>'status'), ''))           as status,
           nullif(btrim(x->>'effective_status'), '')        as effective_status,
           round((x->>'daily_budget')::numeric, 2)          as daily_budget,
           round((x->>'lifetime_budget')::numeric, 2)       as lifetime_budget,
           nullif(x->>'budget_level', '')                   as budget_level,
           nullif(x->>'channel', '')                        as channel,
           (x->>'developer_suggested_id')::uuid             as developer_suggested_id
      from jsonb_array_elements(p_payload->'campanhas') as x
  loop
    if coalesce(c.external_id, '') = '' or c.name is null then
      raise exception 'Campanha sem id ou nome no payload da sincronização.' using errcode = '22023';
    end if;

    select a.id, a.platform into v_id, v_platform
      from public.ad_campaigns a where a.external_id = c.external_id;

    if found and v_platform <> 'meta' then
      v_conflitos := v_conflitos || format(
        '%s: o id externo já pertence a uma campanha de %s no FACEIMOB; ela não foi tocada.',
        c.external_id, v_platform);
      v_pulados := v_pulados || c.external_id;
      continue;
    end if;

    -- A manual homônima já tem esses dias no livro com outro ID. A janela é a
    -- que o passo 2 usaria; sem campanha (v_id nulo), é a pedida.
    v_j := public.meta_janela_campanha(v_id, v_ped_ini, v_ped_fim);
    select m.name, m.external_id into v_gemea
      from public.ad_campaigns m
     where m.id is distinct from v_id
       and m.platform = 'meta'
       and m.meta_account_id is null
       and lower(public.unaccent_fallback(btrim(m.name))) = lower(public.unaccent_fallback(btrim(c.name)))
       and exists (select 1 from public.ad_campaign_spend s
                    where s.campaign_id = m.id
                      and s.source = 'planilha'
                      and daterange(s.period_start, s.period_end, '[]') && v_j)
     order by m.external_id
     limit 1;
    if found then
      v_conflitos := v_conflitos || (format(
        '%s: a campanha %s já tem gasto lançado à mão com o ID externo %s. Troque o ID externo dela para %s e a próxima sincronização passa a atualizá-la.',
        c.external_id, v_gemea.name, v_gemea.external_id, c.external_id)
        || case when v_id is not null then format(
             ' Antes, apague a campanha %s criada pela sincronização: o ID externo é único.', c.external_id)
           else '' end);
      v_pulados := v_pulados || c.external_id;
      continue;
    end if;

    if v_id is not null then
      update public.ad_campaigns a
         set name                   = c.name,
             status                 = c.status,
             daily_budget           = c.daily_budget,
             lifetime_budget        = c.lifetime_budget,
             meta_account_id        = v_account,
             meta_channel           = c.channel,
             meta_effective_status  = c.effective_status,
             meta_budget_level      = c.budget_level,
             developer_suggested_id = (select d.id from public.developers d where d.id = c.developer_suggested_id)
       where a.id = v_id;
      if not v_id = any (v_todas) then
        v_atualizadas := v_atualizadas + 1;
      end if;
    else
      insert into public.ad_campaigns
        (external_id, platform, name, status, daily_budget, lifetime_budget,
         meta_account_id, meta_channel, meta_effective_status, meta_budget_level, developer_suggested_id)
      values
        (c.external_id, 'meta', c.name, c.status, c.daily_budget, c.lifetime_budget,
         v_account, c.channel, c.effective_status, c.budget_level,
         (select d.id from public.developers d where d.id = c.developer_suggested_id))
      returning id into v_id;
      v_criadas := v_criadas + 1;
    end if;

    if not v_id = any (v_todas) then
      v_todas := v_todas || v_id;
    end if;
  end loop;

  -- Insight de campanha que não veio na lista: montar.ts inclui toda campanha
  -- dos insights em `campanhas`, então isto é defeito do payload — vira
  -- conflito visível, e o gasto dela não é tocado.
  select v_conflitos || coalesce(array_agg(format(
           '%s: veio nos insights sem vir na lista de campanhas; o gasto dela não foi gravado.', e)), '{}')
    into v_conflitos
    from (
      select distinct x->>'external_id' as e
        from jsonb_array_elements(p_payload->'insights') as x
       where not ((x->>'external_id') = any (v_pulados))
         and not exists (select 1 from public.ad_campaigns a
                          where a.id = any (v_todas) and a.external_id = x->>'external_id')
    ) orfas;

  -- 2. Por campanha: a janela dela sai da PEDIDA; a BUSCADA tem de cobri-la.
  for c in
    select a.id, a.external_id, a.name from public.ad_campaigns a where a.id = any (v_todas)
  loop
    v_j := public.meta_janela_campanha(c.id, v_ped_ini, v_ped_fim);
    v_fim_exigido := least(upper(v_j) - 1, v_hoje);

    if lower(v_j) < v_bus_ini or v_fim_exigido > v_bus_fim then
      v_conflitos := v_conflitos || format(
        '%s: o gasto já lançado desta campanha exige a Meta de %s a %s, fora do que foi buscado (%s a %s); o gasto dela não foi trocado.',
        c.external_id, to_char(lower(v_j), 'DD/MM/YYYY'), to_char(v_fim_exigido, 'DD/MM/YYYY'),
        to_char(v_bus_ini, 'DD/MM/YYYY'), to_char(v_bus_fim, 'DD/MM/YYYY'));
      continue;
    end if;

    -- Por construção, toda linha que cruza a janela está inteira dentro dela.
    delete from public.ad_campaign_spend s
     where s.campaign_id = c.id
       and daterange(s.period_start, s.period_end, '[]') && v_j;
    delete from public.meta_campaign_insights_daily i
     where i.campaign_id = c.id
       and i.day <@ v_j;

    -- Dia fora da janela DESTA campanha é ignorado, mesmo que tenha vindo porque
    -- outra campanha exigiu uma busca maior.
    insert into public.meta_campaign_insights_daily
      (campaign_id, day, spend, impressions, reach, clicks, link_clicks,
       leads_form, conversations, lp_leads, lp_views, resultados, run_id)
    select c.id,
           (x->>'day')::date,
           round(coalesce((x->>'spend')::numeric, 0), 2),
           coalesce((x->>'impressions')::bigint, 0),
           coalesce((x->>'reach')::bigint, 0),
           coalesce((x->>'clicks')::bigint, 0),
           coalesce((x->>'link_clicks')::bigint, 0),
           coalesce((x->>'leads_form')::int, 0),
           coalesce((x->>'conversations')::int, 0),
           coalesce((x->>'lp_leads')::int, 0),
           coalesce((x->>'lp_views')::int, 0),
           coalesce((x->>'resultados')::int, 0),
           p_run_id
      from jsonb_array_elements(p_payload->'insights') as x
     where x->>'external_id' = c.external_id
       and (x->>'day')::date <@ v_j
       and (x->>'day')::date between v_bus_ini and v_bus_fim;
    get diagnostics v_n = row_count;
    v_dias := v_dias + v_n;

    insert into public.ad_campaign_spend (campaign_id, period_start, period_end, spend, source)
    select i.campaign_id, i.day, i.day, i.spend, 'meta_api'
      from public.meta_campaign_insights_daily i
     where i.campaign_id = c.id
       and i.day <@ v_j;

    v_trocadas := v_trocadas || c.id;
  end loop;

  -- 3. total_spend e synced_at mudam na mesma instrução (recálculo único).
  perform public.ad_campaign_recalc_spend(v_trocadas);

  -- 4. Estado cru da conta. O estado de saldo é decidido pela 0117.
  update public.meta_ad_accounts a
     set name               = coalesce(nullif(btrim(p_payload #>> '{conta,name}'), ''), a.name),
         currency           = coalesce(nullif(btrim(p_payload #>> '{conta,currency}'), ''), a.currency),
         timezone_name      = coalesce(nullif(btrim(p_payload #>> '{conta,timezone_name}'), ''), a.timezone_name),
         account_status     = (p_payload #>> '{conta,account_status}')::int,
         disable_reason     = (p_payload #>> '{conta,disable_reason}')::int,
         is_prepay          = (p_payload #>> '{conta,is_prepay}')::boolean,
         amount_spent       = round((p_payload #>> '{conta,amount_spent}')::numeric, 2),
         spend_cap          = round((p_payload #>> '{conta,spend_cap}')::numeric, 2),
         prepay_available   = round((p_payload #>> '{conta,prepay_available}')::numeric, 2),
         account_checked_at = clock_timestamp(),
         last_sync_ok_at    = clock_timestamp(),
         last_sync_error    = null
   where a.id = v_account;

  update public.meta_sync_runs
     set status       = 'ok',
         window_start = v_ped_ini,
         window_end   = v_ped_fim,
         campaigns    = cardinality(v_trocadas),
         rows         = v_dias,
         finished_at  = clock_timestamp()
   where id = p_run_id;

  return jsonb_build_object(
    'campanhas_criadas',     v_criadas,
    'campanhas_atualizadas', v_atualizadas,
    'dias',                  v_dias,
    'conflitos',             to_jsonb(v_conflitos));
end;
$$;

comment on function public.meta_sync_apply(uuid, jsonb) is
  'Grava uma sincronização completa numa transação: upsert das campanhas, troca do livro e dos insights pela janela de cada campanha (meta_janela_campanha sobre a janela_pedida, conferida contra a janela_buscada), recálculo e estado da conta. Campanha sem cobertura volta em conflitos com o gasto intocado; com manual homônima (sem conta) que tem planilha na janela, não é criada nem tocada e o conflito diz para qual ID trocar o da manual (0123). Service role.';

revoke all on function public.meta_sync_apply(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.meta_sync_apply(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Reserva de áudio: hora da reserva e índices
--
-- reserved_at é quando a reserva foi feita ou retomada; created_at continua
-- sendo a chegada. As linhas antigas recebem created_at (um default now() na
-- mesma instrução do add column carimbaria a hora da migration). O índice do
-- teto serve à contagem de áudios por telefone no dia; o da varredura só
-- guarda reserva em andamento, então fica do tamanho das reservas abertas.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_inbound_messages add column if not exists reserved_at timestamptz;
update public.whatsapp_inbound_messages set reserved_at = created_at where reserved_at is null;
alter table public.whatsapp_inbound_messages alter column reserved_at set default now();
alter table public.whatsapp_inbound_messages alter column reserved_at set not null;

comment on column public.whatsapp_inbound_messages.reserved_at is
  'Hora da reserva do áudio (ou da retomada de uma reserva vencida). Nas demais mensagens, igual à chegada. 0123.';

create index if not exists whatsapp_inbound_teto_audio_idx
  on public.whatsapp_inbound_messages (from_phone, media_type, created_at);

create index if not exists whatsapp_inbound_reserva_audio_idx
  on public.whatsapp_inbound_messages (reserved_at)
  where detail like 'áudio em processamento%';

-- -----------------------------------------------------------------------------
-- 5. Quantas tentativas do planejador o usuário fez hoje
--
-- A tabela não tem policy (0121): a tela lê o contador por aqui, e só o dela.
-- -----------------------------------------------------------------------------
create or replace function public.meta_plano_tentativas_hoje()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from public.meta_plano_tentativas t
   where t.profile_id = auth.uid()
     and t.dia = (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.meta_plano_tentativas_hoje() is
  'Tentativas do planejador de campanha registradas hoje (fuso America/Sao_Paulo) pelo usuário logado; 0 sem sessão. O teto é 20 (meta_plano_tentativa_registrar). 0123.';

revoke all on function public.meta_plano_tentativas_hoje() from public, anon;
grant execute on function public.meta_plano_tentativas_hoje() to authenticated;
