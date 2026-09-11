-- =============================================================================
-- 0116 · Ações na Meta, fila do gestor IA, execuções de IA, planos e alertas
--
-- O PEDIDO (F1.3, F1.6, F2.1, F2.2, F2.3): pausar, ativar e mudar verba de
-- campanha na Meta pelo CRM; o gestor de tráfego IA propõe e uma PESSOA aprova;
-- nota por anúncio e planejador com custo de IA previsível; e a tabela dos
-- alertas que a 0117 avalia.
--
-- UMA TABELA É A FILA E A AUDITORIA (`meta_actions`). A ação manual nasce
-- 'aprovada' por `meta_action_create`; a da IA nasce 'proposta' por
-- `meta_action_propose` (só service role, vale 24 h) e só anda por
-- `meta_action_decide`. As duas seguem pelo MESMO executor (edge
-- meta-campaign-action: `meta_action_claim` → Graph → `meta_action_finish`).
-- Ninguém escreve direto: sem policy de insert e sem update/delete para
-- `authenticated`, só estas RPCs gravam. E nada passa de 'proposta' sem
-- `decided_at`: não existe caminho em que a IA dispense a aprovação.
--
-- A REGRA DOS 30% NUM LUGAR SÓ (`meta_action_precisa_aprendizado`). Criar e
-- aprovar a usam contra a verba do banco; o executor chama a MESMA função com a
-- verba lida AO VIVO na Meta, porque a do banco pode estar um dia atrasada.
-- `exigiu_aprendizado` = a pessoa aceitou o aviso da fase de aprendizado; sem
-- ele o executor não sobe verba que ao vivo passe dos 30% e encerra a ação com
-- 'precisa_confirmar' (a proposta da IA volta para a fila).
--
-- CUSTO DE IA PREVISÍVEL (`meta_ai_run_start`). O cron é uma execução por conta,
-- tipo e dia (índice único); o manual reaproveita a execução ok com os mesmos
-- parâmetros de até 10 min, ou a que ainda roda há menos de 5 min.
--
-- PLANO SÓ PELA EDGE. "Interesse com ID devolvido pela Meta" e "HOUSING fixo"
-- só são garantidos na edge meta-campaign-planner, que grava com a service role
-- e created_by = quem pediu. Por isso `meta_campaign_plans` NÃO tem policy de
-- insert: um plano forjado pelo PostgREST sairia impresso como validado.
--
-- Idempotente: `if not exists` em tabela e índice, `create or replace` em
-- função, `drop ... if exists` antes de policy, `on conflict` no catálogo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Código novo na matriz
--
-- has_permission() curto-circuita em administrador e sócio (is_admin, 0097);
-- as linhas deles existem para a tela de Permissões mostrar o estado real
-- (mesmo padrão da 0092). Diretor e gerente leem por reports.view_finance e só
-- mexem na Meta se o admin ligar o switch.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description)
values (
  'marketing.meta_manage',
  'Gerenciar campanhas na Meta',
  'marketing',
  'Pausar, ativar e mudar verba de campanha na Meta, aprovar ou recusar a fila do gestor IA, rodar as análises de IA, sincronizar sob demanda, salvar plano e mudar os limites dos alertas.'
)
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

insert into public.role_permissions (role, permission, allowed) values
  ('marketing', 'marketing.meta_manage', true),
  ('admin',     'marketing.meta_manage', true),
  ('partner',   'marketing.meta_manage', true)
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Execuções de IA (nota por anúncio e gestor de tráfego)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_ai_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('nota_anuncios', 'gestor')),
  account_id   uuid not null references public.meta_ad_accounts(id) on delete cascade,
  trigger      text not null check (trigger in ('cron', 'manual')),
  requested_by uuid references public.profiles(id) on delete set null,
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'rodando' check (status in ('rodando', 'ok', 'falhou')),
  result       jsonb,
  error        text,
  model        text,
  tokens_in    int check (tokens_in >= 0),
  tokens_out   int check (tokens_out >= 0),
  run_date     date not null default (now() at time zone 'America/Sao_Paulo')::date,
  started_at   timestamptz not null default clock_timestamp(),
  finished_at  timestamptz
);

