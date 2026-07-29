-- =============================================================================
-- 0011 · Marketing, metas, atividades, notificações e integrações
--
-- Fecha o escopo com o que sobrou das atas:
--   · aportes de marketing por construtora ("controle de investimentos")
--   · metas mensais e anuais ("campo para configuração de metas")
--   · atividades com vencimento ("agendamento de tarefas com vencimento")
--   · notificações ("pop-up quando novos leads forem atribuídos")
--   · tokens de API ("tela específica para gestão de tokens, em ambiente seguro")
--
-- Os segredos ficam no schema `private`, que o PostgREST não expõe. O admin os
-- gerencia por RPC e nunca recebe o valor de volta — só a confirmação de que
-- existe. É a resposta direta à queixa de senhas visíveis no banco.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- marketing_investments — "o administrador seleciona a construtora e registra
-- o valor aportado mensalmente para monitorar entradas de recursos e custos".
-- -----------------------------------------------------------------------------
create table public.marketing_investments (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developers(id) on delete restrict,
  period       date not null,
  amount       numeric(14,2) not null check (amount >= 0),
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (developer_id, period),
  constraint marketing_investments_is_month_start check (period = public.month_start(period))
);

create index marketing_investments_period_idx on public.marketing_investments (period desc);

create trigger marketing_investments_set_updated_at
  before update on public.marketing_investments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ad_campaigns — espelho local das campanhas da Meta, sincronizado por edge
-- function. Guardar o custo aqui é o que permite cruzar investimento com
-- leads e vendas sem depender da API no momento do relatório.
-- -----------------------------------------------------------------------------
create table public.ad_campaigns (
  id           uuid primary key default gen_random_uuid(),
  external_id  text not null,
  platform     text not null default 'meta' check (platform in ('meta','google','tiktok','other')),
  name         text not null,
  developer_id uuid references public.developers(id) on delete set null,
  status       text,
  daily_budget numeric(12,2),
  total_spend  numeric(14,2) not null default 0,
  synced_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (platform, external_id)
);

create trigger ad_campaigns_set_updated_at
  before update on public.ad_campaigns
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- goals — metas por escopo e período. "Um campo para configuração de metas
-- anuais e mensais."
-- -----------------------------------------------------------------------------
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('global','team','profile')),
  team_id     uuid references public.teams(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete cascade,
  period_type text not null check (period_type in ('month','year')),
  period      date not null,
  metric      text not null
              check (metric in ('sales','vgv','leads','visits','analyses','approvals')),
  target      numeric(14,2) not null check (target >= 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint goals_scope_team    check ((scope = 'team')    = (team_id is not null)),
  constraint goals_scope_profile check ((scope = 'profile') = (profile_id is not null))
);

create unique index goals_global_idx  on public.goals (period_type, period, metric)
  where scope = 'global';
create unique index goals_team_idx    on public.goals (team_id, period_type, period, metric)
  where scope = 'team';
create unique index goals_profile_idx on public.goals (profile_id, period_type, period, metric)
  where scope = 'profile';

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- tasks — "funcionalidade de agendamento de tarefas com vencimento para
-- gerenciar o retorno aos clientes".
-- ref_type/ref_id amarram a tarefa a um lead ou negócio sem exigir uma tabela
-- de junção por tipo.
-- -----------------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) > 0),
  description  text,
  assigned_to  uuid references public.profiles(id) on delete cascade,
  created_by   uuid references public.profiles(id) on delete set null,
  due_at       timestamptz,
  completed_at timestamptz,
  status       task_status not null default 'open',
  priority     text not null default 'normal' check (priority in ('low','normal','high')),
  ref_type     text check (ref_type is null or ref_type in ('lead','deal','cca_case')),
  ref_id       uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint tasks_done_consistency check ((status = 'done') = (completed_at is not null)),
  constraint tasks_ref_pair        check ((ref_type is null) = (ref_id is null))
);

create index tasks_assigned_idx on public.tasks (assigned_to, status, due_at);
create index tasks_ref_idx      on public.tasks (ref_type, ref_id) where ref_id is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Quando a tarefa é de um lead, o vencimento dela é o vencimento do lead —
-- é isso que alimenta a contagem de "leads atrasados" do bloqueio de check-in.
create or replace function public.tasks_sync_lead_deadline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.ref_type = 'lead' and new.ref_id is not null then
    update public.leads
       set next_action_at = (
         select min(t.due_at) from public.tasks t
         where t.ref_type = 'lead' and t.ref_id = new.ref_id
           and t.status = 'open' and t.due_at is not null
       )
     where id = new.ref_id;
  end if;
  return null;
