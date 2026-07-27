-- =============================================================================
-- Stubs do ambiente Supabase para validação local em Postgres puro.
-- NÃO faz parte das migrations. Só é aplicado pelo harness de teste
-- (scripts/validate-schema.sh) antes de rodar supabase/migrations/*.sql.
--
-- Reproduz o mínimo que as migrations assumem existir num projeto Supabase:
-- roles, schemas auth/extensions/storage e as funções auth.uid()/auth.role()/auth.jwt().
-- =============================================================================

-- Roles que o PostgREST usa. NOLOGIN: aqui só precisam existir para GRANT.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- Supabase deixa `extensions` no search_path do banco. Replicamos para que o
-- harness falhe/passe pelos mesmos motivos que produção.
alter database postgres set search_path to "$user", public, extensions;

-- Supabase concede tudo em public para anon/authenticated e usa RLS como
-- portão — não os GRANTs. Sem replicar isso aqui, todo SELECT do teste
-- falharia por permissão e daria a falsa impressão de que o RLS funciona.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- auth.users — só as colunas que o schema referencia (FK em profiles).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Claims do JWT corrente. Em produção o GoTrue popula request.jwt.claims;
-- nos testes o harness injeta o valor via set_config().
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true));
$$;

-- storage.objects — referenciado pelos anexos apenas por convenção de path,
-- mas o stub permite exercitar policies de bucket se preciso.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
