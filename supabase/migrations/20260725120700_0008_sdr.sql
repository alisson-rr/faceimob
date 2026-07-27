-- =============================================================================
-- 0008 · SDR por IA, templates de WhatsApp e remarketing
--
-- "Criação de um grupo especial para SDR atendido por IA, onde o sistema
--  dispara um template de WhatsApp para o lead recém-chegado. A IA qualificará
--  o interesse do lead antes de transferi-lo para a fila de corretores."
--
-- E o remarketing: "importação de planilhas com listas de leads antigos para
-- novos disparos via template. O fluxo seguirá o mesmo princípio: envio de
-- template, interação inicial com IA e posterior transferência para um grupo
-- de corretores se houver qualificação."
--
-- Este arquivo modela estado e histórico. As chamadas ao provedor de LLM e à
-- API do WhatsApp ficam em edge functions; nenhuma chave de API mora aqui
-- (ver 0012, schema private).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sdr_agents — os agentes configuráveis, incluindo o orquestrador.
-- handoff_group_id fecha o ciclo: qualificou, cai na roleta daquele grupo.
-- -----------------------------------------------------------------------------
create table public.sdr_agents (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  role               text not null default 'qualifier',
  is_orchestrator    boolean not null default false,
  system_prompt      text,
  model              text not null default 'claude-sonnet-5',
  temperature        numeric(3,2) not null default 0.7
                     check (temperature between 0 and 2),
  max_turns          int not null default 12 check (max_turns > 0),
  -- Para onde o lead vai quando a IA conclui a qualificação.
  handoff_group_id   uuid references public.distribution_groups(id) on delete set null,
  handoff_to_agent_id uuid references public.sdr_agents(id) on delete set null,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Um orquestrador por vez: dois competindo pela mesma conversa é bug garantido.
create unique index sdr_agents_one_orchestrator
  on public.sdr_agents ((is_orchestrator)) where is_orchestrator and active;

create trigger sdr_agents_set_updated_at
  before update on public.sdr_agents
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- whatsapp_templates — modelos aprovados na API oficial da Meta.
-- Disparo fora de janela de 24h só é possível por template aprovado; por isso
-- approved é rastreado aqui e não presumido.
-- -----------------------------------------------------------------------------
create table public.whatsapp_templates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique,
  language             text not null default 'pt_BR',
  category             text not null default 'MARKETING'
                       check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  body                 text not null,
  -- Nomes dos placeholders na ordem em que a Meta os espera ({{1}}, {{2}}...).
  variables            text[] not null default '{}',
  provider_template_id text,
  approved             boolean not null default false,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger whatsapp_templates_set_updated_at
  before update on public.whatsapp_templates
  for each row execute function public.set_updated_at();

-- Vincula a origem do lead ao agente que deve atendê-lo.
alter table public.lead_sources
  add column sdr_agent_id uuid references public.sdr_agents(id) on delete set null,
  add column welcome_template_id uuid references public.whatsapp_templates(id) on delete set null;

-- -----------------------------------------------------------------------------
-- sdr_conversations — uma conversa por passagem do lead pelo SDR.
-- -----------------------------------------------------------------------------
create table public.sdr_conversations (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  agent_id        uuid references public.sdr_agents(id) on delete set null,
  status          text not null default 'active'
                  check (status in ('active','qualified','disqualified','handed_off','abandoned')),
  -- Nota de interesse atribuída pela IA (0-100). Alimenta a triagem.
  score           int check (score is null or score between 0 and 100),
  summary         text,
  -- Respostas estruturadas extraídas pela IA (renda, região, prazo etc.).
  collected       jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz,
  qualified_at    timestamptz,
  handed_off_at   timestamptz,
  handed_off_to   uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sdr_conversations_lead_idx   on public.sdr_conversations (lead_id);
create index sdr_conversations_status_idx on public.sdr_conversations (status)
  where status = 'active';

create trigger sdr_conversations_set_updated_at
  before update on public.sdr_conversations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- sdr_messages — histórico completo. Guarda consumo de tokens para que o custo
-- da IA seja auditável por conversa, não só na fatura do provedor.
-- -----------------------------------------------------------------------------
create table public.sdr_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.sdr_conversations(id) on delete cascade,
  author              message_author not null,
  body                text not null,
  provider_message_id text,
  template_id         uuid references public.whatsapp_templates(id) on delete set null,
  tokens_in           int,
  tokens_out          int,
  created_at          timestamptz not null default now()
);

create index sdr_messages_conversation_idx
  on public.sdr_messages (conversation_id, created_at);
create unique index sdr_messages_provider_idx
  on public.sdr_messages (provider_message_id) where provider_message_id is not null;

-- Mantém o ponteiro da última mensagem sem exigir agregação a cada leitura.
create or replace function public.sdr_messages_touch()
returns trigger
language plpgsql
as $$
begin
  update public.sdr_conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return null;
end;
$$;

create trigger sdr_messages_touch
  after insert on public.sdr_messages
  for each row execute function public.sdr_messages_touch();

-- -----------------------------------------------------------------------------
-- Remarketing — listas importadas de planilha.
-- -----------------------------------------------------------------------------
create table public.remarketing_lists (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  template_id    uuid references public.whatsapp_templates(id) on delete set null,
  agent_id       uuid references public.sdr_agents(id) on delete set null,
  handoff_group_id uuid references public.distribution_groups(id) on delete set null,
  status         broadcast_status not null default 'draft',
  scheduled_for  timestamptz,
  -- Ritmo de envio, para não queimar o número no WhatsApp.
  throttle_per_minute int not null default 20 check (throttle_per_minute > 0),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger remarketing_lists_set_updated_at
  before update on public.remarketing_lists
  for each row execute function public.set_updated_at();

create table public.remarketing_contacts (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.remarketing_lists(id) on delete cascade,
  full_name  text,
  phone      text not null,
  email      extensions.citext,
  -- Preenchido quando o contato responde e vira lead de fato.
  lead_id    uuid references public.leads(id) on delete set null,
  status     text not null default 'pending'
             check (status in ('pending','sent','delivered','replied','failed','opted_out')),
  sent_at    timestamptz,
  replied_at timestamptz,
  last_error text,
  extra      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- Mesmo telefone não entra duas vezes na mesma lista.
  unique (list_id, phone)
);

create index remarketing_contacts_pending_idx
  on public.remarketing_contacts (list_id) where status = 'pending';

-- Normaliza o telefone importado da planilha, igual aos leads.
create or replace function public.remarketing_contacts_normalize()
returns trigger
language plpgsql
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  if new.phone is null then
    raise exception 'Telefone inválido na importação: %', new.phone
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger remarketing_contacts_normalize
  before insert or update of phone on public.remarketing_contacts
  for each row execute function public.remarketing_contacts_normalize();

-- Contadores da lista, para a tela não precisar de count() a cada render.
create or replace function public.remarketing_list_stats(p_list_id uuid)
returns table (total int, pending int, sent int, replied int, failed int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*)::int,
    count(*) filter (where status = 'pending')::int,
    count(*) filter (where status in ('sent','delivered'))::int,
    count(*) filter (where status = 'replied')::int,
    count(*) filter (where status = 'failed')::int
  from public.remarketing_contacts
  where list_id = p_list_id;
$$;

-- -----------------------------------------------------------------------------
-- Handoff: a IA concluiu a qualificação e devolve o lead para a roleta.
-- -----------------------------------------------------------------------------
create or replace function public.sdr_handoff(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.sdr_conversations;
  v_group  uuid;
  v_broker uuid;
begin
  select * into v_conv from public.sdr_conversations
  where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conv.status = 'handed_off' then
    return v_conv.handed_off_to;
  end if;

  select coalesce(a.handoff_group_id,
                  (select g.id from public.distribution_groups g
                   where g.kind = 'general' and g.active limit 1))
    into v_group
  from public.sdr_agents a where a.id = v_conv.agent_id;

  -- Devolve o lead à fila do grupo alvo e roda a roleta.
  update public.leads
     set distribution_group_id = coalesce(v_group, distribution_group_id),
         status                = 'queued',
         assigned_to           = null,
         assigned_at           = null,
         attend_deadline       = null,
         sdr_qualified_at      = now(),
         funnel_stage          = 'qualified',
         last_activity_at      = now()
   where id = v_conv.lead_id;

  insert into public.lead_events (lead_id, actor_id, kind, detail)
  values (v_conv.lead_id, null, 'sdr_qualified',
          jsonb_build_object('conversation_id', p_conversation_id,
                             'score', v_conv.score,
                             'group_id', v_group));

  v_broker := public.assign_lead(v_conv.lead_id);

  update public.sdr_conversations
     set status        = 'handed_off',
         qualified_at  = coalesce(qualified_at, now()),
         handed_off_at = now(),
         handed_off_to = v_broker
   where id = p_conversation_id;

  return v_broker;
end;
$$;

-- =============================================================================
-- RLS
--
-- Configuração de agente e template é de admin/marketing. Conversa é dado de
-- lead: quem enxerga o lead, enxerga a conversa.
-- =============================================================================

alter table public.sdr_agents           enable row level security;
alter table public.whatsapp_templates   enable row level security;
alter table public.sdr_conversations    enable row level security;
alter table public.sdr_messages         enable row level security;
alter table public.remarketing_lists    enable row level security;
alter table public.remarketing_contacts enable row level security;

create policy sdr_agents_select on public.sdr_agents
  for select to authenticated using (true);
create policy sdr_agents_write on public.sdr_agents
  for all to authenticated
  using (public.has_any_role('admin','marketing','sdr'))
  with check (public.has_any_role('admin','marketing','sdr'));

create policy whatsapp_templates_select on public.whatsapp_templates
  for select to authenticated using (true);
create policy whatsapp_templates_write on public.whatsapp_templates
  for all to authenticated
  using (public.has_any_role('admin','marketing'))
  with check (public.has_any_role('admin','marketing'));

create policy sdr_conversations_select on public.sdr_conversations
  for select to authenticated
  using (
    public.has_any_role('admin','director','marketing','sdr')
    or exists (
      select 1 from public.leads l
      where l.id = sdr_conversations.lead_id
        and l.assigned_to in (select public.auth_visible_profiles())
    )
  );

create policy sdr_conversations_write on public.sdr_conversations
  for all to authenticated
  using (public.has_any_role('admin','sdr','marketing'))
  with check (public.has_any_role('admin','sdr','marketing'));

create policy sdr_messages_select on public.sdr_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.sdr_conversations c
      where c.id = sdr_messages.conversation_id
        and (
          public.has_any_role('admin','director','marketing','sdr')
          or exists (
            select 1 from public.leads l
            where l.id = c.lead_id
              and l.assigned_to in (select public.auth_visible_profiles())
          )
        )
    )
  );

create policy remarketing_lists_all on public.remarketing_lists
  for all to authenticated
  using (public.has_any_role('admin','marketing','sdr'))
  with check (public.has_any_role('admin','marketing','sdr'));

create policy remarketing_contacts_all on public.remarketing_contacts
  for all to authenticated
  using (public.has_any_role('admin','marketing','sdr'))
  with check (public.has_any_role('admin','marketing','sdr'));

revoke all on function public.sdr_handoff(uuid) from public, anon;
grant execute on function public.sdr_handoff(uuid) to authenticated, service_role;
