-- =============================================================================
-- 0121 · Correções da conferência da integração Meta Ads
--
--   1. O livro do gasto: `authenticated` só grava e altera linha de PLANILHA.
--      A policy `for all` da 0113 deixava um PATCH pelo PostgREST mostrar
--      R$ 9.999 como "sincronizado da Meta".
--   2. Campanha manual com o MESMO nome e outro id externo, com gasto na janela:
--      a sincronização não grava o gasto da campanha da Meta por cima (dupla
--      contagem) e devolve um conflito dizendo como corrigir.
--   3. A importação recusa o recorte que cobre só PARTE de uma linha já
--      lançada: o delete apagava a linha inteira, e os dias fora do arquivo
--      sumiam.
--   4. Ação presa em 'executando' (a edge morreu no meio) vira 'falhou'.
--   5. Execução de IA do cron que morreu é encerrada pelo próprio cron.
--   6. A roleta volta ao predicado da 0074: só conversa 'active' segura o lead.
--   7. O aviso de mensagem recebida também sai quando o desfecho muda por UPDATE.
--   8. O teto do planejador conta TENTATIVA, não plano salvo.
--
-- As funções recriadas copiam o corpo vigente (0115, 0116, 0120) e mudam só o
-- que o item pede. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Livro do gasto: a escrita direta é só de planilha
--
-- Linha 'meta_api' só nasce pela `meta_sync_apply` (service role). O DELETE
-- continua aberto a admin, sócio e marketing: a importação é security invoker e
-- apaga o recorte que substitui, inclusive dias da sincronização (a planilha é
-- o plano B quando a sincronização quebra).
-- -----------------------------------------------------------------------------
drop policy if exists ad_campaign_spend_write on public.ad_campaign_spend;

drop policy if exists ad_campaign_spend_insert on public.ad_campaign_spend;
create policy ad_campaign_spend_insert on public.ad_campaign_spend
  for insert to authenticated
  with check (public.has_any_role('admin','marketing') and source = 'planilha');

drop policy if exists ad_campaign_spend_update on public.ad_campaign_spend;
create policy ad_campaign_spend_update on public.ad_campaign_spend
  for update to authenticated
  using      (public.has_any_role('admin','marketing') and source = 'planilha')
  with check (public.has_any_role('admin','marketing') and source = 'planilha');

drop policy if exists ad_campaign_spend_delete on public.ad_campaign_spend;
create policy ad_campaign_spend_delete on public.ad_campaign_spend
  for delete to authenticated
  using (public.has_any_role('admin','marketing'));

-- -----------------------------------------------------------------------------
-- 3. A importação não apaga dia que o arquivo não traz
--
-- Corpo da 0115, mais a recusa antes do laço. A cobertura é a SOMA das linhas
-- do arquivo para a campanha: 01-31/08 depois de 01-15/08 e a planilha sobre
-- dias da API (linhas de um dia) continuam substituindo, e um arquivo com uma
-- linha por dia também cobre uma linha mensal.
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
         min(d)::date   as de,
         max(d)::date   as ate
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
      '%s: o arquivo cobre só parte do gasto já lançado de %s a %s, e %s dia(s) entre %s e %s ficariam sem gasto. Importe um arquivo que cubra de %s a %s inteiro.',
      v_perda.nome,
      to_char(v_perda.period_start, 'DD/MM/YYYY'), to_char(v_perda.period_end, 'DD/MM/YYYY'),
      v_perda.dias, to_char(v_perda.de, 'DD/MM/YYYY'), to_char(v_perda.ate, 'DD/MM/YYYY'),
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
  'Grava o gasto do relatório da Meta por campanha e período, em uma transação. Reimportar o mesmo arquivo não duplica (chave campanha+período) e um recorte que cobre inteira a linha já lançada a substitui, venha ela de planilha ou da sincronização. Linha já lançada que o arquivo cobre só em parte leva 22023 dizendo quais dias se perderiam (0121). O total sai de ad_campaign_recalc_spend.';

