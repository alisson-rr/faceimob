-- =============================================================================
-- 0002 · Identidade, hierarquia e visibilidade
--
-- Modelo central de quem é quem e quem enxerga o quê. Todo RLS do resto do
-- sistema é construído sobre as funções definidas aqui.
--
-- Duas decisões que valem explicação:
--
-- 1. Papel é N:N (user_roles), não uma coluna em profiles. O cliente foi
--    explícito: "Diretores possuem a capacidade de atuar em múltiplos papéis
--    simultaneamente, como gerentes ou corretores". O schema antigo tinha papel
--    duplicado em dois lugares, o que gerou o caso do Rafael recebendo
--    notificações de CCA indevidamente.
--
-- 2. Vínculo com equipe tem histórico (joined_at/left_at), não é uma coluna
--    team em profiles. "Gerentes possuem autonomia para desligar corretores,
--    mantendo o histórico de desempenho do mês mesmo após o desligamento".
-- =============================================================================

create type profile_status as enum ('active', 'suspended', 'terminated');

-- -----------------------------------------------------------------------------
-- profiles — espelho de auth.users com os dados de negócio.
-- Senha NUNCA trafega por aqui: autenticação é 100% Supabase Auth (magic link /
-- OTP por e-mail). A ata de 23/07 registra a remoção das senhas em texto do
-- banco como requisito de segurança.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null check (length(btrim(full_name)) > 0),
  email          extensions.citext not null unique,
  phone          text,
  avatar_url     text,
  slug           text unique,
  status         profile_status not null default 'active',
  hired_at       date,
  terminated_at  date,
  -- IP dinâmico é comum nas lojas; o admin pode liberar o corretor do check-in
  -- por IP caso a caso sem mexer na lista global de IPs.
  bypass_ip_check boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint profiles_terminated_consistency
    check ((status = 'terminated') = (terminated_at is not null))
);

create index profiles_status_idx on public.profiles (status) where status = 'active';
create index profiles_full_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on column public.profiles.bypass_ip_check is
  'Libera este usuário da validação de IP no check-in. Para casos de IP dinâmico na loja.';

-- Slug estável para links públicos. Gerado do nome, com sufixo numérico em caso
-- de colisão (dois "João Silva" na base).
create or replace function public.profiles_ensure_slug()
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

  base_slug := nullif(public.slugify(new.full_name), '');
  if base_slug is null then
    base_slug := 'user';
  end if;

  candidate := base_slug;
  while exists (
    select 1 from public.profiles p
    where p.slug = candidate and p.id is distinct from new.id
  ) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger profiles_ensure_slug
  before insert or update of full_name, slug on public.profiles
  for each row execute function public.profiles_ensure_slug();

-- -----------------------------------------------------------------------------
-- user_roles — um usuário, N papéis.
-- -----------------------------------------------------------------------------
create table public.user_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

-- -----------------------------------------------------------------------------
-- teams — equipe operacional. Tem um gerente e responde a um diretor.
-- Um diretor lidera vários times e normalmente também tem o seu próprio.
-- -----------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  director_id uuid references public.profiles(id) on delete set null,
  manager_id  uuid references public.profiles(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index teams_director_idx on public.teams (director_id) where active;
create index teams_manager_idx  on public.teams (manager_id)  where active;

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create or replace function public.teams_ensure_slug()
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

  base_slug := coalesce(nullif(public.slugify(new.name), ''), 'equipe');
  candidate := base_slug;
  while exists (
    select 1 from public.teams t
    where t.slug = candidate and t.id is distinct from new.id
  ) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger teams_ensure_slug
  before insert on public.teams
  for each row execute function public.teams_ensure_slug();

-- -----------------------------------------------------------------------------
-- team_members — vínculo com histórico. left_at preserva o desempenho passado
-- de quem saiu, sem expor o inativo nas listagens correntes.
-- -----------------------------------------------------------------------------
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  date not null default current_date,
  left_at    date,
  created_at timestamptz not null default now(),

  constraint team_members_period check (left_at is null or left_at >= joined_at)
);

-- Um corretor pertence a no máximo uma equipe por vez.
create unique index team_members_one_active
  on public.team_members (profile_id) where left_at is null;

create index team_members_team_idx on public.team_members (team_id) where left_at is null;

-- =============================================================================
-- Funções de visibilidade
--
-- Todas SECURITY DEFINER: precisam ler profiles/teams/user_roles ignorando RLS,
-- caso contrário a policy de profiles consultaria user_roles cuja policy
-- consultaria profiles — recursão infinita, o erro clássico deste modelo.
-- search_path fixo evita sequestro de resolução de nomes.
-- =============================================================================

create or replace function public.auth_roles()
returns app_role[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(ur.role), '{}'::app_role[])
  from public.user_roles ur
  where ur.profile_id = auth.uid();
$$;

comment on function public.auth_roles is 'Papéis do usuário autenticado. Vazio para anon.';

create or replace function public.has_role(target app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid() and ur.role = target
  );
$$;