end;
$$;

create trigger tasks_sync_lead_deadline
  after insert or update of due_at, status on public.tasks
  for each row execute function public.tasks_sync_lead_deadline();

-- -----------------------------------------------------------------------------
-- notifications — "notificações em formato de pop-up quando novos leads forem
-- atribuídos, para garantir que o corretor seja notificado independentemente
-- de onde esteja no sistema".
--
-- channel registra por onde deve sair; a entrega em WhatsApp é feita por edge
-- function lendo as pendentes.
-- -----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  channel    notification_channel not null default 'in_app',
  read_at    timestamptz,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_unread_idx
  on public.notifications (profile_id, created_at desc) where read_at is null;
create index notifications_pending_delivery_idx
  on public.notifications (channel, created_at) where sent_at is null and channel <> 'in_app';

-- Todo lead atribuído gera notificação in-app e, se configurado, WhatsApp.
create or replace function public.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.leads;
  v_notify  boolean;
begin
  select notify_on_assign into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select * into v_lead from public.leads where id = new.lead_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead: ' || coalesce(v_lead.full_name, 'sem nome'),
    format('Você tem até %s para iniciar o atendimento.',
           to_char(new.deadline at time zone 'America/Sao_Paulo', 'HH24:MI')),
    '/leads/' || new.lead_id::text,
    'in_app'
  );

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (
    new.profile_id,
    'lead_assigned',
    'Novo lead atribuído',
    format('%s acabou de cair para você. Atenda em até %s minutos.',
           coalesce(v_lead.full_name, 'Um lead'),
           greatest(1, round(extract(epoch from (new.deadline - now())) / 60))),
    '/leads/' || new.lead_id::text,
    'whatsapp'
  );

  return null;
end;
$$;

create trigger notify_lead_assigned
  after insert on public.lead_assignments
  for each row execute function public.notify_lead_assigned();

-- Lead perdido por estouro de prazo também avisa. "Implementar aviso via
-- WhatsApp informando o usuário sobre leads perdidos pelo vencimento."
create or replace function public.notify_lead_timeout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notify boolean;
begin
  if new.release_reason is distinct from 'timeout' then
    return null;
  end if;

  select notify_on_timeout into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, channel)
  values (
    new.profile_id,
    'lead_lost_timeout',
    'Lead devolvido à fila',
    'Você não iniciou o atendimento no prazo e o lead voltou para a roleta.',
    'whatsapp'
  );

  return null;
end;
$$;

create trigger notify_lead_timeout
  after update of released_at on public.lead_assignments
  for each row execute function public.notify_lead_timeout();

