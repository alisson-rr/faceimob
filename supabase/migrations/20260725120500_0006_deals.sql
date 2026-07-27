-- =============================================================================
-- 0006 · Negócios, participantes, VGV e documentos
--
-- Corrige três problemas estruturais do schema anterior:
--
--   1. broker1/broker2/broker3 e manager1/2/3 eram colunas. Viravam limite
--      arbitrário de 3 e impediam qualquer agregação por corretor. Agora é
--      deal_participants (N:N), com rateio de VGV calculado no banco.
--   2. Os dados do segundo comprador eram 12 colunas duplicadas com sufixo "2".
--      Agora é deal_clients com ordinal.
--   3. Anexo era campo único. Agora é deal_documents tipado e versionado.
--
-- Regras do cliente implementadas aqui:
--   · "o cálculo do VGV deve ser dividido de forma igualitária entre os
--      corretores participantes"
--   · "com a necessidade de automação no preenchimento do gerente e diretor"
--   · "a transformação em negócio no pipeline exige a anexação de documentos"
-- =============================================================================

create sequence public.deal_code_seq;

-- -----------------------------------------------------------------------------
-- deals
-- -----------------------------------------------------------------------------
create table public.deals (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique default ('NEG-' || lpad(nextval('public.deal_code_seq')::text, 6, '0')),

  lead_id      uuid references public.leads(id) on delete set null,
  developer_id uuid references public.developers(id) on delete restrict,
  project_id   uuid references public.developer_projects(id) on delete set null,
  unit         text,

  stage_id     uuid not null references public.pipeline_stages(id) on delete restrict,
  outcome      deal_outcome not null default 'open',

  -- "sistema próprio de fechamento de mês, que não dependa do calendário
  --  tradicional": o negócio pertence ao mês-base, não à data de criação.
  month_base   date not null default public.month_start(current_date),

  vgv_gross    numeric(14,2) check (vgv_gross is null or vgv_gross >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  -- Derivado, não digitado: elimina a divergência entre bruto e líquido que o
  -- cliente relatou nos relatórios do sistema antigo.
  vgv_net      numeric(14,2)
               generated always as (round(coalesce(vgv_gross,0) * (1 - discount_pct/100), 2)) stored,

  lead_origin  text,
  notes        text,

  stage_entered_at timestamptz not null default now(),
  closed_at    timestamptz,
  lost_reason  text,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint deals_closed_consistency
    check (outcome = 'open' or closed_at is not null)
);

create index deals_stage_idx      on public.deals (stage_id) where outcome = 'open';
create index deals_month_idx      on public.deals (month_base);
create index deals_developer_idx  on public.deals (developer_id);
create index deals_lead_idx       on public.deals (lead_id);
create index deals_outcome_idx    on public.deals (outcome, month_base);

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- Fecha o ciclo lead -> negócio agora que deals existe.
alter table public.leads
  add column converted_deal_id uuid references public.deals(id) on delete set null;

create index leads_converted_idx on public.leads (converted_deal_id)
  where converted_deal_id is not null;

-- -----------------------------------------------------------------------------
-- deal_clients — titular (ordinal 1) e compra conjunta (ordinal 2).
-- -----------------------------------------------------------------------------
create table public.deal_clients (
  id       uuid primary key default gen_random_uuid(),
  deal_id  uuid not null references public.deals(id) on delete cascade,
  ordinal  smallint not null default 1 check (ordinal in (1, 2)),

  full_name      text not null,
  cpf            text,
  phone          text,
  email          extensions.citext,
  pis            text,
  marital_status text,
  birthplace     text,
  is_shareholder boolean,          -- cotista
  dependents     text,
  admission_date date,
  cch_reference  text,
  postal_code    text,

  -- Renda informal: bloco opcional, preenchido só quando aplicável.
  has_informal_income boolean not null default false,
  activity_segment    text,
  activity_form       text,
  activity_duration   text,
  disclosure_form     text,
  declares_income_tax boolean,
  monthly_income      numeric(12,2),
  income_notes        text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deal_id, ordinal)
);

create trigger deal_clients_set_updated_at
  before update on public.deal_clients
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- deal_participants — quem divide o negócio.
-- share_pct dos corretores é recalculado pelo banco; gerente e diretor entram
-- automaticamente a partir da equipe do corretor.
-- -----------------------------------------------------------------------------
create table public.deal_participants (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role       text not null check (role in ('broker','manager','director')),
  share_pct  numeric(6,3) not null default 0 check (share_pct between 0 and 100),
  -- Marca quem entrou por automação, para o gestor saber o que pode reajustar.
  auto_added boolean not null default false,
  created_at timestamptz not null default now(),

  unique (deal_id, profile_id, role)
);