revoke all on function public.marketing_import_ad_spend(jsonb, text) from public, anon;
grant execute on function public.marketing_import_ad_spend(jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Campanha manual homônima com gasto na janela não é contada de novo
--
-- Corpo da 0115; muda só o passo 2. A adoção continua só por external_id: nome
-- não é único e adotar por ele poderia juntar duas campanhas diferentes. A
-- planilha casa por nome quando o arquivo não traz o ID (metaReport.ts), então
-- uma campanha cadastrada com outro ID recebe o gasto e a sincronização cria a
-- da Meta ao lado. Enquanto a manual tiver gasto que cruza a janela, a da Meta
-- fica sem gasto (senão os mesmos dias contam nas duas) e o conflito diz como
-- corrigir. O external_id é único (0067): por isso a campanha criada precisa
-- sair antes de a manual receber o ID da Meta. Nome comparado como a planilha
-- compara: sem acento, sem caixa e sem espaço nas pontas.
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

    if found then
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

    -- A manual homônima já tem esses dias no livro com outro ID.
    select m.name, m.external_id into v_gemea
      from public.ad_campaigns m
     where m.id <> c.id
       and m.platform = 'meta'
       and m.meta_account_id is null
       and lower(public.unaccent_fallback(btrim(m.name))) = lower(public.unaccent_fallback(btrim(c.name)))
       and exists (select 1 from public.ad_campaign_spend s
                    where s.campaign_id = m.id
                      and daterange(s.period_start, s.period_end, '[]') && v_j)
     order by m.external_id
     limit 1;
    if found then
      v_conflitos := v_conflitos || format(
        '%s: a campanha manual %s (%s) já tem gasto lançado com outro ID: corrija o ID externo dela para %s. O ID externo é único, então apague antes a campanha %s criada pela sincronização. Até lá o gasto desta não é gravado, para não contar os mesmos dias duas vezes.',
        c.external_id, v_gemea.name, v_gemea.external_id, c.external_id, c.external_id);
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
  'Grava uma sincronização completa numa transação: upsert das campanhas, troca do livro e dos insights pela janela de cada campanha (meta_janela_campanha sobre a janela_pedida, conferida contra a janela_buscada), recálculo e estado da conta. Campanha sem cobertura, ou com uma manual homônima (sem conta, com gasto na janela) sob outro ID, não é tocada e volta em conflitos (0121). Service role.';

revoke all on function public.meta_sync_apply(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.meta_sync_apply(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Ação presa em 'executando'
--
-- Corpo da 0116, mais o carimbo de início (executed_at no claim; o finish o
-- sobrescreve com o fim) e a varredura. A edge tem limite de tempo bem menor
-- que 15 min: passado isso, ela morreu e não vai chamar o finish. A ação pode
-- ter mudado parte dos conjuntos na Meta, e o erro diz isso.
-- `coalesce(executed_at, decided_at)` alcança a que ficou presa antes desta
-- migration, sem o carimbo.
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_claim(p_action_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente o executor (service role) reivindica ação.' using errcode = '42501';
  end if;

  update public.meta_actions
     set status = 'falhou',
         erro   = 'Interrompida no meio: confira no Gerenciador, pode ter sido aplicada em parte'
   where status = 'executando'
     and coalesce(executed_at, decided_at) < clock_timestamp() - interval '15 minutes';

  -- O UPDATE condicional é a trava: duas chamadas simultâneas passam em fila e
  -- a segunda já não encontra 'aprovada'.
  with claimed as (
    update public.meta_actions
       set status = 'executando',
           executed_at = clock_timestamp()
     where id = p_action_id and status = 'aprovada'
    returning *
  )
  select jsonb_build_object(
           'action_id',            k.id,
           'campaign_id',          k.campaign_id,
           'campaign_external_id', k.campaign_external_id,
           'campaign_name',        k.campaign_name,
           'account_id',           k.account_id,
           'act_id',               acc.act_id,
           'acao',                 k.acao,
           'verba_anterior',       k.verba_anterior,
           'verba_nova',           k.verba_nova,
           'exigiu_aprendizado',   k.exigiu_aprendizado,
           'meta_budget_level',    camp.meta_budget_level)
    into v_r
    from claimed k
    left join public.meta_ad_accounts acc on acc.id = k.account_id
    left join public.ad_campaigns camp   on camp.id = k.campaign_id;

  return v_r;
end;
$$;

comment on function public.meta_action_claim(uuid) is
  'Atômica: aprovada → executando, com executed_at = início. Antes, encerra como falhou toda ação em execução há mais de 15 min (a edge morreu no meio; pode ter sido aplicada em parte). Devolve o que o executor precisa (campaign_external_id, act_id, acao, verbas, exigiu_aprendizado, meta_budget_level) ou null se a ação não estava aprovada. Service role.';

revoke all on function public.meta_action_claim(uuid) from public, anon, authenticated;
grant execute on function public.meta_action_claim(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Execução de IA morta: a varredura vem antes do ramo do cron
--
-- Corpo da 0116; muda só a posição do UPDATE. Depois do return do cron, a
-- execução agendada que morreu ficava 'rodando' para sempre, e a próxima
-- chamada do dia a recebia como reaproveitada.
-- -----------------------------------------------------------------------------
create or replace function public.meta_ai_run_start(p_kind text, p_account_id uuid, p_trigger text, p_params jsonb)
returns table (run_id uuid, reused boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_servico boolean := coalesce(auth.role(), '') = 'service_role';
  v_params  jsonb   := coalesce(p_params, '{}'::jsonb);
  v_enabled boolean;
  v_id      uuid;
begin
  if not (v_servico or public.has_permission('marketing.meta_manage')) then
    raise exception 'Sem permissão para rodar análise de IA da Meta (Gerenciar campanhas na Meta).'
      using errcode = '42501';
  end if;
  if p_trigger is null or p_trigger not in ('cron', 'manual') then
    raise exception 'Origem da análise inválida (cron ou manual).' using errcode = '22023';
  end if;
  if p_trigger = 'cron' and not v_servico then
    raise exception 'A análise agendada é só do cron.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('nota_anuncios', 'gestor') then
    raise exception 'Análise desconhecida (nota_anuncios ou gestor).' using errcode = '22023';
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'Os parâmetros da análise precisam ser um objeto.' using errcode = '22023';
  end if;

  select a.enabled into v_enabled from public.meta_ad_accounts a where a.id = p_account_id;
  if not found then
    raise exception 'Conta de anúncios não encontrada.' using errcode = '22023';
  end if;
  if not v_enabled then
    raise exception 'Conta de anúncios desligada: ligue-a em /admin/meta-ads para analisar.' using errcode = '22023';
  end if;

  -- Dois cliques ao mesmo tempo passam por aqui em fila: sem isso, os dois
  -- veriam "nada para reusar" e pagariam duas chamadas de IA.
  perform pg_advisory_xact_lock(hashtextextended('meta_ai_run:' || p_kind || ':' || p_account_id::text, 0));

  -- Parada há mais de 15 min morreu com a edge: encerra, para a tela não dizer
  -- "rodando" para sempre. De 5 a 15 min ela não é reusada, mas ainda pode
  -- terminar e gravar o resultado.
  update public.meta_ai_runs r
     set status = 'falhou',
         error = 'Interrompida: ficou mais de 15 minutos sem terminar.',
         finished_at = clock_timestamp()
   where r.account_id = p_account_id and r.kind = p_kind and r.status = 'rodando'
     and r.started_at < clock_timestamp() - interval '15 minutes';

  if p_trigger = 'cron' then
    insert into public.meta_ai_runs (kind, account_id, trigger, params)
    values (p_kind, p_account_id, 'cron', v_params)
    on conflict (account_id, kind, run_date) where trigger = 'cron' do nothing
    returning id into v_id;

    if v_id is not null then
      return query select v_id, false;
      return;
    end if;

    return query
      select r.id, true
        from public.meta_ai_runs r
       where r.account_id = p_account_id and r.kind = p_kind and r.trigger = 'cron'
         and r.run_date = (now() at time zone 'America/Sao_Paulo')::date;
    return;
  end if;

  select r.id into v_id
    from public.meta_ai_runs r
   where r.account_id = p_account_id and r.kind = p_kind and r.params = v_params
     and ((r.status = 'ok' and r.finished_at > clock_timestamp() - interval '10 minutes')
          or (r.status = 'rodando' and r.started_at > clock_timestamp() - interval '5 minutes'))
   order by r.started_at desc
   limit 1;

  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  insert into public.meta_ai_runs (kind, account_id, trigger, requested_by, params)
  values (p_kind, p_account_id, 'manual', auth.uid(), v_params)
  returning id into v_id;

  return query select v_id, false;
end;
$$;

comment on function public.meta_ai_run_start(text, uuid, text, jsonb) is
  'Abre (ou reaproveita) uma execução de IA. Manual: marketing.meta_manage; reusa a ok com os mesmos kind, conta e params de até 10 min, ou a rodando de até 5 min. Cron: só service role, uma por conta, tipo e dia. Nos dois caminhos, a rodando há mais de 15 min vira falhou antes (0121). reused = true significa que nenhuma chamada de IA nova deve ser feita.';

revoke all on function public.meta_ai_run_start(text, uuid, text, jsonb) from public, anon;
grant execute on function public.meta_ai_run_start(text, uuid, text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. A roleta volta ao comportamento da 0074
--
-- A 0120 passou a segurar fora da roleta, sem prazo, o lead de conversa
-- 'human' com dono. O cliente não pediu, e um SDR que esquece a conversa
-- deixaria o lead sem corretor. Corpo da 0120; muda só o predicado da conversa.
-- -----------------------------------------------------------------------------
create or replace function public.assign_queued_leads()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_done int := 0;
  v_max_rounds int;
begin
  select coalesce(s.roulette_max_rounds, 5) into v_max_rounds
  from public.automation_settings s where s.id;

  for v_lead in
    select l.id from public.leads l
    where l.status = 'queued'
      and coalesce(l.roulette_misses, 0) < coalesce(v_max_rounds, 5)
      and not exists (
        select 1 from public.sdr_conversations c
        where c.lead_id = l.id and c.status = 'active'
      )
    order by l.created_at
    limit 50
  loop
    if public.assign_lead(v_lead) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.assign_queued_leads() from public, anon, authenticated;
grant execute on function public.assign_queued_leads() to service_role;

comment on function public.assign_queued_leads is
  'Varre a fila e distribui. Ignora lead em conversa ativa de SDR (0022; a 0121 desfez a trava de conversa humana com dono da 0120) e lead que já bateu o teto de voltas (0074): sem isso a janela fixa de 50 ficaria presa nos mais antigos, que a roleta nunca mais aceita.';

-- -----------------------------------------------------------------------------
-- 7. O aviso também sai quando o desfecho muda por UPDATE
--
-- O webhook reserva o áudio antes de baixar (desfecho 'sdr_turn', que não
-- avisa) e passa a finalizar a reserva com UPDATE para 'audio_falhou', em vez de
-- apagar e inserir de novo. A função é a da 0120, sem mudança: ela só lê NEW e
-- ignora desfecho que não avisa. O WHEN deixa de fora o UPDATE que não muda o
-- desfecho — sem ele, regravar o detail repetiria o aviso quando a janela de
-- repetição (30 min / 6 h) já tivesse passado.
-- -----------------------------------------------------------------------------
drop trigger if exists notify_whatsapp_desfecho_mudou on public.whatsapp_inbound_messages;
create trigger notify_whatsapp_desfecho_mudou
  after update of outcome on public.whatsapp_inbound_messages
  for each row
  when (new.outcome is distinct from old.outcome)
  execute function public.notify_whatsapp_unmatched();

-- -----------------------------------------------------------------------------
-- 8. Teto do planejador por tentativa
--
-- A edge contava planos SALVOS: a chamada de IA que falhava (JSON cortado,
-- plano recusado) já estava paga e não entrava na conta, e o teto nunca
-- chegava. Agora a edge registra a tentativa ANTES de chamar a IA.
--
-- Tabela própria, não meta_ai_runs: lá account_id é obrigatório e o plano não
-- tem conta. RLS ligada e nenhuma policy: só a função (definer) grava e lê. O
-- SELECT/INSERT de `authenticated` fica concedido pelo default da 0023 (o
-- 06_anon_surface cobra) e a RLS recusa. O advisory lock por perfil põe em fila
-- dois cliques simultâneos, que antes passavam os dois no 19º plano.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_plano_tentativas (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  dia        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists meta_plano_tentativas_perfil_dia_idx
  on public.meta_plano_tentativas (profile_id, dia);

comment on table public.meta_plano_tentativas is
  'Cada pedido ao planejador de campanha (meta-campaign-planner), registrado antes da chamada de IA. É o que o teto diário conta (meta_plano_tentativa_registrar). Sem policy: só a função grava e lê.';

alter table public.meta_plano_tentativas enable row level security;

revoke all on public.meta_plano_tentativas from anon;
revoke update, delete, truncate on public.meta_plano_tentativas from authenticated;

create or replace function public.meta_plano_tentativa_registrar(p_profile_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente o planejador (service role) registra tentativa.' using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'Informe quem pediu o plano.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('meta_plano:' || p_profile_id::text));

  if (select count(*) from public.meta_plano_tentativas t
       where t.profile_id = p_profile_id and t.dia = v_hoje) >= 20 then
    return false;
  end if;

  insert into public.meta_plano_tentativas (profile_id, dia) values (p_profile_id, v_hoje);
  return true;
end;
$$;

comment on function public.meta_plano_tentativa_registrar(uuid) is
  'Teto do planejador: com menos de 20 tentativas do perfil no dia (fuso America/Sao_Paulo), registra mais uma e devolve true; senão devolve false sem registrar. Chamada ANTES da IA, então tentativa que falha também conta. Service role.';

revoke all on function public.meta_plano_tentativa_registrar(uuid) from public, anon, authenticated;
grant execute on function public.meta_plano_tentativa_registrar(uuid) to service_role;
