-- =============================================================================
-- 0184 · Fila CCA por corretor, reativar Offs, trava queda/distrato por mês,
--        e notificações humanizadas
--
-- Quatro frentes do pedido de 06/10/2026:
--   1. Fila CCA por corretor: RPC `my_cca_queue_position()` expõe a posição do
--      corretor na análise de crédito (1º, 2º, etc.) ordenada por submitted_at.
--      O front usa para mostrar popup "Você é o N° na fila" e alertar quando
--      chega a vez.
--   2. Reativar Offs: RPC `reactivate_deal(p_deal_id, p_broker_id)` permite
--      corretor/gerente/diretor reativar negócio OFF de mês anterior. Card fica
--      blur no front; botão verde "Reativar Proposta". Regras:
--      - Corretor: reativa próprio negócio, mantém vínculo existente
--      - Gerente: pergunta qual corretor atribuir (p_broker_id obrigatório)
--      - Diretor: mesmo que gerente, traz gerente e diretor automaticamente
--      Negócio volta para outcome='open', month_base=mês atual, stage=inicial.
--   3. Trava queda/distrato por mês: gatilho `deals_guard_queda_distrato_month()`
--      enforceia regra do cliente:
--      - QUEDA: só mês vigente (month_base = current_season_month())
--      - DISTRATO: só meses anteriores (month_base < current_season_month())
--      Admin/sócio continuam sem trava (is_admin()).
--   4. Notificações humanizadas: corrige `notify_cca_case_created()` e
--      `notify_cca_status_changed()` para usar nome do cliente em vez de código
--      BUB-179... feio. Título vira "Novo dossiê: [Cliente]" e corpo menciona
--      nome do cliente + empreendimento, não código interno.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fila CCA por corretor: posição na análise de crédito
-- -----------------------------------------------------------------------------
create or replace function public.my_cca_queue_position()
returns table(deal_id uuid, deal_code text, client_name text, queue_position integer, submitted_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with my_deals as (
  select distinct d.id, d.code, dc.full_name as client_name, c.submitted_at
  from public.cca_cases c
  join public.deals d on d.id = c.deal_id
  join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
  join public.deal_participants dp on dp.deal_id = d.id and dp.profile_id = auth.uid() and dp.role = 'broker'
  where c.status in ('under_review', 'pending_documents')
),
ranked as (
  select md.*, row_number() over (order by md.submitted_at asc nulls last, md.id) as pos
  from my_deals md
)
select r.id, r.code, r.client_name, r.pos::integer, r.submitted_at
from ranked r
order by r.pos;
$$;
comment on function public.my_cca_queue_position() is
'Posição do corretor na fila de análise de crédito (CCA), ordenada por submitted_at. Retorna todos os negócios do corretor em análise com sua posição (1º, 2º, etc.). Usado pelo front para popup de alerta quando chega a vez (0184).';
revoke all on function public.my_cca_queue_position() from public, anon;
grant execute on function public.my_cca_queue_position() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Reativar Offs: corretor/gerente/diretor reativam negócio OFF de mês anterior
-- -----------------------------------------------------------------------------
create or replace function public.reactivate_deal(p_deal_id uuid, p_broker_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal       public.deals;
  v_ator       uuid := auth.uid();
  v_ator_roles text[];
  v_current_month date;
  v_initial_stage uuid;
  v_target_broker uuid;
begin
  if v_ator is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  -- Só reativa OFF ou DISTRATO
  if public.deal_status_bare(v_deal.status_detail) not in ('OFF', 'DISTRATO') then
    raise exception 'Só é possível reativar negócios com Status 2 OFF ou DISTRATO.' using errcode = 'P0001';
  end if;

  -- Só mês anterior (fechado)
  v_current_month := public.month_start(coalesce(public.current_season_month(), current_date));
  if v_deal.month_base >= v_current_month then
    raise exception 'Só é possível reativar negócios de meses anteriores. Este negócio é do mês vigente ou futuro.' using errcode = 'P0001';
  end if;

  -- Verifica permissão por papel
  select array_agg(ur.role) into v_ator_roles
  from public.user_roles ur
  where ur.profile_id = v_ator;

  if not ('admin' = any(v_ator_roles) or 'partner' = any(v_ator_roles) or
          'director' = any(v_ator_roles) or 'manager' = any(v_ator_roles) or
          'broker' = any(v_ator_roles)) then
    raise exception 'Seu perfil não pode reativar negócios.' using errcode = '42501';
  end if;

  -- Corretor só reativa próprio negócio
  if 'broker' = any(v_ator_roles) and not ('admin' = any(v_ator_roles) or 'partner' = any(v_ator_roles) or
                                            'director' = any(v_ator_roles) or 'manager' = any(v_ator_roles)) then
    if not exists (
      select 1 from public.deal_participants dp
      where dp.deal_id = p_deal_id and dp.profile_id = v_ator and dp.role = 'broker'
    ) then
      raise exception 'Você só pode reativar negócios vinculados a você.' using errcode = '42501';
    end if;
    v_target_broker := v_ator;
  else
    -- Gerente/diretor/admin: p_broker_id obrigatório
    if p_broker_id is null then
      raise exception 'Informe o corretor para atribuir o negócio reativado.' using errcode = 'P0001';
    end if;
    -- Verifica se corretor existe e está ativo
    if not exists (
      select 1 from public.profiles p
      where p.id = p_broker_id and p.status = 'active'
      and exists (select 1 from public.user_roles ur where ur.profile_id = p_broker_id and ur.role = 'broker')
    ) then
      raise exception 'Corretor informado não existe ou está inativo.' using errcode = 'P0002';
    end if;
    v_target_broker := p_broker_id;
  end if;

  -- Busca etapa inicial (primeira ativa)
  select ps.id into v_initial_stage
  from public.pipeline_stages ps
  where ps.active
  order by ps.position
  limit 1;

  if v_initial_stage is null then
    raise exception 'Nenhuma etapa inicial encontrada no pipeline.' using errcode = 'P0003';
  end if;

  -- Desabilita gatilhos temporariamente para evitar conflito com mês fechado
  alter table public.deals disable trigger deals_guard_closed_month;
  alter table public.deals disable trigger deals_guard_esteira_label;

  -- Reativa: outcome=open, month_base=mês atual, stage=inicial, limpa status_detail e lost_reason
  update public.deals
  set outcome = 'open',
      month_base = v_current_month,
      stage_id = v_initial_stage,
      stage_entered_at = now(),
      status_detail = null,
      lost_reason = null,
      closed_at = null,
      updated_at = now()
  where id = p_deal_id;

  alter table public.deals enable trigger deals_guard_esteira_label;
  alter table public.deals enable trigger deals_guard_closed_month;

  -- Atualiza participantes: remove antigos, adiciona novo corretor + gerente + diretor
  delete from public.deal_participants where deal_id = p_deal_id;

  -- Adiciona corretor alvo
  insert into public.deal_participants (deal_id, profile_id, role, share_pct, auto_added)
  values (p_deal_id, v_target_broker, 'broker', 100, false);

  -- Busca gerente e diretor do corretor (via teams)
  insert into public.deal_participants (deal_id, profile_id, role, share_pct, auto_added)
  select p_deal_id, t.manager_id, 'manager', 0, true
  from public.teams t
  join public.team_members tm on tm.team_id = t.id and tm.profile_id = v_target_broker
  where t.manager_id is not null
  on conflict (deal_id, profile_id, role) do nothing;

  insert into public.deal_participants (deal_id, profile_id, role, share_pct, auto_added)
  select p_deal_id, t.director_id, 'director', 0, true
  from public.teams t
  join public.team_members tm on tm.team_id = t.id and tm.profile_id = v_target_broker
  where t.director_id is not null
  on conflict (deal_id, profile_id, role) do nothing;

  -- Registra no histórico
  insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
  values (p_deal_id, v_ator, 'reactivated', v_deal.status_detail, 'open',
          jsonb_build_object('reason', 'Reativado de mês anterior', 'old_month', to_char(v_deal.month_base, 'MM/YYYY'), 'new_month', to_char(v_current_month, 'MM/YYYY')));

  return jsonb_build_object(
    'deal_id', p_deal_id,
    'reactivated', true,
    'new_month', to_char(v_current_month, 'MM/YYYY'),
    'broker_id', v_target_broker
  );
end;
$$;
comment on function public.reactivate_deal(uuid, uuid) is
'Reativa negócio OFF/DISTRATO de mês anterior: volta para outcome=open, mês atual, etapa inicial. Corretor reativa próprio; gerente/diretor informam corretor alvo (p_broker_id). Atualiza participantes automaticamente (0184).';
revoke all on function public.reactivate_deal(uuid, uuid) from public, anon;
grant execute on function public.reactivate_deal(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trava queda/distrato por mês: QUEDA só mês vigente, DISTRATO só meses anteriores
-- -----------------------------------------------------------------------------
create or replace function public.deals_guard_queda_distrato_month()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status_bare text;
  v_current_month date;
begin
  -- Admin/sócio sem trava
  if public.is_admin() then
    return new;
  end if;

  v_status_bare := public.deal_status_bare(new.status_detail);
  v_current_month := public.month_start(coalesce(public.current_season_month(), current_date));

  -- QUEDA: só mês vigente
  if v_status_bare = 'QUEDA' and new.month_base <> v_current_month then
    raise exception 'QUEDA só pode ser marcada no mês vigente (%). Este negócio é de %.',
      to_char(v_current_month, 'MM/YYYY'), to_char(new.month_base, 'MM/YYYY')
      using errcode = 'P0001';
  end if;

  -- DISTRATO: só meses anteriores
  if v_status_bare = 'DISTRATO' and new.month_base >= v_current_month then
    raise exception 'DISTRATO só pode ser marcado em meses anteriores. Este negócio é do mês vigente ou futuro (%).',
      to_char(new.month_base, 'MM/YYYY')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
comment on function public.deals_guard_queda_distrato_month() is
'Trava queda/distrato por mês: QUEDA só no mês vigente, DISTRATO só em meses anteriores. Admin/sócio sem trava (0184).';
drop trigger if exists deals_guard_queda_distrato_month on public.deals;
create trigger deals_guard_queda_distrato_month
before insert or update of status_detail, month_base on public.deals
for each row execute function public.deals_guard_queda_distrato_month();

-- -----------------------------------------------------------------------------
-- 4. Notificações humanizadas: corrige código BUB feio, usa nome do cliente
-- -----------------------------------------------------------------------------
create or replace function public.notify_cca_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_name text;
  v_project     text;
begin
  if tg_op = 'UPDATE' and new.submitted_at is not distinct from old.submitted_at then
    return null;
  end if;

  select dc.full_name, dp.name into v_client_name, v_project
  from public.deals d
  left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
  left join public.developer_projects dp on dp.id = d.project_id
  where d.id = new.deal_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select p.id,
    'cca_pending',
    format('Novo dossiê: %s', coalesce(v_client_name, 'Cliente não informado')),
    format(case when tg_op = 'INSERT'
      then 'O negócio de %s%s entrou na análise de crédito.'
      else 'O negócio de %s%s voltou para a análise de crédito.' end,
      coalesce(v_client_name, 'cliente não informado'),
      case when v_project is not null then format(' (%s)', v_project) else '' end),
    '/cca',
    'in_app'
  from public.user_roles ur
  join public.profiles p on p.id = ur.profile_id and p.status = 'active'
  where ur.role = 'cca';

  return null;
end;
$$;
drop trigger if exists notify_cca_case_created on public.cca_cases;
create trigger notify_cca_case_created
after insert or update of submitted_at on public.cca_cases
for each row execute function public.notify_cca_case_created();
comment on function public.notify_cca_case_created() is
'Dossiê novo na esteira avisa os CCAs com nome do cliente em vez de código interno (0184).';

create or replace function public.notify_cca_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_client_name text;
  v_project   text;
  v_is_reactivated boolean;
  v_ator_roles text[];
  v_rotulo    constant jsonb := '{
    "pending_documents": "Aguardando documentos",
    "under_review": "Em análise",
    "sent_to_developer": "Enviado à construtora",
    "sent_to_agency": "Enviado à agência",
    "approved": "Aprovado",
    "rejected": "Reprovado",
    "cancelled": "Cancelado"
  }';
begin
  if v_ator is null then
    return null;
  end if;

  -- Verifica se o negócio foi reativado (veio de OFF/DISTRATO)
  select exists (
    select 1 from public.deal_history dh
    where dh.deal_id = new.deal_id
      and dh.kind = 'reactivated'
      and dh.created_at >= now() - interval '1 hour'
  ) into v_is_reactivated;

  select dc.full_name, dp.name into v_client_name, v_project
  from public.deals d
  left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
  left join public.developer_projects dp on dp.id = d.project_id
  where d.id = new.deal_id;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  -- Busca papéis do ator
  select array_agg(ur.role) into v_ator_roles
  from public.user_roles ur
  where ur.profile_id = v_ator;

  -- Em reativações de OFF, só admin recebe notificação
  if v_is_reactivated and not ('admin' = any(v_ator_roles) or 'partner' = any(v_ator_roles)) then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
    'cca_status_changed',
    format('Crédito de %s: %s',
      coalesce(v_client_name, 'cliente não informado'),
      coalesce(v_rotulo ->> new.status::text, new.status::text)),
    format('%s moveu a análise de crédito de %s%s de "%s" para "%s".',
      coalesce(v_ator_nome, 'Alguém'),
      coalesce(v_client_name, 'cliente não informado'),
      case when v_project is not null then format(' (%s)', v_project) else '' end,
      coalesce(v_rotulo ->> old.status::text, old.status::text),
      coalesce(v_rotulo ->> new.status::text, new.status::text)),
    '/pipeline',
    'in_app'
  from (
    select distinct dp0.profile_id
    from public.deal_participants dp0
    where dp0.deal_id = new.deal_id and dp0.role in ('broker', 'manager', 'director')
  ) dp
  join public.profiles p on p.id = dp.profile_id and p.status = 'active'
  where dp.profile_id <> v_ator;

  return null;
end;
$$;
drop trigger if exists notify_cca_status_changed on public.cca_cases;
create trigger notify_cca_status_changed
after update of status on public.cca_cases
for each row
when (old.status is distinct from new.status)
execute function public.notify_cca_status_changed();
comment on function public.notify_cca_status_changed() is
'Mudança de status do caso de crédito avisa corretores, gerentes e diretores com nome do cliente em vez de código interno (0184).';