-- O cron chama de novo no mesmo dia (reentrega, job repetido) e recebe a mesma
-- execução: a IA é paga uma vez por conta, tipo e dia.
create unique index if not exists meta_ai_runs_um_cron_por_dia
  on public.meta_ai_runs (account_id, kind, run_date) where trigger = 'cron';

-- -----------------------------------------------------------------------------
-- 3. Ações na Meta: auditoria e fila de aprovação
-- -----------------------------------------------------------------------------
create table if not exists public.meta_actions (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid references public.meta_ad_accounts(id) on delete set null,
  campaign_id          uuid references public.ad_campaigns(id) on delete set null,
  campaign_external_id text not null,
  -- Foto do momento: o histórico continua legível se a campanha for renomeada.
  campaign_name        text,
  origem               text not null check (origem in ('manual', 'ia')),
  ai_run_id            uuid references public.meta_ai_runs(id) on delete set null,
  acao                 text not null check (acao in ('pausar', 'ativar', 'verba')),
  verba_anterior       numeric(12,2),
  verba_nova           numeric(12,2),
  variacao             numeric,
  exigiu_aprendizado   boolean not null default false,
  motivo               text,
  status               text not null check (status in
                         ('proposta', 'aprovada', 'executando', 'executada',
                          'parcial', 'falhou', 'recusada', 'expirada')),
  requested_by         uuid references public.profiles(id) on delete set null,
  decided_by           uuid references public.profiles(id) on delete set null,
  decided_at           timestamptz,
  executed_at          timestamptz,
  resultado            jsonb,
  erro                 text,
  expires_at           timestamptz,
  created_at           timestamptz not null default clock_timestamp(),

  constraint meta_actions_verba_so_em_verba check (
    (acao = 'verba' and verba_nova > 0) or (acao <> 'verba' and verba_nova is null)),
  -- A garantia de que a IA não mexe em dinheiro sozinha, escrita onde nenhum
  -- caminho novo escapa dela: fora da fila, toda ação tem uma decisão humana.
  constraint meta_actions_so_anda_com_decisao check (
    status in ('proposta', 'expirada') or decided_at is not null)
);

comment on table public.meta_actions is
  'Toda ação na Meta (pausar, ativar, verba), manual ou proposta pelo gestor IA: é a fila de aprovação e o registro de auditoria. Só as RPCs meta_action_* gravam.';
comment on column public.meta_actions.variacao is
  'Variação da verba em fração ((nova - atual) / atual; 0.30 = +30%), contra a verba do banco no momento da decisão.';
comment on column public.meta_actions.exigiu_aprendizado is
  'A pessoa aceitou o aviso da fase de aprendizado (subida de 30% ou mais, meta_action_precisa_aprendizado). Sem isto o executor não sobe verba que, lida ao vivo na Meta, passe dos 30%.';

-- Uma proposta aberta por campanha e ação: o gestor que roda de novo não enche
-- a fila com a mesma sugestão.
create unique index if not exists meta_actions_uma_proposta_aberta
  on public.meta_actions (campaign_id, acao) where status = 'proposta';

-- -----------------------------------------------------------------------------
-- 4. Planos de campanha (planejador)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_campaign_plans (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid references public.developers(id) on delete set null,
  project_id   uuid references public.developer_projects(id) on delete set null,
  padrao       text not null check (padrao in ('mcmv', 'medio', 'alto')),
  formato      text not null check (formato in ('imagem', 'video', 'carrossel')),
  canal        text not null check (canal in ('formulario', 'whatsapp', 'landing_page')),
  verba_diaria numeric(12,2) not null check (verba_diaria > 0),
  -- O link é só texto dentro do plano: nada no servidor o baixa.
  link         text check (link is null or (link ~* '^https://' and length(link) <= 500)),
  observacoes  text check (observacoes is null or length(observacoes) <= 1000),
  nome         text not null,
  plano        jsonb not null check (jsonb_typeof(plano) = 'object'),
  model        text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default clock_timestamp()
);

-- -----------------------------------------------------------------------------
-- 5. Alertas da Meta (avaliados pela 0117)
-- -----------------------------------------------------------------------------
create table if not exists public.meta_alerts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.meta_ad_accounts(id) on delete cascade,
  campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  kind        text not null check (kind in
                ('cpl_alto', 'gasto_sem_lead', 'verba_mes_aviso', 'verba_mes_esgotada', 'sync_falhou')),
  dedupe_key  text not null,
  valor       numeric(14,2),
  limite      numeric(14,2),
  mensagem    text not null,
  opened_at   timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  notified_at timestamptz
);