create index deal_participants_profile_idx on public.deal_participants (profile_id, role);
create index deal_participants_deal_idx    on public.deal_participants (deal_id);

-- Divide o VGV igualmente entre os corretores do negócio. O resto da divisão
-- inteira vai para o primeiro, para que a soma feche exatamente em 100.
create or replace function public.recalc_deal_shares(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_share numeric(6,3);
  v_first uuid;
begin
  select count(*) into v_count
  from public.deal_participants
  where deal_id = p_deal_id and role = 'broker';

  if v_count = 0 then
    return;
  end if;

  v_share := round(100.0 / v_count, 3);

  update public.deal_participants
     set share_pct = v_share
   where deal_id = p_deal_id and role = 'broker';

  -- Ajuste do arredondamento (ex.: 3 corretores -> 33.333 x3 = 99.999).
  select id into v_first
  from public.deal_participants
  where deal_id = p_deal_id and role = 'broker'
  order by created_at, id
  limit 1;

  update public.deal_participants
     set share_pct = share_pct + (
       100 - (select sum(share_pct) from public.deal_participants
              where deal_id = p_deal_id and role = 'broker')
     )
   where id = v_first;

  -- Gerente e diretor acompanham o negócio mas não dividem VGV.
  update public.deal_participants
     set share_pct = 0
   where deal_id = p_deal_id and role in ('manager','director');
end;
$$;

-- Ao entrar um corretor, puxa gerente e diretor da equipe ativa dele.
create or replace function public.deal_participants_autofill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager  uuid;
  v_director uuid;
begin
  if new.role = 'broker' then
    select t.manager_id, t.director_id into v_manager, v_director
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = new.profile_id and tm.left_at is null
    limit 1;

    if v_manager is not null and v_manager is distinct from new.profile_id then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_manager, 'manager', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;

    if v_director is not null and v_director is distinct from new.profile_id then
      insert into public.deal_participants (deal_id, profile_id, role, auto_added)
      values (new.deal_id, v_director, 'director', true)
      on conflict (deal_id, profile_id, role) do nothing;
    end if;
  end if;

  return null;
end;
$$;

create trigger deal_participants_autofill
  after insert on public.deal_participants
  for each row execute function public.deal_participants_autofill();

create or replace function public.deal_participants_resplit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recalc_deal_shares(coalesce(new.deal_id, old.deal_id));
  return null;
end;
$$;

-- Row-level de propósito: num trigger de statement, NEW e OLD são NULL e o
-- rateio nunca rodaria. O recálculo é barato (poucas linhas por negócio) e não
-- recursa, porque o trigger não escuta UPDATE — que é o que recalc emite.
create trigger deal_participants_resplit
  after insert or delete on public.deal_participants
  for each row execute function public.deal_participants_resplit();

-- -----------------------------------------------------------------------------
-- deal_documents — "campos específicos para cada tipo de documento,
-- renomeação automática, botões de download e registro de histórico de
-- alterações para o time do CCA".
--
-- Versionamento por supersessão: reenviar o mesmo tipo não apaga o anterior,
-- marca-o como substituído. O CCA consegue ver o que mudou e quando.
-- -----------------------------------------------------------------------------
create table public.deal_documents (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  storage_path     text not null unique,
  original_name    text not null,
  stored_name      text not null,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  version          int not null default 1 check (version > 0),
  superseded_at    timestamptz,
  superseded_by    uuid references public.deal_documents(id) on delete set null,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index deal_documents_deal_idx on public.deal_documents (deal_id)
  where superseded_at is null;

-- Um documento vigente por tipo, salvo nos tipos que aceitam vários ("Outros").
create or replace function public.deal_documents_enforce_single()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_multiple boolean;
  v_prev     uuid;
  v_version  int;
begin
  select allows_multiple into v_multiple
  from public.document_types where id = new.document_type_id;

  if coalesce(v_multiple, false) then
    return new;
  end if;

  select id, version into v_prev, v_version
  from public.deal_documents
  where deal_id = new.deal_id
    and document_type_id = new.document_type_id
    and superseded_at is null
    and id is distinct from new.id
  order by version desc
  limit 1;

  if v_prev is not null then
    new.version := v_version + 1;
  end if;

  return new;
end;
$$;

create trigger deal_documents_enforce_single
  before insert on public.deal_documents
  for each row execute function public.deal_documents_enforce_single();

-- Fecha a versão anterior depois que a nova entrou (evita violar o índice).
create or replace function public.deal_documents_supersede()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_multiple boolean;
begin
  select allows_multiple into v_multiple
  from public.document_types where id = new.document_type_id;

  if coalesce(v_multiple, false) then
    return null;
  end if;

  update public.deal_documents
     set superseded_at = now(), superseded_by = new.id
   where deal_id = new.deal_id
     and document_type_id = new.document_type_id
     and superseded_at is null
     and id <> new.id;

  return null;
end;
$$;

create trigger deal_documents_supersede
  after insert on public.deal_documents
  for each row execute function public.deal_documents_supersede();

-- -----------------------------------------------------------------------------
-- deal_history — log imutável de movimentação do negócio.
-- -----------------------------------------------------------------------------
create table public.deal_history (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null,
  from_value text,
  to_value   text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index deal_history_deal_idx on public.deal_history (deal_id, created_at desc);

-- -----------------------------------------------------------------------------
-- visits
-- -----------------------------------------------------------------------------
create table public.visits (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid references public.deals(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete cascade,
  broker_id    uuid references public.profiles(id) on delete set null,
  scheduled_at timestamptz not null,
  performed_at timestamptz,
  result       visit_result not null default 'scheduled',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint visits_has_target check (deal_id is not null or lead_id is not null)
);

create index visits_deal_idx  on public.visits (deal_id);
create index visits_broker_idx on public.visits (broker_id, scheduled_at desc);

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Regras de estágio e conversão
-- =============================================================================

-- Bloqueia entrada em estágio que exige documentação enquanto não houver
-- nenhum documento vigente no negócio, e registra a mudança no histórico.
create or replace function public.deals_guard_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requires boolean;
  v_docs     int;
  v_outcome  deal_outcome;
begin
  if new.stage_id is distinct from old.stage_id then
    select requires_document, outcome into v_requires, v_outcome
    from public.pipeline_stages where id = new.stage_id;

    if coalesce(v_requires, false) then
      select count(*) into v_docs
      from public.deal_documents
      where deal_id = new.id and superseded_at is null;

      if v_docs = 0 then
        raise exception
          'O estágio exige ao menos um documento anexado antes do avanço.'
          using errcode = 'P0001';
      end if;
    end if;

    new.stage_entered_at := now();
    new.outcome := coalesce(v_outcome, new.outcome);

    if new.outcome <> 'open' and new.closed_at is null then
      new.closed_at := now();
    elsif new.outcome = 'open' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger deals_guard_stage
  before update on public.deals
  for each row execute function public.deals_guard_stage();

create or replace function public.deals_log_changes()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value)
    values (new.id, auth.uid(), 'stage_changed', old.stage_id::text, new.stage_id::text);
  end if;

  if new.vgv_gross is distinct from old.vgv_gross
     or new.discount_pct is distinct from old.discount_pct then
    insert into public.deal_history (deal_id, actor_id, kind, from_value, to_value, detail)
    values (new.id, auth.uid(), 'value_changed',
            old.vgv_net::text, new.vgv_net::text,
            jsonb_build_object('gross', new.vgv_gross, 'discount_pct', new.discount_pct));
  end if;

  return new;
end;
$$;

create trigger deals_log_changes
  after update on public.deals
  for each row execute function public.deals_log_changes();

-- Conversão de lead em negócio. Exige documentação, conforme a regra de
-- negócio, e faz tudo numa transação: cria o negócio, o cliente titular, o
-- participante corretor (que dispara gerente/diretor e o rateio) e marca o lead.
create or replace function public.convert_lead_to_deal(
  p_lead_id      uuid,
  p_developer_id uuid,
  p_project_id   uuid default null,
  p_unit         text default null,
  p_vgv_gross    numeric default null
)
returns public.deals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead  public.leads;
  v_stage uuid;
  v_deal  public.deals;
  v_docs  int;
  v_owner uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  if v_lead.converted_deal_id is not null then
    raise exception 'Lead já convertido no negócio %.', v_lead.converted_deal_id
      using errcode = 'P0001';
  end if;

  v_owner := coalesce(v_lead.assigned_to, auth.uid());

  if not (public.is_admin() or v_owner = auth.uid() or public.manages_profile(v_owner)) then
    raise exception 'Sem permissão para converter este lead.' using errcode = '42501';
  end if;

  -- "a transformação em negócio exige a anexação de documentos"
  select count(*) into v_docs from public.lead_attachments where lead_id = p_lead_id;
  if v_docs = 0 then
    raise exception 'Anexe ao menos um documento antes de converter o lead em negócio.'
      using errcode = 'P0001';
  end if;

  select id into v_stage from public.pipeline_stages
  where is_initial and active limit 1;
  if v_stage is null then
    raise exception 'Nenhum estágio inicial configurado no pipeline.' using errcode = 'P0001';
  end if;

  insert into public.deals (lead_id, developer_id, project_id, unit, stage_id,
                            vgv_gross, lead_origin, created_by)
  values (p_lead_id, p_developer_id, p_project_id, p_unit, v_stage,
          p_vgv_gross,
          coalesce((select ls.label from public.lead_sources ls where ls.id = v_lead.source_id),
                   v_lead.utm_source),
          auth.uid())
  returning * into v_deal;

  insert into public.deal_clients (deal_id, ordinal, full_name, phone, email, cpf)
  values (v_deal.id, 1, v_lead.full_name, v_lead.phone, v_lead.email, v_lead.document);

  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal.id, v_owner, 'broker');

  -- Leva os anexos do lead para o negócio, preservando tipo e nome.
  insert into public.deal_documents (deal_id, document_type_id, storage_path,
                                     original_name, stored_name, mime_type,
                                     size_bytes, uploaded_by)
  select v_deal.id,
         coalesce(la.document_type_id,
                  (select dt.id from public.document_types dt where dt.code = 'outros' limit 1)),
         la.storage_path, la.original_name, la.stored_name, la.mime_type,
         la.size_bytes, la.uploaded_by
  from public.lead_attachments la
  where la.lead_id = p_lead_id
    and coalesce(la.document_type_id,
                 (select dt.id from public.document_types dt where dt.code = 'outros' limit 1))
        is not null;

  update public.leads
     set status            = 'converted',
         converted_deal_id = v_deal.id,
         converted_at      = now(),
         last_activity_at  = now()
   where id = p_lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, to_value)
  values (p_lead_id, auth.uid(), 'converted', v_deal.id::text);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (v_deal.id, auth.uid(), 'created',
          jsonb_build_object('from_lead', p_lead_id));

  return v_deal;
end;
$$;

-- =============================================================================
-- RLS
--
-- Visibilidade do negócio segue a participação, não um dono único: o corretor
-- vê os negócios em que entra, o gerente os da equipe, o diretor todos.
-- =============================================================================

alter table public.deals             enable row level security;
alter table public.deal_clients      enable row level security;
alter table public.deal_participants enable row level security;
alter table public.deal_documents    enable row level security;
alter table public.deal_history      enable row level security;
alter table public.visits            enable row level security;

create or replace function public.can_see_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_read_all()
      or exists (
        select 1 from public.deal_participants dp
        where dp.deal_id = p_deal_id
          and dp.profile_id in (select public.auth_visible_profiles())
      );
$$;

-- CCA precisa enxergar todo negócio em análise, independentemente de equipe.
create or replace function public.can_edit_deal(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role('admin','cca')
      or exists (
        select 1 from public.deal_participants dp
        where dp.deal_id = p_deal_id
          and (dp.profile_id = auth.uid() or public.manages_profile(dp.profile_id))
      );
$$;

create policy deals_select on public.deals
  for select to authenticated
  using (public.can_see_deal(id) or public.has_role('cca'));

create policy deals_insert on public.deals
  for insert to authenticated
  with check (public.has_any_role('admin','director','manager','broker','cca'));

create policy deals_update on public.deals
  for update to authenticated
  using (public.can_edit_deal(id)) with check (public.can_edit_deal(id));

create policy deals_delete on public.deals
  for delete to authenticated using (public.is_admin());

create policy deal_clients_all on public.deal_clients
  for all to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'))
  with check (public.can_edit_deal(deal_id));

create policy deal_participants_select on public.deal_participants
  for select to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'));

create policy deal_participants_write on public.deal_participants
  for all to authenticated
  using (public.can_edit_deal(deal_id)) with check (public.can_edit_deal(deal_id));

create policy deal_documents_select on public.deal_documents
  for select to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'));

create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check (public.can_edit_deal(deal_id));

-- Documento não se apaga: substitui-se. Só admin remove de fato.
create policy deal_documents_delete on public.deal_documents
  for delete to authenticated using (public.is_admin());

create policy deal_history_select on public.deal_history
  for select to authenticated
  using (public.can_see_deal(deal_id) or public.has_role('cca'));

create policy visits_select on public.visits
  for select to authenticated
  using (
    broker_id in (select public.auth_visible_profiles())
    or (deal_id is not null and public.can_see_deal(deal_id))
  );

create policy visits_write on public.visits
  for all to authenticated
  using (broker_id = auth.uid() or public.is_admin() or public.manages_profile(broker_id))
  with check (broker_id = auth.uid() or public.is_admin() or public.manages_profile(broker_id));

revoke all on function public.convert_lead_to_deal(uuid,uuid,uuid,text,numeric) from public, anon;
grant execute on function public.convert_lead_to_deal(uuid,uuid,uuid,text,numeric)
  to authenticated, service_role;
