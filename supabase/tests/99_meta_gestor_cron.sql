-- =============================================================================
-- 99 · Gatilho de cron do gestor de tráfego IA (migration 0119)
--
-- O que cada bloco defende, e o que quebra sem ele:
--   1. O job diário está agendado às 10:00 UTC (07:00 em São Paulo).
--   2. Só a service role dispara: IA em loop por clique está fora (custo).
--   3. Sem conta ligada ou sem URL/chave no cofre, nenhuma chamada HTTP. A
--      falta da chave da OpenAI NÃO faz a dispatch voltar cedo: quem registra
--      a execução 'falhou' é a edge.
--   4. Com cofre e conta ligada: um POST para meta-traffic-manager com corpo
--      {} (todas as contas), a service role no header e o timeout longo.
--
-- O pg_net é simulado dentro de uma transação desfeita no fim: nenhum outro
-- arquivo enxerga o stub.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check119(cond boolean, label text)
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
select pg_temp.check119(exists (
  select 1 from cron.job where jobname = 'faceimob-meta-gestor-ia'
     and schedule = '0 10 * * *' and command like '%dispatch_meta_gestor()%'),
  'faceimob-meta-gestor-ia às 10:00 UTC chamando dispatch_meta_gestor()');

\echo '== 2. grants =='
select pg_temp.check119(not has_function_privilege('authenticated', 'public.dispatch_meta_gestor()', 'execute'),
  'authenticated não executa dispatch_meta_gestor');
select pg_temp.check119(not has_function_privilege('anon', 'public.dispatch_meta_gestor()', 'execute'),
  'anon não executa dispatch_meta_gestor');
select pg_temp.check119(has_function_privilege('service_role', 'public.dispatch_meta_gestor()', 'execute'),
  'service_role executa dispatch_meta_gestor');

\echo '== 3 e 4. quando chama e o que manda =='
begin;
  create schema if not exists net;
  create table net.chamadas_119 (url text, body jsonb, headers jsonb, timeout_milliseconds int);
  create or replace function net.http_post(
    url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$
  begin
    insert into net.chamadas_119 values (url, body, headers, timeout_milliseconds);
    return 1;
  end $$;

  delete from private.integration_credentials where provider = 'supabase';
  insert into private.integration_credentials (provider, label, secret, active) values
    ('supabase', 'functions_url', 'https://exemplo.supabase.co/functions/v1/', true),
    ('supabase', 'service_role_key', 'chave-de-servico', true);

  update public.meta_ad_accounts set enabled = false;
  select public.dispatch_meta_gestor();
  select pg_temp.check119((select count(*) from net.chamadas_119) = 0, 'sem conta ligada, nenhuma chamada HTTP');

  insert into public.meta_ad_accounts (act_id, name, enabled) values ('act_1190001', 'Conta 0119', true);
  select public.dispatch_meta_gestor();
  select pg_temp.check119((select count(*) from net.chamadas_119) = 1, 'com conta ligada, uma chamada');
  select pg_temp.check119((select url from net.chamadas_119) = 'https://exemplo.supabase.co/functions/v1/meta-traffic-manager',
    'URL da edge meta-traffic-manager');
  select pg_temp.check119((select headers->>'Authorization' from net.chamadas_119) = 'Bearer chave-de-servico',
    'Bearer da service role do cofre');
  select pg_temp.check119((select body from net.chamadas_119) = '{}'::jsonb, 'corpo {}: o cron roda todas as contas');
  select pg_temp.check119((select timeout_milliseconds from net.chamadas_119) = 150000, 'timeout de 150 s');

  delete from net.chamadas_119;
  delete from private.integration_credentials where provider = 'supabase';
  select public.dispatch_meta_gestor();
  select pg_temp.check119((select count(*) from net.chamadas_119) = 0,
    'sem functions_url/service_role_key no cofre, nenhuma chamada');
rollback;