-- -----------------------------------------------------------------------------
-- Conteúdo editorial da área de trabalho
-- -----------------------------------------------------------------------------
create table public.useful_links (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  url        text not null,
  icon       text,
  category   text not null default 'geral',
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger useful_links_set_updated_at
  before update on public.useful_links
  for each row execute function public.set_updated_at();

create table public.important_notices (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  severity   text not null default 'info' check (severity in ('info','warning','critical')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger important_notices_set_updated_at
  before update on public.important_notices
  for each row execute function public.set_updated_at();

create table public.gold_tips (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  author_id  uuid references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gold_tips_set_updated_at
  before update on public.gold_tips
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Integrações e segredos
--
-- A tabela vive em `private`. O PostgREST só expõe os schemas configurados em
-- db.schemas (public, graphql_public), então não há endpoint REST para ela —
-- nem com service_role vazando para o browser.
-- =============================================================================

create table private.integration_credentials (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null,
  label      text not null,
  secret     text not null,
  config     jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, label)
);

-- Lista as integrações SEM devolver o segredo. É o que a tela de tokens mostra.
create or replace function public.list_integrations()
returns table (
  id         uuid,
  provider   text,
  label      text,
  active     boolean,
  has_secret boolean,
  config     jsonb,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador gerencia integrações.' using errcode = '42501';
  end if;

  return query
  select c.id, c.provider, c.label, c.active,
         (c.secret is not null and c.secret <> ''),
         c.config, c.updated_at
  from private.integration_credentials c
  order by c.provider, c.label;
end;
$$;

-- Grava/atualiza o token. O valor entra e não volta nunca.
create or replace function public.set_integration_secret(
  p_provider text,
  p_label    text,
  p_secret   text,
  p_config   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador gerencia integrações.' using errcode = '42501';
  end if;

  insert into private.integration_credentials (provider, label, secret, config, updated_by)
  values (p_provider, p_label, p_secret, coalesce(p_config, '{}'::jsonb), auth.uid())
  on conflict (provider, label) do update
    set secret     = excluded.secret,
        config     = excluded.config,
        active     = true,
        updated_by = auth.uid(),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Leitura do segredo: exclusiva do service_role (edge functions). Nem admin
-- autenticado no browser consegue chamar.
create or replace function private.get_integration_secret(p_provider text, p_label text)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.secret
  from private.integration_credentials c
  where c.provider = p_provider and c.label = p_label and c.active;
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.marketing_investments enable row level security;
alter table public.ad_campaigns          enable row level security;
alter table public.goals                 enable row level security;
alter table public.tasks                 enable row level security;
alter table public.notifications         enable row level security;
alter table public.useful_links          enable row level security;
alter table public.important_notices     enable row level security;
alter table public.gold_tips             enable row level security;

-- Aporte é dado financeiro: diretoria e marketing leem, admin e marketing escrevem.
create policy marketing_investments_select on public.marketing_investments
  for select to authenticated
  using (public.has_any_role('admin','director','partner','marketing'));
create policy marketing_investments_write on public.marketing_investments
  for all to authenticated
  using (public.has_any_role('admin','marketing'))
  with check (public.has_any_role('admin','marketing'));

create policy ad_campaigns_select on public.ad_campaigns
  for select to authenticated
  using (public.has_any_role('admin','director','partner','marketing'));
create policy ad_campaigns_write on public.ad_campaigns
  for all to authenticated
  using (public.has_any_role('admin','marketing'))
  with check (public.has_any_role('admin','marketing'));

-- Meta do próprio corretor é visível para ele; as demais seguem a hierarquia.
create policy goals_select on public.goals
  for select to authenticated
  using (
    scope = 'global'
    or (scope = 'profile' and profile_id in (select public.auth_visible_profiles()))
    or (scope = 'team' and (
          public.can_read_all()
          or team_id in (select public.auth_led_team_ids())
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = goals.team_id
              and tm.profile_id = auth.uid() and tm.left_at is null
          )
       ))
  );

create policy goals_write on public.goals
  for all to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

create policy tasks_select on public.tasks
  for select to authenticated
  using (assigned_to in (select public.auth_visible_profiles()) or created_by = auth.uid());

create policy tasks_write on public.tasks
  for all to authenticated
  using (
    assigned_to = auth.uid() or created_by = auth.uid()
    or public.is_admin() or public.manages_profile(assigned_to)
  )
  with check (
    assigned_to = auth.uid() or created_by = auth.uid()
    or public.is_admin() or public.manages_profile(assigned_to)
  );

-- Notificação é estritamente pessoal, sem exceção de hierarquia.
create policy notifications_select on public.notifications
  for select to authenticated using (profile_id = auth.uid());
create policy notifications_update on public.notifications
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy useful_links_select on public.useful_links
  for select to authenticated using (active or public.is_admin());
create policy useful_links_write on public.useful_links
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy important_notices_select on public.important_notices
  for select to authenticated
  using (
    public.is_admin()
    or (active and starts_at <= now() and (ends_at is null or ends_at > now()))
  );
create policy important_notices_write on public.important_notices
  for all to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

create policy gold_tips_select on public.gold_tips
  for select to authenticated using (active or public.is_admin());
create policy gold_tips_write on public.gold_tips
  for all to authenticated
  using (public.has_any_role('admin','director','manager'))
  with check (public.has_any_role('admin','director','manager'));

-- Grants das RPCs de integração.
revoke all on function public.list_integrations()                        from public, anon;
revoke all on function public.set_integration_secret(text,text,text,jsonb) from public, anon;
grant execute on function public.list_integrations()                     to authenticated;
grant execute on function public.set_integration_secret(text,text,text,jsonb) to authenticated;

revoke all on function private.get_integration_secret(text, text) from public, anon, authenticated;
grant execute on function private.get_integration_secret(text, text) to service_role;
grant usage on schema private to service_role;
