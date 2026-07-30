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

-- -----------------------------------------------------------------------------
-- cron.* — stub do pg_cron
--
-- A imagem do harness é postgres puro e não traz pg_cron, mas a 0013 agenda os
-- jobs da roleta. Sem este stub a validação pararia na 0013 e o agendamento
-- ficaria sem cobertura de teste — que é exatamente como o bug original
-- (nenhum cron agendado) passou despercebido por 12 migrations.
--
-- Reproduz a superfície que a 0013 usa: cron.job, cron.job_run_details,
-- cron.schedule(name, schedule, command) e cron.unschedule(name). Aceita
-- intervalo em segundos, como o pg_cron >= 1.5 do Supabase.
-- -----------------------------------------------------------------------------
create schema if not exists cron;

create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean not null default true,
  database text not null default current_database(),
  username text not null default current_user,
  nodename text not null default 'localhost',
  nodeport int  not null default 5432
);

create table if not exists cron.job_run_details (
  runid          bigserial primary key,
  jobid          bigint,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $$
declare
  v_jobid bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command  = excluded.command,
        active   = true
  returning jobid into v_jobid;

  return v_jobid;
end;
$$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then
    raise exception 'could not find valid entry for job "%"', job_name;
  end if;
  return true;
end;
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
