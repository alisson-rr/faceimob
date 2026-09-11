-- =============================================================================
-- 0115 · A Marketing API da Meta escreve no MESMO livro do gasto da planilha
--
-- O PEDIDO: sincronizar gasto, verba, status e resultados das campanhas pela
-- Marketing API (token de usuário de sistema no cofre), sem perder a planilha
-- como plano B (0113) e sem contar o mesmo dia duas vezes (0114).
--
-- O LIVRO. `ad_campaign_spend` ganha `source` ('planilha' | 'meta_api'). A
-- sincronização grava UMA linha por campanha e por DIA (period_start =
-- period_end), sempre pela `meta_sync_apply`, que é só da service role. A
-- planilha continua gravando o recorte do arquivo, e "o recorte novo manda"
-- continua valendo nos dois sentidos.
--
-- A JANELA DE CADA CAMPANHA (uma regra, uma função: `meta_janela_campanha`).
-- É o recorte PEDIDO (padrão D-7 até hoje) estendido para cobrir INTEIRA toda
-- linha do livro daquela campanha que o cruze. Ex.: planilha 01-31/08 e
-- pedido 25/08-11/09 → janela 01/08-11/09; a Meta devolve agosto dia a dia e a
-- linha mensal é trocada por dias com o mesmo total. Como linhas da mesma
-- campanha não se cruzam (0114), a extensão nunca alcança uma segunda linha:
-- não há efeito cascata.
--
-- DUAS JANELAS NO PAYLOAD. A PEDIDA define a janela de cada campanha; a
-- BUSCADA (a menor data que `meta_sync_window` devolveu, até o fim pedido) é o
-- que a Meta de fato devolveu. Se a apply recalculasse a janela a partir da
-- buscada, a campanha vizinha, com uma linha que cruza o início estendido,
-- passaria a exigir uma data ainda anterior e a conta falharia para sempre.
--
-- FALTA DE COBERTURA É POR CAMPANHA. A campanha cuja janela não cabe no que foi
-- buscado (linha antiga demais, ou além dos 37 meses que a Meta aceita) não é
-- tocada: a planilha dela continua valendo, e ela volta em `conflitos`. Uma
-- campanha ruim não derruba o gasto das outras.
--
-- O RECÁLCULO. `total_spend`, `synced_at`, o período coberto e `spend_source`
-- saem da RPC da planilha e vão para UMA função, `ad_campaign_recalc_spend`,
-- chamada pelas duas escritas. Ela é security definer: é o que deixa a planilha
-- continuar funcionando em campanha sincronizada, cujos campos da Meta ficam
-- travados para `authenticated` (gatilho `ad_campaigns_guard_meta`).
--
-- MÉTRICAS "SEGUNDO A META" NUM LUGAR SÓ. `meta_metricas` e
-- `meta_metricas_por_canal` só SOMAM e DIVIDEM. A regra "resultado do canal"
-- (formulário → lead_grouped; WhatsApp → maior contador de conversa; LP →
-- pixel; misto → soma) mora em `_shared/metaInsights.ts` e chega pronta na
-- coluna `resultados`, gravada pela sincronização.
--
-- Idempotente: `if not exists` nas tabelas e colunas, `create or replace` nas
-- funções, `drop ... if exists` antes de policy e gatilho.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contas de anúncios escolhidas (a seleção NÃO fica no config do cofre: ele
--    vai para o navegador em list_integrations e não tem FK)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ad_accounts (
  id                       uuid primary key default gen_random_uuid(),
  act_id                   text not null unique,
  name                     text,
  currency                 text,
  timezone_name            text,
  enabled                  boolean not null default true,
  -- Campos crus da Meta, já em reais. Quem decide o estado é a 0117
  -- (meta_classifica_conta); `balance` nunca entra: na Meta ele é valor a pagar.
  account_status           int,
  disable_reason           int,
  is_prepay                boolean,
  amount_spent             numeric(14,2),
  spend_cap                numeric(14,2),
  prepay_available         numeric(14,2),
  account_checked_at       timestamptz,
  balance_state            text not null default 'desconhecido',
  balance_state_changed_at timestamptz,
  last_sync_attempt_at     timestamptz,
  last_sync_ok_at          timestamptz,
  last_sync_error          text,
  -- Limites dos alertas, por conta (gravados pela 0117).
  cpl_limite               numeric(12,2),
  gasto_sem_lead_limite    numeric(12,2) default 50,
  gasto_sem_lead_dias      int default 3,
  verba_mensal             numeric(14,2),
  verba_aviso_pct          int default 85,
  saldo_baixo_limite       numeric(12,2) default 100,

  constraint meta_ad_accounts_act_id_formato check (act_id ~ '^act_[0-9]+$'),
  constraint meta_ad_accounts_balance_state_valido
    check (balance_state in ('rodando','saldo_baixo','sem_saldo','bloqueada','desconhecido')),
  constraint meta_ad_accounts_gasto_sem_lead_dias_faixa
    check (gasto_sem_lead_dias is null or gasto_sem_lead_dias between 1 and 30),
  constraint meta_ad_accounts_verba_aviso_pct_faixa
    check (verba_aviso_pct is null or verba_aviso_pct between 50 and 100),
  constraint meta_ad_accounts_limites_nao_negativos check (
    coalesce(cpl_limite, 0) >= 0 and coalesce(gasto_sem_lead_limite, 0) >= 0
    and coalesce(verba_mensal, 0) >= 0 and coalesce(saldo_baixo_limite, 0) >= 0)
);