-- Um alerta aberto por chave: notifica ao abrir e não repete a cada sincronização.
create unique index if not exists meta_alerts_um_aberto_por_chave
  on public.meta_alerts (dedupe_key) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- 6. RLS e grants: LER por reports.view_finance; escrever, só as RPCs definer
--
-- O INSERT de `authenticated` fica concedido (é o contrato da 0023 que o
-- 06_anon_surface cobra em toda tabela), mas sem policy de escrita a RLS o
-- recusa com 42501. UPDATE e DELETE são revogados para a recusa ser alta, e
-- não um "0 linhas" silencioso.
-- -----------------------------------------------------------------------------
alter table public.meta_ai_runs        enable row level security;
alter table public.meta_actions        enable row level security;
alter table public.meta_campaign_plans enable row level security;
alter table public.meta_alerts         enable row level security;

drop policy if exists meta_ai_runs_select on public.meta_ai_runs;
create policy meta_ai_runs_select on public.meta_ai_runs
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists meta_actions_select on public.meta_actions;
create policy meta_actions_select on public.meta_actions
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists meta_campaign_plans_select on public.meta_campaign_plans;
create policy meta_campaign_plans_select on public.meta_campaign_plans
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

drop policy if exists meta_alerts_select on public.meta_alerts;
create policy meta_alerts_select on public.meta_alerts
  for select to authenticated
  using (public.has_permission('reports.view_finance'));

revoke all on public.meta_ai_runs, public.meta_actions, public.meta_campaign_plans, public.meta_alerts
  from anon;
-- INSERT também: só as RPCs definer e as edges (service role) gravam. A exceção
-- está declarada, com o motivo, no 06_anon_surface.
revoke insert, update, delete, truncate
  on public.meta_ai_runs, public.meta_actions, public.meta_campaign_plans, public.meta_alerts
  from authenticated;

-- -----------------------------------------------------------------------------
-- 7. A regra da fase de aprendizado — o banco (criar, aprovar) e o executor
--    (com a verba ao vivo) chamam esta função e nenhuma outra conta
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_precisa_aprendizado(p_atual numeric, p_novo numeric)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_atual > 0 and (p_novo - p_atual) / p_atual >= 0.30, false);
$$;

comment on function public.meta_action_precisa_aprendizado(numeric, numeric) is
  'Subida de verba de 30% ou mais sobre a atual: a campanha volta à fase de aprendizado e a ação exige confirmação. Redução, verba atual zero ou valor nulo não pedem. Única fonte da regra.';

-- -----------------------------------------------------------------------------
-- 8. As travas comuns de criar, aprovar e propor — interna
--
-- Campanha sincronizada, conta ligada, ação conhecida e, em verba, valor
-- positivo numa campanha com verba diária (CBO ou ABO). Devolve a foto da
-- campanha e a variação contra a verba ATUAL do banco.
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_validar(
  p_campaign_id uuid,
  p_acao        text,
  p_verba_nova  numeric,
  out o_account_id  uuid,
  out o_external_id text,
  out o_name        text,
  out o_verba_atual numeric,
  out o_verba_nova  numeric,
  out o_variacao    numeric,
  out o_precisa     boolean)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_nivel   text;
  v_enabled boolean;
