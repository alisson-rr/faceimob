-- =============================================================================
-- 99 · Gatilhos de cron da sincronização da Meta (migration 0118)
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. Os dois jobs (sincronização diária e estado da conta de hora em hora)
--      estão agendados chamando a dispatch certa.
--   2. Só a service role dispara: authenticated e anon não executam.
--   3. Sem conta ligada ou sem URL/chave no cofre, nenhuma chamada HTTP; modo
--      inválido leva 22023. A falta do token da Meta NÃO faz a dispatch voltar
--      cedo: quem registra a execução 'falhou' é a edge.
--   4. Com cofre e conta ligada: um POST para a edge meta-sync, com a service
--      role no header, o modo no corpo e o timeout longo.
--
-- O pg_net é simulado dentro de uma transação desfeita no fim: nenhum outro
-- arquivo enxerga o stub.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check118(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

\echo '== 1. agendamento =='
select pg_temp.check118(exists (
  select 1 from cron.job where jobname = 'faceimob-meta-sync'
     and schedule = '0 9 * * *' and command like '%dispatch_meta_sync()%'),
  'faceimob-meta-sync às 09:00 UTC (06:00 em São Paulo) chamando dispatch_meta_sync()');
select pg_temp.check118(exists (
  select 1 from cron.job where jobname = 'faceimob-meta-estado-conta'
     and schedule = '0 0,1,11-23 * * *' and command like '%dispatch_meta_sync_modo(''estado'')%'),
  'faceimob-meta-estado-conta de hora em hora (08:00–22:00 em São Paulo) no modo estado');

\echo '== 2. grants =='
select pg_temp.check118(not has_function_privilege('authenticated', 'public.dispatch_meta_sync()', 'execute'),
  'authenticated não dispara a sincronização');
select pg_temp.check118(not has_function_privilege('authenticated', 'public.dispatch_meta_sync_modo(text)', 'execute'),
  'authenticated não dispara o modo estado');
select pg_temp.check118(not has_function_privilege('anon', 'public.dispatch_meta_sync_modo(text)', 'execute'),
  'anon não dispara');
select pg_temp.check118(has_function_privilege('service_role', 'public.dispatch_meta_sync()', 'execute')
  and has_function_privilege('service_role', 'public.dispatch_meta_sync_modo(text)', 'execute'),
  'service_role dispara as duas');

\echo '== 3 e 4. quando chama e o que manda =='
begin;
  create schema if not exists net;
  create table net.chamadas_118 (url text, body jsonb, headers jsonb, timeout_milliseconds int);
  create or replace function net.http_post(
    url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$
  begin
    insert into net.chamadas_118 values (url, body, headers, timeout_milliseconds);
    return 1;
  end $$;

  delete from private.integration_credentials where provider = 'supabase';
  insert into private.integration_credentials (provider, label, secret, active) values
    ('supabase', 'functions_url', 'https://exemplo.supabase.co/functions/v1/', true),
    ('supabase', 'service_role_key', 'chave-de-servico', true);

  update public.meta_ad_accounts set enabled = false;
  select pg_temp.check118(public.dispatch_meta_sync() = false
    and public.dispatch_meta_sync_modo('estado') = false
    and (select count(*) from net.chamadas_118) = 0,
    'sem conta ligada: volta false e não chama a edge');

  do $$
  begin
    perform public.dispatch_meta_sync_modo('xyz');
    raise exception 'FALHOU: modo inválido deveria ser recusado';
  exception when sqlstate '22023' then
    raise notice '  ok  modo inválido leva 22023';
  end $$;

  insert into public.meta_ad_accounts (act_id, name, enabled) values ('act_1180001', 'Conta 0118', true);
  select pg_temp.check118(public.dispatch_meta_sync() = true, 'com conta ligada, a sincronização completa dispara');
  select pg_temp.check118((select count(*) from net.chamadas_118) = 1, 'uma chamada por disparo, não uma por conta');
  select pg_temp.check118((select url from net.chamadas_118) = 'https://exemplo.supabase.co/functions/v1/meta-sync',
    'URL da edge meta-sync, sem barra dobrada');
  select pg_temp.check118((select headers->>'Authorization' from net.chamadas_118) = 'Bearer chave-de-servico',
    'Bearer da service role do cofre');
  select pg_temp.check118((select body from net.chamadas_118) = '{"modo":"completo"}'::jsonb,
    'corpo {modo: completo}');
  select pg_temp.check118((select timeout_milliseconds from net.chamadas_118) = 150000, 'timeout de 150 s');

  delete from net.chamadas_118;
  -- Em comandos separados: a subconsulta do mesmo comando não vê a linha que a
  -- função acabou de gravar (snapshot do comando).
  select pg_temp.check118(public.dispatch_meta_sync_modo('estado') = true, 'o modo estado dispara');
  select pg_temp.check118((select body from net.chamadas_118) = '{"modo":"estado"}'::jsonb,
    'o cron de hora em hora manda {modo: estado}');

  delete from net.chamadas_118;
  delete from private.integration_credentials where provider = 'supabase';
  select pg_temp.check118(public.dispatch_meta_sync() = false and (select count(*) from net.chamadas_118) = 0,
    'sem functions_url/service_role_key no cofre: volta false, sem chamada');
rollback;