comment on table public.meta_ad_accounts is
  'Contas de anúncios (act_) que o token da Marketing API alcança e que o administrador escolheu. Desligar (enabled = false) tira da sincronização e congela as ações, sem apagar histórico. Só RPC definer grava.';

-- -----------------------------------------------------------------------------
-- 2. Execuções da sincronização
-- -----------------------------------------------------------------------------
create table if not exists public.meta_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.meta_ad_accounts(id) on delete cascade,
  trigger      text not null check (trigger in ('cron','manual')),
  requested_by uuid references public.profiles(id) on delete set null,
  status       text not null default 'rodando' check (status in ('rodando','ok','falhou')),
  -- Janela PEDIDA: o que ficou sincronizado para toda campanha da conta que não
  -- voltou em conflito. É daqui que sai a cobertura ("dados desde dd/mm").
  window_start date,
  window_end   date,
  campaigns    int,
  rows         int,
  error        text,
  started_at   timestamptz not null default clock_timestamp(),
  finished_at  timestamptz
);

create index if not exists meta_sync_runs_account_started_idx
  on public.meta_sync_runs (account_id, started_at desc);

-- Duas execuções simultâneas da mesma conta apagariam e regravariam a mesma
-- janela uma por cima da outra. A trava vive no banco, não só na RPC.
create unique index if not exists meta_sync_runs_uma_rodando_por_conta
  on public.meta_sync_runs (account_id) where status = 'rodando';

-- -----------------------------------------------------------------------------
-- 3. Insights diários por campanha, como a Meta os devolve
-- -----------------------------------------------------------------------------
create table if not exists public.meta_campaign_insights_daily (
  campaign_id   uuid not null references public.ad_campaigns(id) on delete cascade,
  day           date not null,
  spend         numeric(14,2) not null default 0,
  impressions   bigint not null default 0,
  -- Alcance é pessoa única POR DIA: somar dias inventa número (ver meta_metricas).
  reach         bigint not null default 0,
  clicks        bigint not null default 0,
  link_clicks   bigint not null default 0,
  leads_form    int not null default 0,
  conversations int not null default 0,
  lp_leads      int not null default 0,
  -- Apoio: visita na LP nunca conta como resultado.
  lp_views      int not null default 0,
  -- Resultado do canal da campanha, calculado por resultadoDoCanal
  -- (_shared/metaInsights.ts) e gravado pela sincronização. O SQL só soma.
  resultados    int not null default 0,
  run_id        uuid references public.meta_sync_runs(id) on delete set null,
  synced_at     timestamptz not null default clock_timestamp(),

  primary key (campaign_id, day),
  constraint meta_insights_nao_negativos check (
    spend >= 0 and impressions >= 0 and reach >= 0 and clicks >= 0 and link_clicks >= 0
    and leads_form >= 0 and conversations >= 0 and lp_leads >= 0 and lp_views >= 0 and resultados >= 0)
);

