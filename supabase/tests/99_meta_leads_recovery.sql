-- Apenas no Postgres descartável do harness; nunca no banco de produção.
\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check174(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

select pg_temp.check174(exists (
  select 1 from cron.job where jobname = 'faceimob-meta-sync'
    and schedule = '0 9 * * *' and command like '%dispatch_meta_sync()%')
  and exists (
  select 1 from cron.job where jobname = 'faceimob-meta-estado-conta'
    and schedule = '0 0,1,11-23 * * *' and command like '%dispatch_meta_sync_modo(''estado'')%'),
  '0192 mantém agendamentos dos modos anteriores');

select pg_temp.check174(exists (
  select 1 from cron.job where jobname = 'faceimob-meta-leads'
    and schedule = '*/2 * * * *' and active
    and command like '%dispatch_meta_sync_modo(''leads'')%'),
  'novo job chama modo leads a cada dois minutos');
select pg_temp.check174((
  select count(*) = 2 from information_schema.columns
   where table_schema = 'public' and table_name = 'automation_settings'
     and column_name in ('meta_leads_started_at', 'meta_leads_last_sync_at')
     and data_type = 'timestamp with time zone' and is_nullable = 'YES'),
  'marcos da recuperação são timestamps nullable');
select pg_temp.check174((
  select meta_leads_started_at is null and meta_leads_last_sync_at is null
    from public.automation_settings where id),
  'instalação deixa recuperação desligada e sem checkpoint');
select pg_temp.check174(
  not has_function_privilege('anon', 'public.dispatch_meta_sync_modo(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.dispatch_meta_sync_modo(text)', 'execute')
  and has_function_privilege('service_role', 'public.dispatch_meta_sync_modo(text)', 'execute'),
  'dispatch continua exclusiva da service role');

create schema if not exists net;
create table net.chamadas_174 (url text, body jsonb, headers jsonb, timeout_milliseconds int);
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
begin
  insert into net.chamadas_174 values (url, body, headers, timeout_milliseconds);
  return 1;
end;
$$;

delete from private.integration_credentials where provider = 'supabase';
insert into private.integration_credentials (provider, label, secret, active) values
  ('supabase', 'functions_url', 'https://example.invalid/functions/v1/', true),
  ('supabase', 'service_role_key', 'chave-ficticia-174', true);
update public.meta_ad_accounts set enabled = false;
update public.automation_settings set meta_leads_started_at = null, leads_paused = false where id;

select pg_temp.check174(public.dispatch_meta_sync_modo('leads') = false,
  'sem marco de ativação não dispara');
select pg_temp.check174((select count(*) from net.chamadas_174) = 0,
  'sem ativação não faz HTTP');

update public.automation_settings set meta_leads_started_at = now(), leads_paused = true where id;
select pg_temp.check174(public.dispatch_meta_sync_modo('leads') = false,
  'pausa global impede recuperação mesmo ativada');
select pg_temp.check174((select count(*) from net.chamadas_174) = 0,
  'pausado não faz HTTP');

update public.automation_settings set leads_paused = false where id;
select pg_temp.check174(public.dispatch_meta_sync_modo('leads') = true,
  'ativado dispara sem depender de conta Ads ligada');
select pg_temp.check174((select count(*) from net.chamadas_174) = 1,
  'um disparo gera uma chamada');
select pg_temp.check174(exists (
  select 1 from net.chamadas_174
   where url = 'https://example.invalid/functions/v1/meta-sync'
     and body = '{"modo":"leads"}'::jsonb
     and headers->>'Authorization' = 'Bearer chave-ficticia-174'
     and timeout_milliseconds = 150000),
  'modo leads usa URL, Bearer do cofre e timeout de 150 segundos');
select pg_temp.check174((
  select meta_leads_last_sync_at is null from public.automation_settings where id),
  'dispatch não avança checkpoint antes da recuperação concluir');

rollback;
