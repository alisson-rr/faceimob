-- =============================================================================
-- 0013 · Agendamento dos jobs da roleta  (Sprint 1 — S1.1 e S1.2)
--
-- release_expired_leads() existe desde 0005 e auto_checkout_expired() desde
-- 0012, mas nada as chamava. As consequências em produção:
--
--  1. A trava de 5 minutos nunca liberava o lead. leads.attend_deadline vencia
--     e ninguém varria: o lead ficava em 'assigned' para sempre e a roleta
--     parava na primeira atribuição. É o bug de maior impacto em aberto —
--     o requisito central das duas atas (14/07 e 23/07) não funcionava.
--  2. Corretor que esquecia o check-out continuava elegível na fila depois do
--     turno, recebendo lead fora do horário e fora da loja.
--
-- Três jobs entram aqui:
--
--  faceimob-release-expired-leads  · 30s  · varre leads vencidos
--  faceimob-auto-checkout-expired  · 1min · fecha turnos vencidos
--  faceimob-purge-cron-history     · 03:10 · poda cron.job_run_details
--
-- O terceiro não é opcional: um job de 30s grava ~2.880 linhas/dia em
-- cron.job_run_details, que o pg_cron não limpa sozinho.
--
-- Decisões de agendamento:
--
--  · release a cada 30s, não a cada minuto. O atraso máximo na devolução do
--    lead passa a ser ~5min30s em vez de ~6min. A função declara ser
--    idempotente e usa `for update skip locked`, então execuções concorrentes
--    são seguras por construção.
--  · auto-checkout a cada minuto, e não num horário fixo por turno: a função é
--    dirigida por dado (compara now() com work_shifts.checkout_time), e os
--    horários de turno são editáveis pelo admin. Cravar o horário no cron
--    duplicaria essa configuração e sairia de sincronia no primeiro ajuste.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pg_cron
--
-- No Supabase hospedado a extensão está disponível em todos os planos. O
-- harness de validação roda em Postgres puro, sem ela, e recebe um stub de
-- cron.* em tests/00_supabase_stubs.sql.
--
-- Ausência de pg_cron E de stub aborta a migration de propósito: um agendamento
-- que não acontece em silêncio é indistinguível do estado que esta migration
-- veio corrigir.
-- -----------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
  elsif to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception
      'pg_cron indisponível e sem stub em cron.schedule(text,text,text): '
      'os jobs da roleta não seriam agendados. Habilite pg_cron no projeto '
      'antes de aplicar a 0013.';
  else
    raise notice '[0013] pg_cron ausente; usando o stub de cron.* do harness.';
  end if;
end
$do$;

-- -----------------------------------------------------------------------------
-- Idempotência
--
-- cron.unschedule() levanta erro quando o job não existe, então o estado é
-- checado antes. Permite reaplicar a migration e reexecutar em `db reset`.
-- -----------------------------------------------------------------------------
do $do$
declare
  v_job text;
begin
  foreach v_job in array array[
    'faceimob-release-expired-leads',
    'faceimob-auto-checkout-expired',
    'faceimob-purge-cron-history'
  ]
  loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end
$do$;

-- -----------------------------------------------------------------------------
-- Job 1 · Devolver à fila os leads cujo prazo de atendimento venceu
--
-- Agendamento em segundos exige pg_cron >= 1.5. O Supabase hospedado entrega
-- 1.6, mas o fallback existe para instâncias antigas e para o ambiente local:
-- sem ele a migration falharia e a roleta continuaria parada — trocar 30s por
-- 1min degrada a precisão, não a função.
-- -----------------------------------------------------------------------------
do $do$
begin
  begin
    perform cron.schedule(
      'faceimob-release-expired-leads',
      '30 seconds',
      $cmd$select public.release_expired_leads();$cmd$
    );
    raise notice '[0013] release_expired_leads agendada a cada 30 segundos.';
  exception
    when others then
      perform cron.schedule(
        'faceimob-release-expired-leads',
        '* * * * *',
        $cmd$select public.release_expired_leads();$cmd$
      );
      raise notice '[0013] pg_cron sem suporte a intervalo em segundos (%). '
                   'release_expired_leads agendada a cada 1 minuto.', sqlerrm;
  end;
end
$do$;

-- -----------------------------------------------------------------------------
-- Job 2 · Fechar os turnos vencidos
-- -----------------------------------------------------------------------------
select cron.schedule(
  'faceimob-auto-checkout-expired',
  '* * * * *',
  $cmd$select public.auto_checkout_expired();$cmd$
);

-- -----------------------------------------------------------------------------
-- Job 3 · Podar o histórico do próprio cron
--
-- 7 dias é o suficiente para investigar uma falha na semana e mantém a tabela
-- em ~30 mil linhas em regime.
-- -----------------------------------------------------------------------------
select cron.schedule(
  'faceimob-purge-cron-history',
  '10 3 * * *',
  $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days';$cmd$
);

-- -----------------------------------------------------------------------------
-- Observabilidade
--
-- Um cron que falha em silêncio é indistinguível de um cron que não existe —
-- exatamente o estado em que o sistema estava. Esta função dá ao admin (e ao
-- roteiro de teste da S1.5) uma leitura de saúde sem acesso ao console do banco.
-- -----------------------------------------------------------------------------
create or replace function public.cron_jobs_health()
returns table (
  job_name        text,
  schedule        text,
  active          boolean,
  last_run_at     timestamptz,
  last_status     text,
  last_return     text,
  failures_24h    bigint,
  runs_24h        bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    last_run.start_time,
    last_run.status::text,
    last_run.return_message::text,
    coalesce(stats.failures, 0),
    coalesce(stats.runs, 0)
  from cron.job j
  left join lateral (
    select d.start_time, d.status, d.return_message
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) last_run on true
  left join lateral (
    select
      count(*)                                          as runs,
      count(*) filter (where d.status <> 'succeeded')    as failures
    from cron.job_run_details d
    where d.jobid = j.jobid
      and d.start_time > now() - interval '24 hours'
  ) stats on true
  where public.is_admin()
    and j.jobname like 'faceimob-%'
  order by j.jobname;
$$;

comment on function public.cron_jobs_health is
  'Saúde dos jobs de cron do FACEIMOB. Vazio para quem não é admin — a checagem '
  'de papel está no WHERE, não em raise, para a função poder ser consumida '
  'direto por um select do frontend.';

revoke all on function public.cron_jobs_health() from public, anon;
grant execute on function public.cron_jobs_health() to authenticated, service_role;