-- -----------------------------------------------------------------------------
-- 4. RLS e grants: LER por reports.view_finance; escrever, só as RPCs definer
--
-- INSERT, UPDATE e DELETE revogados de `authenticated`: só as RPCs definer e a
-- edge (service role) gravam, e a recusa é alta (42501), não um "0 linhas"
-- silencioso. A exceção ao contrato da 0023 está declarada, com o motivo, no
-- 06_anon_surface.
-- -----------------------------------------------------------------------------
alter table public.meta_ad_accounts             enable row level security;
alter table public.meta_sync_runs               enable row level security;
alter table public.meta_campaign_insights_daily enable row level security;

drop policy if exists meta_ad_accounts_select on public.meta_ad_accounts;
create policy meta_ad_accounts_select on public.meta_ad_accounts
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists meta_sync_runs_select on public.meta_sync_runs;
create policy meta_sync_runs_select on public.meta_sync_runs
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists meta_campaign_insights_daily_select on public.meta_campaign_insights_daily;
create policy meta_campaign_insights_daily_select on public.meta_campaign_insights_daily
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

revoke all on public.meta_ad_accounts, public.meta_sync_runs, public.meta_campaign_insights_daily from anon;
revoke insert, update, delete, truncate
  on public.meta_ad_accounts, public.meta_sync_runs, public.meta_campaign_insights_daily
  from authenticated;

-- -----------------------------------------------------------------------------
-- 5. Colunas novas no livro e nas campanhas
-- -----------------------------------------------------------------------------
alter table public.ad_campaign_spend
  add column if not exists source text not null default 'planilha'
    constraint ad_campaign_spend_source_valida check (source in ('planilha','meta_api'));

comment on column public.ad_campaign_spend.source is
  'De onde veio a linha: planilha (relatório importado, recorte do arquivo) ou meta_api (sincronização, um dia por linha). As linhas anteriores à 0115 são planilha.';

alter table public.ad_campaigns
  add column if not exists meta_account_id uuid references public.meta_ad_accounts(id) on delete set null,
  add column if not exists meta_channel text
    constraint ad_campaigns_meta_channel_valido
    check (meta_channel in ('formulario','whatsapp','landing_page','misto','outro')),
  add column if not exists meta_effective_status text,
  add column if not exists meta_budget_level text
    constraint ad_campaigns_meta_budget_level_valido
    check (meta_budget_level in ('campaign','adset','lifetime')),
  add column if not exists developer_suggested_id uuid references public.developers(id) on delete set null,
  add column if not exists spend_source text
    constraint ad_campaigns_spend_source_valido
    check (spend_source in ('planilha','meta_api','misto'));

comment on column public.ad_campaigns.meta_account_id is
  'Conta de anúncios de onde a campanha é sincronizada. Preenchido = campanha sincronizada: nome, status, verba e gasto vêm da Meta e não se editam à mão (ad_campaigns_guard_meta).';
comment on column public.ad_campaigns.developer_suggested_id is
  'Construtora sugerida pelo nome da campanha no padrão F0 (_shared/campaignName.ts). Só sugestão: o vínculo (developer_id) continua exigindo um clique humano.';
comment on column public.ad_campaigns.spend_source is
  'Procedência de total_spend segundo o livro: planilha, meta_api ou misto. Nulo = digitado.';

