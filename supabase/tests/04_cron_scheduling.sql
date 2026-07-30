-- =============================================================================
-- Teste do agendamento dos jobs da roleta  (Sprint 1 — S1.1 e S1.2)
--
-- Por que este arquivo existe: 02_business_rules.sql já provava que
-- release_expired_leads() faz a coisa certa quando chamada — e ainda assim o
-- sistema ficou 12 migrations em produção sem nada chamá-la. Função correta e
-- nunca executada passa em todos os testes de comportamento.
--
-- O que se afirma aqui é o elo que faltava: os jobs existem, estão ativos,
-- apontam para as funções certas e têm a cadência combinada nas atas.
--
-- Não depende de seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check(cond boolean, label text)
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

\echo '== jobs de cron agendados =='

do $$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  -- ---------------------------------------------------------------------------
  -- 1. Varredura de leads vencidos — o job que destrava a roleta
  -- ---------------------------------------------------------------------------
  select j.schedule, j.command, j.active
    into v_schedule, v_command, v_active
  from cron.job j
  where j.jobname = 'faceimob-release-expired-leads';

  perform pg_temp.check(v_schedule is not null,
    'job faceimob-release-expired-leads está agendado');
  perform pg_temp.check(v_active,
    'job da varredura está ativo');
  perform pg_temp.check(v_command like '%release_expired_leads%',
    'job da varredura chama release_expired_leads()');

  -- A trava combinada em ata é de 5 minutos. Uma cadência acima de 1 minuto
  -- transformaria "5 minutos" em "5 a 10 minutos" na prática.
  perform pg_temp.check(
    v_schedule in ('30 seconds', '* * * * *'),
    'cadência da varredura é sub-minuto ou de 1 minuto (é ' || v_schedule || ')');

  -- ---------------------------------------------------------------------------
  -- 2. Fechamento automático de turno
  -- ---------------------------------------------------------------------------
  select j.schedule, j.command, j.active
    into v_schedule, v_command, v_active
  from cron.job j
  where j.jobname = 'faceimob-auto-checkout-expired';

  perform pg_temp.check(v_schedule is not null,
    'job faceimob-auto-checkout-expired está agendado');
  perform pg_temp.check(v_active,
    'job de check-out automático está ativo');
  perform pg_temp.check(v_command like '%auto_checkout_expired%',
    'job de check-out chama auto_checkout_expired()');

  -- ---------------------------------------------------------------------------
  -- 3. Poda do histórico do cron
  --
  -- Com a varredura a cada 30s são ~2.880 execuções/dia registradas. Sem poda a
  -- cron.job_run_details cresce para sempre.
  -- ---------------------------------------------------------------------------
  select j.schedule, j.command, j.active
    into v_schedule, v_command, v_active
  from cron.job j
  where j.jobname = 'faceimob-purge-cron-history';

  perform pg_temp.check(v_schedule is not null,
    'job faceimob-purge-cron-history está agendado');
  perform pg_temp.check(v_command like '%job_run_details%',
    'job de poda limpa cron.job_run_details');
end
$$;

\echo '== reagendamento é idempotente =='

do $$
declare
  v_before bigint;
  v_after  bigint;
  v_dup    bigint;
begin
  select count(*) into v_before from cron.job where jobname like 'faceimob-%';

  -- Mesma chamada que a 0013 faz. Reaplicar a migration (ou rodar db reset num
  -- banco que já tem os jobs) não pode duplicar agendamento: dois jobs iguais
  -- rodando a varredura em paralelo é dobro de carga sem ganho.
  perform cron.schedule(
    'faceimob-release-expired-leads',
    '30 seconds',
    'select public.release_expired_leads();'
  );

  select count(*) into v_after from cron.job where jobname like 'faceimob-%';
  perform pg_temp.check(v_after = v_before,
    'reagendar pelo mesmo nome não cria job duplicado');

  select count(*) into v_dup
  from (
    select j.jobname from cron.job j
    where j.jobname like 'faceimob-%'
    group by j.jobname having count(*) > 1
  ) d;
  perform pg_temp.check(v_dup = 0, 'nenhum nome de job repetido');
end
$$;

\echo '== leitura de saúde é restrita a admin =='

do $$
declare
  v_rows int;
begin
  -- cron_jobs_health() é security definer sobre cron.*, que o client não
  -- alcança. A checagem de papel está no WHERE: sem admin, retorna vazio em vez
  -- de erro, para poder ser consumida direto por um select do frontend.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000ff',
                      'role', 'authenticated')::text, false);

  select count(*) into v_rows from public.cron_jobs_health();
  perform pg_temp.check(v_rows = 0,
    'não-admin não enxerga a saúde dos jobs');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo 'agendamento ok'