begin
  if p_acao is null or p_acao not in ('pausar', 'ativar', 'verba') then
    raise exception 'Ação desconhecida: use pausar, ativar ou verba.' using errcode = '22023';
  end if;

  select c.meta_account_id, c.external_id, c.name, c.daily_budget, c.meta_budget_level, a.enabled
    into o_account_id, o_external_id, o_name, o_verba_atual, v_nivel, v_enabled
    from public.ad_campaigns c
    left join public.meta_ad_accounts a on a.id = c.meta_account_id
   where c.id = p_campaign_id;

  if not found then
    raise exception 'Campanha não encontrada.' using errcode = '22023';
  end if;
  if o_account_id is null then
    raise exception 'Esta campanha não vem de uma conta de anúncios sincronizada: pausar, ativar e mudar verba só valem para campanha da Meta.'
      using errcode = '22023';
  end if;
  if not v_enabled then
    raise exception 'A conta de anúncios desta campanha está desligada em /admin/meta-ads: as ações nela ficam congeladas.'
      using errcode = '22023';
  end if;

  o_precisa := false;
  if p_acao <> 'verba' then
    o_verba_atual := null;
    return;
  end if;

  if p_verba_nova is null or p_verba_nova <= 0 then
    raise exception 'A verba diária nova precisa ser maior que zero.' using errcode = '22023';
  end if;
  if v_nivel = 'lifetime' then
    raise exception 'Verba total: mude no Gerenciador de Anúncios.' using errcode = '22023';
  end if;
  if coalesce(v_nivel, '') not in ('campaign', 'adset') then
    raise exception 'Ainda não se sabe se a verba fica na campanha ou nos conjuntos: sincronize antes de mudar a verba.'
      using errcode = '22023';
  end if;

  o_verba_nova := round(p_verba_nova, 2);
  o_variacao   := round((o_verba_nova - o_verba_atual) / nullif(o_verba_atual, 0), 4);
  o_precisa    := public.meta_action_precisa_aprendizado(o_verba_atual, o_verba_nova);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Ação manual — nasce aprovada por quem clicou
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_create(
  p_campaign_id          uuid,
  p_acao                 text,
  p_verba_nova           numeric default null,
  p_confirma_aprendizado boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_chk record;
  v_id  uuid;
begin
  if not public.has_permission('marketing.meta_manage') then
    raise exception 'Sem permissão para mexer em campanha na Meta (Gerenciar campanhas na Meta).'
      using errcode = '42501';
  end if;

  select * into v_chk from public.meta_action_validar(p_campaign_id, p_acao, p_verba_nova);

  if v_chk.o_precisa and not coalesce(p_confirma_aprendizado, false) then
    return jsonb_build_object('status', 'precisa_confirmar', 'variacao', v_chk.o_variacao,
                              'verba_atual', v_chk.o_verba_atual, 'verba_nova', v_chk.o_verba_nova);
  end if;

  insert into public.meta_actions
    (account_id, campaign_id, campaign_external_id, campaign_name, origem, acao,
     verba_anterior, verba_nova, variacao, exigiu_aprendizado, status,
     requested_by, decided_by, decided_at)
  values
    (v_chk.o_account_id, p_campaign_id, v_chk.o_external_id, v_chk.o_name, 'manual', p_acao,
     v_chk.o_verba_atual, v_chk.o_verba_nova, v_chk.o_variacao,
     (p_acao = 'verba' and (v_chk.o_precisa or coalesce(p_confirma_aprendizado, false))),
     'aprovada', auth.uid(), auth.uid(), clock_timestamp())
  returning id into v_id;

  return jsonb_build_object('status', 'aprovada', 'action_id', v_id);
end;
$$;

comment on function public.meta_action_create(uuid, text, numeric, boolean) is
  'Pausar, ativar ou mudar a verba diária de uma campanha sincronizada. Exige marketing.meta_manage. Subida de 30% ou mais sem p_confirma_aprendizado devolve {status:precisa_confirmar} sem gravar; senão grava a ação aprovada e devolve {status:aprovada, action_id}. Quem executa é a edge meta-campaign-action.';

-- -----------------------------------------------------------------------------
-- 10. Decidir a proposta do gestor IA
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_decide(
  p_action_id            uuid,
  p_decisao              text,
  p_confirma_aprendizado boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_act record;
  v_chk record;
begin
  if not public.has_permission('marketing.meta_manage') then
    raise exception 'Sem permissão para decidir a fila do gestor IA (Gerenciar campanhas na Meta).'
      using errcode = '42501';
  end if;
  if p_decisao is null or p_decisao not in ('aprovar', 'recusar') then
    raise exception 'Decisão desconhecida: use aprovar ou recusar.' using errcode = '22023';
  end if;

  select * into v_act from public.meta_actions where id = p_action_id for update;
  if not found then
    raise exception 'Ação não encontrada.' using errcode = '22023';
  end if;

  if v_act.status = 'expirada'
     or (v_act.status = 'proposta' and v_act.expires_at <= clock_timestamp()) then
    update public.meta_actions set status = 'expirada' where id = p_action_id and status = 'proposta';
    return jsonb_build_object('status', 'expirada');
  end if;
  if v_act.status <> 'proposta' then
    raise exception 'Esta ação já foi decidida (%): nada foi feito de novo.', v_act.status
      using errcode = '55000';
  end if;

  if p_decisao = 'recusar' then
    update public.meta_actions
       set status = 'recusada', decided_by = auth.uid(), decided_at = clock_timestamp()
     where id = p_action_id;
    return jsonb_build_object('status', 'recusada');
  end if;

  -- Aprovar passa pelas MESMAS travas da ação manual, contra a verba ATUAL: a
  -- proposta pode ter sido feita sobre uma verba que a sincronização já trocou.
  select * into v_chk from public.meta_action_validar(v_act.campaign_id, v_act.acao, v_act.verba_nova);

  if v_chk.o_precisa and not coalesce(p_confirma_aprendizado, false) then
    return jsonb_build_object('status', 'precisa_confirmar', 'variacao', v_chk.o_variacao,
                              'verba_atual', v_chk.o_verba_atual, 'verba_nova', v_chk.o_verba_nova);
  end if;

  update public.meta_actions
     set status             = 'aprovada',
         decided_by         = auth.uid(),
         decided_at         = clock_timestamp(),
         verba_anterior     = v_chk.o_verba_atual,
         variacao           = v_chk.o_variacao,
         exigiu_aprendizado = (v_act.acao = 'verba'
                               and (v_chk.o_precisa or coalesce(p_confirma_aprendizado, false)))
   where id = p_action_id;

  return jsonb_build_object('status', 'aprovada', 'action_id', p_action_id, 'variacao', v_chk.o_variacao);
end;
$$;

comment on function public.meta_action_decide(uuid, text, boolean) is
  'Aprovar ou recusar uma proposta do gestor IA. Exige marketing.meta_manage. Só age em proposta: vencida devolve {status:expirada}; já decidida leva 55000 e nada é refeito. Aprovar recalcula a variação contra a verba atual da campanha e pode devolver {status:precisa_confirmar}.';

-- -----------------------------------------------------------------------------
-- 11. O executor (edge meta-campaign-action, service role)
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

  -- O UPDATE condicional é a trava: duas chamadas simultâneas passam em fila e
  -- a segunda já não encontra 'aprovada'.
  with claimed as (
    update public.meta_actions
       set status = 'executando'
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
  'Atômica: aprovada → executando. Devolve o que o executor precisa (campaign_external_id, act_id, acao, verbas, exigiu_aprendizado, meta_budget_level) ou null se a ação não estava aprovada. Service role.';

create or replace function public.meta_action_finish(p_action_id uuid, p_status text, p_resultado jsonb, p_erro text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_act   record;
  v_volta text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente o executor (service role) encerra ação.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('executada', 'parcial', 'falhou', 'precisa_confirmar') then
    raise exception 'Encerramento inválido: executada, parcial, falhou ou precisa_confirmar.' using errcode = '22023';
  end if;

  select * into v_act from public.meta_actions where id = p_action_id for update;
  if not found then
    raise exception 'Ação não encontrada.' using errcode = '22023';
  end if;
  if v_act.status <> 'executando' then
    -- Repetir o mesmo encerramento não muda nada; qualquer outro é o executor
    -- fora de ordem (finish sem claim), e dizer isso alto é o que o encontra.
    if v_act.status = p_status then
      return;
    end if;
    raise exception 'Esta ação não está em execução (%).', v_act.status using errcode = '55000';
  end if;

  -- Ao vivo a subida passou dos 30% e a pessoa não tinha aceitado o aviso:
  -- nada foi feito na Meta. A proposta da IA volta para a fila, para ser
  -- aprovada de novo com a confirmação; a manual encerra, e a tela manda uma
  -- nova, já confirmada.
  if p_status = 'precisa_confirmar' then
    v_volta := case
                 when v_act.origem = 'ia'
                      and v_act.expires_at > clock_timestamp()
                      and not exists (select 1 from public.meta_actions o
                                       where o.campaign_id = v_act.campaign_id
                                         and o.acao = v_act.acao
                                         and o.status = 'proposta')
                 then 'proposta'
                 else 'falhou'
               end;
    update public.meta_actions
       set status      = v_volta,
           decided_by  = case when v_volta = 'proposta' then null else decided_by end,
           decided_at  = case when v_volta = 'proposta' then null else decided_at end,
           resultado   = p_resultado,
           erro        = left(coalesce(nullif(btrim(p_erro), ''),
                           'A verba na Meta mudou desde a última sincronização e a subida real passa de 30%: confirme o aviso da fase de aprendizado e mande de novo.'), 1000),
           executed_at = case when v_volta = 'falhou' then clock_timestamp() end
     where id = p_action_id;
    return;
  end if;

  update public.meta_actions
     set status      = p_status,
         resultado   = p_resultado,
         erro        = case when p_status = 'executada' then null
                            else left(coalesce(nullif(btrim(p_erro), ''), 'Falha sem mensagem.'), 1000) end,
         executed_at = clock_timestamp()
   where id = p_action_id;

  -- O que a Meta aceitou aparece na campanha já, sem esperar a sincronização,
  -- que confirma ou corrige no dia seguinte. Definer: passa pelo guard da 0115.
  if p_status in ('executada', 'parcial') and v_act.campaign_id is not null then
    update public.ad_campaigns c
       set status       = case v_act.acao when 'pausar' then 'PAUSED'
                                          when 'ativar' then 'ACTIVE'
                                          else c.status end,
           -- Em 'parcial' só parte dos conjuntos mudou: vale o total que a Meta
           -- aceitou (resultado.depois.verba_diaria), não a verba pedida. Sem
           -- esse total, a verba fica como estava até a sincronização (lição 1).
           daily_budget = case
                            when v_act.acao <> 'verba' then c.daily_budget
                            when p_status = 'parcial'
                              then coalesce((p_resultado->'depois'->>'verba_diaria')::numeric, c.daily_budget)
                            else v_act.verba_nova
                          end
     where c.id = v_act.campaign_id;
  end if;
end;
$$;

comment on function public.meta_action_finish(uuid, text, jsonb, text) is
  'Encerra a execução: executada, parcial ou falhou (em executada e parcial atualiza ad_campaigns.status ou daily_budget). precisa_confirmar = a verba lida ao vivo passou dos 30% sem o aviso aceito: nada foi feito, a proposta da IA volta para a fila e a manual vira falhou. Repetir o mesmo encerramento não muda nada. Service role.';

-- -----------------------------------------------------------------------------
-- 12. Proposta do gestor IA (edge meta-traffic-manager, service role)
-- -----------------------------------------------------------------------------
create or replace function public.meta_action_propose(
  p_ai_run_id   uuid,
  p_campaign_id uuid,
  p_acao        text,
  p_verba_nova  numeric,
  p_motivo      text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_run record;
  v_chk record;
  v_id  uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente o gestor IA (service role) propõe ação.' using errcode = '42501';
  end if;

  -- Proposta vencida sai da fila: é o que libera a próxima para a mesma campanha.
  update public.meta_actions set status = 'expirada'
   where status = 'proposta' and expires_at <= clock_timestamp();

  select r.account_id, r.kind, r.requested_by into v_run
    from public.meta_ai_runs r where r.id = p_ai_run_id;
  if not found or v_run.kind <> 'gestor' then
    raise exception 'Execução do gestor IA não encontrada.' using errcode = '22023';
  end if;

  select * into v_chk from public.meta_action_validar(p_campaign_id, p_acao, p_verba_nova);
  -- A IA só propõe na conta que analisou.
  if v_chk.o_account_id <> v_run.account_id then
    raise exception 'A campanha não é da conta de anúncios analisada.' using errcode = '22023';
  end if;

  insert into public.meta_actions
    (account_id, campaign_id, campaign_external_id, campaign_name, origem, ai_run_id, acao,
     verba_anterior, verba_nova, variacao, motivo, status, requested_by, expires_at)
  values
    (v_chk.o_account_id, p_campaign_id, v_chk.o_external_id, v_chk.o_name, 'ia', p_ai_run_id, p_acao,
     v_chk.o_verba_atual, v_chk.o_verba_nova, v_chk.o_variacao,
     left(nullif(btrim(p_motivo), ''), 500), 'proposta', v_run.requested_by,
     clock_timestamp() + interval '24 hours')
  on conflict (campaign_id, acao) where status = 'proposta' do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.meta_action_propose(uuid, uuid, text, numeric, text) is
  'Põe uma ação do gestor IA na fila como proposta, válida por 24 h, com as mesmas travas da ação manual e só em campanha da conta analisada. Marca como expirada as vencidas. Devolve null se já houver proposta aberta igual. Service role.';

-- -----------------------------------------------------------------------------
-- 13. Execuções de IA: reuso e encerramento
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

  -- Parada há mais de 15 min morreu com a edge: encerra, para a tela não dizer
  -- "rodando" para sempre. De 5 a 15 min ela não é reusada, mas ainda pode
  -- terminar e gravar o resultado.
  update public.meta_ai_runs r
     set status = 'falhou',
         error = 'Interrompida: ficou mais de 15 minutos sem terminar.',
         finished_at = clock_timestamp()
   where r.account_id = p_account_id and r.kind = p_kind and r.status = 'rodando'
     and r.started_at < clock_timestamp() - interval '15 minutes';

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
  'Abre (ou reaproveita) uma execução de IA. Manual: marketing.meta_manage; reusa a ok com os mesmos kind, conta e params de até 10 min, ou a rodando de até 5 min. Cron: só service role, uma por conta, tipo e dia. reused = true significa que nenhuma chamada de IA nova deve ser feita.';

create or replace function public.meta_ai_run_finish(
  p_run_id     uuid,
  p_status     text,
  p_result     jsonb,
  p_error      text,
  p_model      text,
  p_tokens_in  int,
  p_tokens_out int)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a edge (service role) encerra análise de IA.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('ok', 'falhou') then
    raise exception 'Encerramento inválido (ok ou falhou).' using errcode = '22023';
  end if;
  -- 'ok' sem resultado faria a tela mostrar análise vazia como feita.
  if p_status = 'ok' and jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'Análise ok precisa do resultado.' using errcode = '22023';
  end if;

  update public.meta_ai_runs
     set status      = p_status,
         result      = p_result,
         error       = case when p_status = 'falhou'
                            then left(coalesce(nullif(btrim(p_error), ''), 'Falha sem mensagem.'), 1000) end,
         model       = nullif(btrim(p_model), ''),
         tokens_in   = p_tokens_in,
         tokens_out  = p_tokens_out,
         finished_at = clock_timestamp()
   where id = p_run_id and status = 'rodando';

  -- Já encerrada: repetir não muda nada (idempotente).
  if not found and not exists (select 1 from public.meta_ai_runs where id = p_run_id) then
    raise exception 'Análise de IA não encontrada.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Grants das funções
--
-- A 0023 concede EXECUTE de função nova a `authenticated` por default
-- privileges; as de service role precisam do revoke explícito.
-- -----------------------------------------------------------------------------
revoke all on function public.meta_action_precisa_aprendizado(numeric, numeric) from public, anon;
grant execute on function public.meta_action_precisa_aprendizado(numeric, numeric) to authenticated, service_role;

revoke all on function public.meta_action_validar(uuid, text, numeric)
  from public, anon, authenticated, service_role;

revoke all on function public.meta_action_create(uuid, text, numeric, boolean) from public, anon;
revoke all on function public.meta_action_decide(uuid, text, boolean)          from public, anon;
revoke all on function public.meta_ai_run_start(text, uuid, text, jsonb)       from public, anon;
grant execute on function public.meta_action_create(uuid, text, numeric, boolean) to authenticated, service_role;
grant execute on function public.meta_action_decide(uuid, text, boolean)          to authenticated, service_role;
grant execute on function public.meta_ai_run_start(text, uuid, text, jsonb)       to authenticated, service_role;

revoke all on function public.meta_action_claim(uuid)                             from public, anon, authenticated;
revoke all on function public.meta_action_finish(uuid, text, jsonb, text)         from public, anon, authenticated;
revoke all on function public.meta_action_propose(uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.meta_ai_run_finish(uuid, text, jsonb, text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.meta_action_claim(uuid)                             to service_role;
grant execute on function public.meta_action_finish(uuid, text, jsonb, text)         to service_role;
grant execute on function public.meta_action_propose(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.meta_ai_run_finish(uuid, text, jsonb, text, text, int, int) to service_role;