-- -----------------------------------------------------------------------------
-- 6. Gasto mexido à mão volta a ser "digitado" — agora também sem procedência
--
-- Mesmo corpo da 0113, mais `spend_source`: sem isso a tela diria "sincronizado
-- da Meta" sobre um número que uma pessoa digitou.
-- -----------------------------------------------------------------------------
create or replace function public.ad_campaigns_marca_gasto_digitado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.total_spend is distinct from old.total_spend
     and new.synced_at is not distinct from old.synced_at then
    new.synced_at          := null;
    new.spend_period_start := null;
    new.spend_period_end   := null;
    new.spend_source       := null;
  end if;
  return new;
end;
$$;

revoke all on function public.ad_campaigns_marca_gasto_digitado() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. O recálculo único de total_spend (planilha e sincronização)
--
-- `synced_at` avança para o relógio de parede sempre que o total muda: é o que
-- desvia do gatilho do item 6 também quando a sincronização só APAGA dias
-- (a Meta passou a dizer zero onde havia gasto) e o maior `imported_at` que
-- sobrou é o mesmo de antes.
--
-- Campanha sem linha no livro só é tocada se o total dela JÁ vinha do livro
-- (synced_at preenchido) e ela é sincronizada: aí o zero é o que a Meta diz.
-- Sem isso, o total digitado de uma campanha adotada pela sincronização (o
-- histórico anterior à janela) viraria zero só porque a janela não teve gasto.
-- -----------------------------------------------------------------------------
create or replace function public.ad_campaign_recalc_spend(p_ids uuid[])
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if not (public.has_any_role('admin','marketing') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Sem permissão para recalcular o gasto de campanha (apenas admin, sócio e marketing).'
      using errcode = '42501';
  end if;

  with ids as (
    select distinct x as id from unnest(coalesce(p_ids, '{}'::uuid[])) as x
  ), s as (
    select sp.campaign_id,
           sum(sp.spend)                     as soma,
           max(sp.imported_at)               as ultimo,
           min(sp.period_start)              as inicio,
           max(sp.period_end)                as fim,
           bool_or(sp.source = 'planilha')   as tem_planilha,
           bool_or(sp.source = 'meta_api')   as tem_api
      from public.ad_campaign_spend sp
     where sp.campaign_id in (select id from ids)
     group by sp.campaign_id
  )
  update public.ad_campaigns c
     set total_spend        = coalesce(s.soma, 0),
         synced_at          = case
                                when coalesce(s.soma, 0) is distinct from c.total_spend then clock_timestamp()
                                else coalesce(s.ultimo, c.synced_at)
                              end,
         spend_period_start = s.inicio,
         spend_period_end   = s.fim,
         spend_source       = case
                                when s.tem_planilha and s.tem_api then 'misto'
                                when s.tem_api                    then 'meta_api'
                                when s.tem_planilha               then 'planilha'
                                else 'meta_api'  -- sem linha: só chega aqui campanha sincronizada
                              end
    from ids
    left join s on s.campaign_id = ids.id
   where c.id = ids.id
     and (s.campaign_id is not null
          or (c.meta_account_id is not null and c.synced_at is not null));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.ad_campaign_recalc_spend(uuid[]) is
  'total_spend = soma do livro (ad_campaign_spend), com synced_at, período coberto e spend_source na MESMA instrução. Única fonte da regra: chamada por marketing_import_ad_spend e por meta_sync_apply. Aceita admin, sócio, marketing ou service_role.';

revoke all on function public.ad_campaign_recalc_spend(uuid[]) from public, anon;
grant execute on function public.ad_campaign_recalc_spend(uuid[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. A importação da planilha: mesma assinatura, mesmo comportamento; o update
--    final passa a ser o recálculo único. Linha nova sai 'planilha' pelo default.
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
  'Grava o gasto do relatório da Meta por campanha e período, em uma transação. Reimportar o mesmo arquivo não duplica (chave campanha+período) e um recorte sobreposto substitui o anterior, venha ele de planilha ou da sincronização. O total sai de ad_campaign_recalc_spend.';

revoke all on function public.marketing_import_ad_spend(jsonb, text) from public, anon;
grant execute on function public.marketing_import_ad_spend(jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Campo que vem da Meta não se edita à mão
--
-- Status 'PAUSED' digitado numa campanha que continua gastando na Meta é número
-- inventado na tela; a pausa real é pelo meta-campaign-action. Trocar
-- external_id, platform ou meta_account_id de uma campanha sincronizada faria a
-- próxima sincronização criar OUTRA linha com o id real, e o investimento
-- passaria a somar a mesma Meta duas vezes.
--
-- Passam postgres e service_role (mesmo padrão da 0037/0059) e, por isso, as
-- funções security definer (recálculo, apply, finish da ação): dentro delas
-- current_user é o dono. O vínculo (developer_id, lead_source_id, período) e a
-- sugestão continuam editáveis.
-- -----------------------------------------------------------------------------
create or replace function public.ad_campaigns_guard_meta()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.meta_account_id is not null or new.spend_source is not null then
      raise exception 'Campanha sincronizada com a Meta só nasce pela sincronização: cadastre sem conta de anúncios e ela é adotada na próxima sincronização.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.meta_account_id is distinct from old.meta_account_id
     or (new.spend_source is distinct from old.spend_source and new.spend_source is not null) then
    raise exception 'A conta de anúncios e a procedência do gasto são gravadas pela sincronização, não à mão.'
      using errcode = '42501';
  end if;

  if old.meta_account_id is not null and
     (new.name, new.status, new.daily_budget, new.lifetime_budget, new.total_spend,
      new.synced_at, new.spend_period_start, new.spend_period_end, new.spend_source,
      new.external_id, new.platform,
      new.meta_channel, new.meta_effective_status, new.meta_budget_level)
     is distinct from
     (old.name, old.status, old.daily_budget, old.lifetime_budget, old.total_spend,
      old.synced_at, old.spend_period_start, old.spend_period_end, old.spend_source,
      old.external_id, old.platform,
      old.meta_channel, old.meta_effective_status, old.meta_budget_level) then
    raise exception 'Campo vem da Meta: nome, status, verba, gasto e identificação desta campanha só mudam pela sincronização ou pelas ações Pausar, Ativar e Mudar verba. O vínculo com construtora, origem e período continua editável.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.ad_campaigns_guard_meta() from public, anon, authenticated;

drop trigger if exists ad_campaigns_guard_meta on public.ad_campaigns;
create trigger ad_campaigns_guard_meta
  before insert or update on public.ad_campaigns
  for each row execute function public.ad_campaigns_guard_meta();

-- -----------------------------------------------------------------------------
-- 10. A janela de uma campanha — a regra que a edge (via meta_sync_window) e a
--     apply usam. Interna.
-- -----------------------------------------------------------------------------
create or replace function public.meta_janela_campanha(p_campaign_id uuid, p_inicio date, p_fim date)
returns daterange
language sql
stable
set search_path = public, pg_temp
as $$
  select daterange(
           least(p_inicio, min(s.period_start)),
           greatest(p_fim, max(s.period_end)),
           '[]')
    from public.ad_campaign_spend s
   where s.campaign_id  = p_campaign_id
     and s.period_start <= p_fim
     and s.period_end   >= p_inicio;
$$;

comment on function public.meta_janela_campanha(uuid, date, date) is
  'Recorte pedido [p_inicio, p_fim] estendido para conter INTEIRA toda linha do livro da campanha que o cruze. Linhas da mesma campanha não se cruzam (0114), então não há cascata.';

revoke all on function public.meta_janela_campanha(uuid, date, date)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Sincronização — só service role (edge meta-sync)
-- -----------------------------------------------------------------------------
create or replace function public.meta_sync_start(p_account_id uuid, p_trigger text, p_requested_by uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_id      uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role inicia sincronização.' using errcode = '42501';
  end if;
  if p_trigger is null or p_trigger not in ('cron', 'manual') then
    raise exception 'Origem da sincronização inválida (cron ou manual).' using errcode = '22023';
  end if;

  -- Trava a conta: duas chamadas simultâneas passam por aqui em fila.
  select a.enabled into v_enabled from public.meta_ad_accounts a where a.id = p_account_id for update;
  if not found then
    raise exception 'Conta de anúncios não encontrada.' using errcode = '22023';
  end if;
  if not v_enabled then
    raise exception 'Conta de anúncios desligada: ligue-a em /admin/meta-ads para sincronizar.' using errcode = '22023';
  end if;

  -- Execução parada há mais de 15 min morreu com a edge (que tem limite de tempo
  -- bem menor): sem isso, a conta ficaria travada para sempre.
  update public.meta_sync_runs
     set status = 'falhou',
         error = 'Interrompida: ficou mais de 15 minutos sem terminar.',
         finished_at = clock_timestamp()
   where account_id = p_account_id
     and status = 'rodando'
     and started_at < clock_timestamp() - interval '15 minutes';

  if exists (select 1 from public.meta_sync_runs r where r.account_id = p_account_id and r.status = 'rodando') then
    raise exception 'Já há uma sincronização desta conta em andamento.' using errcode = '55P03';
  end if;

  insert into public.meta_sync_runs (account_id, trigger, requested_by)
  values (p_account_id, p_trigger, p_requested_by)
  returning id into v_id;

  update public.meta_ad_accounts set last_sync_attempt_at = clock_timestamp() where id = p_account_id;
  return v_id;
end;
$$;

-- Menor data que a edge precisa pedir à Meta. Considera TODAS as campanhas da
-- conta (inclusive a apagada na Meta, que não sai em /campaigns mas pode ter
-- planilha cruzando a janela) e as external_ids listadas, ainda não adotadas.
-- Campanha cuja janela passaria dos 37 meses que a Meta aceita fica de fora do
-- mínimo: ela vira conflito na apply, e o resto da conta sincroniza.
create or replace function public.meta_sync_window(p_account_id uuid, p_external_ids text[], p_inicio date, p_fim date)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limite date := (current_date - interval '37 months')::date + 1;
  v_inicio date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role calcula a janela de sincronização.' using errcode = '42501';
  end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim then
    raise exception 'Janela pedida inválida.' using errcode = '22023';
  end if;

  select least(p_inicio, min(lower(x.j)))
    into v_inicio
    from (
      select public.meta_janela_campanha(c.id, p_inicio, p_fim) as j
        from public.ad_campaigns c
       where c.platform = 'meta'
         and (c.meta_account_id = p_account_id
              or c.external_id = any (coalesce(p_external_ids, '{}'::text[])))
    ) x
   where lower(x.j) >= v_limite;

  return v_inicio;
end;
$$;

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
    select a.id, a.external_id from public.ad_campaigns a where a.id = any (v_todas)
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
  'Grava uma sincronização completa numa transação: upsert das campanhas, troca do livro e dos insights pela janela de cada campanha (meta_janela_campanha sobre a janela_pedida, conferida contra a janela_buscada), recálculo e estado da conta. Campanha sem cobertura não é tocada e volta em conflitos. Service role.';

-- Encerra a execução como 'falhou'. O 'ok' é fechado só pela meta_sync_apply,
-- junto com os dados: um 'ok' sem dados faria a tela dizer "sincronizado" sobre
-- número velho. finish('ok') numa execução já 'ok' é aceito e não faz nada.
create or replace function public.meta_sync_finish(p_run_id uuid, p_status text, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_erro    text := left(coalesce(nullif(btrim(p_error), ''), 'Falha sem mensagem.'), 1000);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role encerra sincronização.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('ok', 'falhou') then
    raise exception 'Status de encerramento inválido (ok ou falhou).' using errcode = '22023';
  end if;

  if p_status = 'ok' then
    if exists (select 1 from public.meta_sync_runs r where r.id = p_run_id and r.status = 'rodando') then
      raise exception 'Execução ok só é encerrada pela meta_sync_apply, junto com os dados.' using errcode = '22023';
    end if;
    return;
  end if;

  update public.meta_sync_runs
     set status = 'falhou', error = v_erro, finished_at = clock_timestamp()
   where id = p_run_id and status = 'rodando'
  returning account_id into v_account;

  -- Já encerrada: repetir não muda nada (idempotente).
  if v_account is null then
    return;
  end if;

  update public.meta_ad_accounts set last_sync_error = v_erro where id = v_account;
end;
$$;

revoke all on function public.meta_sync_start(uuid, text, uuid)           from public, anon, authenticated;
revoke all on function public.meta_sync_window(uuid, text[], date, date)  from public, anon, authenticated;
revoke all on function public.meta_sync_apply(uuid, jsonb)                from public, anon, authenticated;
revoke all on function public.meta_sync_finish(uuid, text, text)          from public, anon, authenticated;
grant execute on function public.meta_sync_start(uuid, text, uuid)          to service_role;
grant execute on function public.meta_sync_window(uuid, text[], date, date) to service_role;
grant execute on function public.meta_sync_apply(uuid, jsonb)               to service_role;
grant execute on function public.meta_sync_finish(uuid, text, text)         to service_role;

-- -----------------------------------------------------------------------------
-- 12. Escolher as contas — settings.integrations (administrador e sócio)
--
-- A edge meta-ads-connect relista /me/adaccounts e só manda as contas que o
-- token alcança; chama esta RPC com o cliente do USUÁRIO, então a permissão é
-- conferida de novo aqui. Conta fora da lista é desligada, não apagada.
-- -----------------------------------------------------------------------------
create or replace function public.meta_accounts_save(p_accounts jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para escolher as contas de anúncios (apenas administrador e sócio).'
      using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_accounts, 'null'::jsonb)) <> 'array' then
    raise exception 'As contas precisam chegar como lista.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_accounts) as x
              where coalesce(x->>'act_id', '') !~ '^act_[0-9]+$') then
    raise exception 'Conta de anúncios inválida: o id precisa ser act_ seguido de números.' using errcode = '22023';
  end if;

  insert into public.meta_ad_accounts (act_id, name, currency, timezone_name, enabled)
  select distinct on (x->>'act_id')
         x->>'act_id',
         left(nullif(btrim(x->>'name'), ''), 200),
         left(nullif(btrim(x->>'currency'), ''), 10),
         left(nullif(btrim(x->>'timezone_name'), ''), 64),
         true
    from jsonb_array_elements(p_accounts) as x
  on conflict (act_id) do update
     set name          = coalesce(excluded.name, meta_ad_accounts.name),
         currency      = coalesce(excluded.currency, meta_ad_accounts.currency),
         timezone_name = coalesce(excluded.timezone_name, meta_ad_accounts.timezone_name),
         enabled       = true;
  get diagnostics v_n = row_count;

  update public.meta_ad_accounts a
     set enabled = false
   where a.enabled
     and not exists (select 1 from jsonb_array_elements(p_accounts) as x where x->>'act_id' = a.act_id);

  return v_n;
end;
$$;

revoke all on function public.meta_accounts_save(jsonb) from public, anon;
grant execute on function public.meta_accounts_save(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 13. Métricas "segundo a Meta" — o painel, os alertas e as IAs leem daqui
-- -----------------------------------------------------------------------------
create or replace function public.meta_metricas(p_from date, p_to date)
returns table (
  campaign_id         uuid,
  external_id         text,
  name                text,
  account_id          uuid,
  channel             text,
  spend               numeric,
  impressions         bigint,
  reach               bigint,
  clicks              bigint,
  link_clicks         bigint,
  ctr                 numeric,
  cpc                 numeric,
  cpm                 numeric,
  leads_form          int,
  conversations       int,
  lp_leads            int,
  resultados          int,
  custo_por_resultado numeric,
  dias                int,
  cobertura_desde     date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('reports.view_finance') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Sem permissão para ver os números da Meta.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;

  return query
  with t as (
    select i.campaign_id,
           sum(i.spend)                 as spend,
           sum(i.impressions)::bigint   as impressions,
           sum(i.reach)::bigint         as reach,
           sum(i.clicks)::bigint        as clicks,
           sum(i.link_clicks)::bigint   as link_clicks,
           sum(i.leads_form)::int       as leads_form,
           sum(i.conversations)::int    as conversations,
           sum(i.lp_leads)::int         as lp_leads,
           sum(i.resultados)::int       as resultados,
           count(*)::int                as dias
      from public.meta_campaign_insights_daily i
     where i.day between p_from and p_to
     group by i.campaign_id
  )
  select c.id,
         c.external_id,
         c.name,
         c.meta_account_id,
         coalesce(c.meta_channel, 'outro'),
         t.spend,
         t.impressions,
         case when p_from = p_to then t.reach end,
         t.clicks,
         t.link_clicks,
         round(t.link_clicks::numeric / nullif(t.impressions, 0), 6),
         round(t.spend / nullif(t.link_clicks, 0), 2),
         round(t.spend * 1000 / nullif(t.impressions, 0), 2),
         t.leads_form,
         t.conversations,
         t.lp_leads,
         t.resultados,
         round(t.spend / nullif(t.resultados, 0), 2),
         t.dias,
         (select min(r.window_start) from public.meta_sync_runs r
           where r.account_id = c.meta_account_id and r.status = 'ok')
    from t
    join public.ad_campaigns c on c.id = t.campaign_id
   order by t.spend desc, c.name;
end;
$$;

comment on function public.meta_metricas(date, date) is
  'Números "segundo a Meta" por campanha no período, somados dos insights diários. Só soma e divide: resultados já vem gravado pelo canal da campanha (resultadoDoCanal, _shared/metaInsights.ts). CTR = link_clicks / impressions, em FRAÇÃO (0,0123 = 1,23%): é o "CTR (taxa de cliques no link)" do Gerenciador. CPC = spend / link_clicks (custo por clique no link). CPM = spend * 1000 / impressions. Denominador zero devolve nulo. reach só quando p_from = p_to: alcance é pessoa única por período e somar dias inventa número. cobertura_desde = primeiro dia sincronizado da conta (menor janela de meta_sync_runs ok); período que começa antes dele está incompleto, e a tela diz "dados desde dd/mm". Exige reports.view_finance ou service_role.';

revoke all on function public.meta_metricas(date, date) from public, anon;
grant execute on function public.meta_metricas(date, date) to authenticated, service_role;

-- Custo por resultado de cada canal = gasto das campanhas daquele canal ÷
-- resultados delas. Nunca o gasto total dividido por canal. Lê meta_metricas,
-- que já confere o acesso: a conta não é escrita duas vezes.
create or replace function public.meta_metricas_por_canal(p_from date, p_to date)
returns table (channel text, spend numeric, resultados int, custo_por_resultado numeric, campanhas int)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.channel,
         sum(m.spend),
         sum(m.resultados)::int,
         round(sum(m.spend) / nullif(sum(m.resultados), 0), 2),
         count(*)::int
    from public.meta_metricas(p_from, p_to) as m
   group by m.channel
   order by sum(m.spend) desc;
$$;

comment on function public.meta_metricas_por_canal(date, date) is
  'Gasto, resultados e custo por resultado por canal (formulario, whatsapp, landing_page, misto, outro), agregados de meta_metricas. Mesma checagem de acesso.';

revoke all on function public.meta_metricas_por_canal(date, date) from public, anon;
grant execute on function public.meta_metricas_por_canal(date, date) to authenticated, service_role;