create or replace function public.has_any_role(variadic targets app_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid() and ur.role = any(targets)
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin');
$$;

-- Leitura ampla sem direito de escrita: diretoria, sócios e admin.
create or replace function public.can_read_all()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role('admin', 'director', 'partner');
$$;

-- Equipes que o usuário lidera, como gerente ou como diretor.
create or replace function public.auth_led_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id
  from public.teams t
  where t.active
    and (t.manager_id = auth.uid() or t.director_id = auth.uid());
$$;

-- O conjunto de pessoas que o usuário corrente pode enxergar. É a espinha
-- dorsal do RLS: leads, negócios e métricas filtram por este conjunto.
--
--   admin/partner  -> todo mundo
--   director       -> ele mesmo + todos das equipes que dirige
--   manager        -> ele mesmo + todos das equipes que gerencia
--   broker/demais  -> só ele mesmo
create or replace function public.auth_visible_profiles()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where public.has_any_role('admin', 'partner')

  union

  select auth.uid()
  where auth.uid() is not null

  union

  select tm.profile_id
  from public.team_members tm
  where tm.left_at is null
    and tm.team_id in (select public.auth_led_team_ids());
$$;

comment on function public.auth_visible_profiles is
  'Perfis visíveis ao usuário corrente segundo a hierarquia. Usar em RLS como: owner_id in (select public.auth_visible_profiles()).';

-- Atalho booleano para quando só interessa testar um alvo.
create or replace function public.can_see_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target is not null
     and target in (select public.auth_visible_profiles());
$$;

-- Gerência sobre alguém: usado para escrita (reatribuir lead, desligar corretor).
-- Diferente de can_see_profile porque exclui o próprio usuário — ninguém
-- gerencia a si mesmo.
create or replace function public.manages_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role('admin')
      or exists (
        select 1
        from public.team_members tm
        where tm.profile_id = target
          and tm.left_at is null
          and tm.team_id in (select public.auth_led_team_ids())
      );
$$;

-- -----------------------------------------------------------------------------
-- Provisionamento: auth.users -> profiles
-- O admin convida por e-mail; o usuário define a senha no primeiro acesso.
-- Nenhuma senha é gravada ou lida por este schema.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    ),
    coalesce(new.email, new.id::text || '@sem-email.local'),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;

  -- Todo mundo entra como corretor; papéis extras são concedidos pelo admin.
  insert into public.user_roles (profile_id, role)
  values (new.id, 'broker')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Registro de permissões finas
-- "Douglas solicitou maior autonomia na configuração de permissões por
--  hierarquia, para definir o que cada nível pode visualizar ou editar."
-- O código da permissão é textual e estável; a concessão é editável em runtime.
-- -----------------------------------------------------------------------------
create table public.permissions (
  code        text primary key,
  label       text not null,
  category    text not null,
  description text
);

create table public.role_permissions (
  role       app_role not null,
  permission text not null references public.permissions(code) on delete cascade,
  allowed    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (role, permission)
);

create trigger role_permissions_set_updated_at
  before update on public.role_permissions
  for each row execute function public.set_updated_at();

-- Admin sempre pode tudo, independentemente do que estiver gravado — evita
-- que uma edição infeliz na tela de permissões tranque o próprio admin fora.
create or replace function public.has_permission(code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1
        from public.role_permissions rp
        join public.user_roles ur on ur.role = rp.role
        where ur.profile_id = auth.uid()
          and rp.permission = code
          and rp.allowed
      );
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.user_roles       enable row level security;
alter table public.teams            enable row level security;
alter table public.team_members     enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;

-- profiles ---------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id in (select public.auth_visible_profiles()));

-- O usuário edita os próprios dados de contato. Papel, status e bypass de IP
-- não estão aqui: são alterados por admin via policy abaixo.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Gerente/diretor podem desligar quem está sob sua gestão.
create policy profiles_manager_update on public.profiles
  for update to authenticated
  using (public.manages_profile(id))
  with check (public.manages_profile(id));

-- user_roles -------------------------------------------------------------
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (profile_id in (select public.auth_visible_profiles()));

-- Concessão de papel é exclusiva do admin. Foi justamente papel duplicado
-- concedido fora de controle que gerou o problema de notificação de CCA.
create policy user_roles_admin_write on public.user_roles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- teams ------------------------------------------------------------------
-- Leitura ampla: nomes de equipe alimentam filtros e seletores em todo o app,
-- e não carregam dado sensível.
create policy teams_select on public.teams
  for select to authenticated
  using (true);

create policy teams_admin_write on public.teams
  for all to authenticated
  using (public.has_any_role('admin', 'director'))
  with check (public.has_any_role('admin', 'director'));

-- team_members -----------------------------------------------------------
create policy team_members_select on public.team_members
  for select to authenticated
  using (
    profile_id in (select public.auth_visible_profiles())
    or team_id in (select public.auth_led_team_ids())
  );

create policy team_members_manage on public.team_members
  for all to authenticated
  using (
    public.is_admin()
    or team_id in (select public.auth_led_team_ids())
  )
  with check (
    public.is_admin()
    or team_id in (select public.auth_led_team_ids())
  );

-- permissions / role_permissions -----------------------------------------
-- Todo autenticado lê o catálogo: o front usa isso para esconder botões.
create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy permissions_admin_write on public.permissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

create policy role_permissions_admin_write on public.role_permissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
