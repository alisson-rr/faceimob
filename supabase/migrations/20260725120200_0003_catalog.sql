-- =============================================================================
-- 0003 · Catálogo
--
-- Tabelas de domínio que o admin edita e o resto do sistema referencia:
-- construtoras, empreendimentos, estágios do funil, tipos de documento e
-- origens de lead.
--
-- Estágios do pipeline são LINHAS, não enum: "o administrador terá a
-- capacidade de gerenciar os estágios do pipeline". O desfecho macro
-- (deal_outcome) continua sendo enum porque relatórios e gamificação não podem
-- depender de linha editável.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- developers — construtoras.
-- O fluxo determina o que acontece quando a documentação fica pronta:
-- interno = entra na esteira do CCA da casa; externo = e-mail automático para
-- a construtora com os anexos do card.
-- -----------------------------------------------------------------------------
create table public.developers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  slug          text not null unique,
  flow          developer_flow not null default 'internal',
  -- Destino dos documentos no fluxo externo. Obrigatório nesse fluxo.
  submission_email extensions.citext,
  contact_name  text,
  contact_phone text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint developers_external_needs_email
    check (flow <> 'external' or submission_email is not null)
);

create trigger developers_set_updated_at
  before update on public.developers
  for each row execute function public.set_updated_at();

create or replace function public.developers_ensure_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  candidate text;
  n int := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;
  base_slug := coalesce(nullif(public.slugify(new.name), ''), 'construtora');
  candidate := base_slug;
  while exists (
    select 1 from public.developers d
    where d.slug = candidate and d.id is distinct from new.id
  ) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

create trigger developers_ensure_slug
  before insert on public.developers
  for each row execute function public.developers_ensure_slug();

-- -----------------------------------------------------------------------------
-- developer_projects — empreendimentos de uma construtora.
-- -----------------------------------------------------------------------------
create table public.developer_projects (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developers(id) on delete cascade,
  name         text not null,
  city         text,
  state        char(2),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (developer_id, name)
);

create trigger developer_projects_set_updated_at
  before update on public.developer_projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- pipeline_stages — colunas do funil comercial, ordenáveis e renomeáveis.
--
-- max_minutes materializa o stage_max_minutes que hoje vive no front: o tempo
-- máximo que um negócio pode ficar parado no estágio antes de virar alerta.
-- -----------------------------------------------------------------------------
create table public.pipeline_stages (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  label             text not null,
  position          int  not null,
  outcome           deal_outcome not null default 'open',
  color             text,
  -- Impede converter/avançar sem documentação. O cliente exige ao menos um
  -- documento na virada de lead para negócio.
  requires_document boolean not null default false,
  -- SLA de permanência. NULL = sem limite.
  max_minutes       int check (max_minutes is null or max_minutes > 0),
  is_initial        boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index pipeline_stages_position_idx on public.pipeline_stages (position) where active;
-- Exatamente um estágio de entrada.
create unique index pipeline_stages_one_initial on public.pipeline_stages ((is_initial)) where is_initial;

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- stage_permissions — quem pode mover negócio para cada estágio.
-- Ausência de linha = ninguém além de admin pode entrar no estágio.
-- -----------------------------------------------------------------------------
create table public.stage_permissions (
  stage_id  uuid not null references public.pipeline_stages(id) on delete cascade,
  role      app_role not null,
  can_enter boolean not null default true,
  can_exit  boolean not null default true,
  primary key (stage_id, role)
);

create or replace function public.can_enter_stage(target_stage uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1
        from public.stage_permissions sp
        join public.user_roles ur on ur.role = sp.role
        where ur.profile_id = auth.uid()
          and sp.stage_id = target_stage
          and sp.can_enter
      );
$$;

-- -----------------------------------------------------------------------------
-- document_types — os "campos específicos para cada tipo de documento".
--
-- Substitui o campo único de anexo que o cliente apontou como ineficiente.
-- naming_pattern alimenta a renomeação automática no upload; os placeholders
-- são resolvidos pela aplicação ({cliente}, {tipo}, {data}, {negocio}).
-- -----------------------------------------------------------------------------
create table public.document_types (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  label                   text not null,
  category                text not null default 'geral',
  required_for_conversion boolean not null default false,
  allows_multiple         boolean not null default false,
  naming_pattern          text default '{tipo}-{cliente}-{data}',
  sort_order              int not null default 0,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger document_types_set_updated_at
  before update on public.document_types
  for each row execute function public.set_updated_at();

comment on column public.document_types.allows_multiple is
  'Permite vários arquivos do mesmo tipo. Verdadeiro para a categoria "Outros".';

-- -----------------------------------------------------------------------------
-- lead_sources — de onde o lead veio.
-- form_id casa o lead recebido no webhook da Meta com a origem e, via
-- distribution_group_forms (0004), com a roleta que deve recebê-lo.
-- -----------------------------------------------------------------------------
create table public.lead_sources (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label      text not null,
  channel    text not null default 'meta'
             check (channel in ('meta','whatsapp','organic','indication','import','portal','other')),
  form_id    text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index lead_sources_form_idx on public.lead_sources (form_id) where form_id is not null;

create trigger lead_sources_set_updated_at
  before update on public.lead_sources
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — catálogo é leitura para todo autenticado, escrita para admin.
-- Sem isso os seletores do app ficariam vazios para corretor.
-- =============================================================================

alter table public.developers         enable row level security;
alter table public.developer_projects enable row level security;
alter table public.pipeline_stages    enable row level security;
alter table public.stage_permissions  enable row level security;
alter table public.document_types     enable row level security;
alter table public.lead_sources       enable row level security;

create policy developers_select on public.developers
  for select to authenticated using (true);
create policy developers_write on public.developers
  for all to authenticated
  using (public.has_any_role('admin','cca')) with check (public.has_any_role('admin','cca'));

create policy developer_projects_select on public.developer_projects
  for select to authenticated using (true);
create policy developer_projects_write on public.developer_projects
  for all to authenticated
  using (public.has_any_role('admin','cca')) with check (public.has_any_role('admin','cca'));

create policy pipeline_stages_select on public.pipeline_stages
  for select to authenticated using (true);
create policy pipeline_stages_write on public.pipeline_stages
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy stage_permissions_select on public.stage_permissions
  for select to authenticated using (true);
create policy stage_permissions_write on public.stage_permissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy document_types_select on public.document_types
  for select to authenticated using (true);
create policy document_types_write on public.document_types
  for all to authenticated
  using (public.has_any_role('admin','cca')) with check (public.has_any_role('admin','cca'));

create policy lead_sources_select on public.lead_sources
  for select to authenticated using (true);
create policy lead_sources_write on public.lead_sources
  for all to authenticated
  using (public.has_any_role('admin','marketing')) with check (public.has_any_role('admin','marketing'));
