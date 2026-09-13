-- =============================================================================
-- 0144 · Aviso de job com falha conta só execução TERMINADA com falha
--
-- `notify_cron_failures()` (0083) filtrava `d.status <> 'succeeded'`. No pg_cron
-- a linha de `cron.job_run_details` nasce 'starting' e passa por 'running' (e
-- 'sending'/'connecting') antes de terminar em 'succeeded' ou 'failed'. O aviso
-- roda às HH:15 — no mesmo instante em que os jobs de minuto em minuto, e ele
-- mesmo, estão com a execução em andamento.
--
-- Medido na homologação em 12/09/2026: às 21:15 a passada gravou 12 avisos
-- `cron_failure`, e as últimas 48 h de `cron.job_run_details` não têm UMA
-- execução com status diferente de 'succeeded'. Eram execuções em andamento
-- contadas como falha. Aviso falso no sino do admin e da diretoria ensina a
-- ignorar o aviso verdadeiro.
--
-- Conserto: só `status = 'failed'`. Execução que nunca termina não vira aviso
-- aqui — ela aparece na aba Saúde dos jobs, e não é o fato "falhou".
--
-- As 12 linhas já gravadas ficam: são histórico do sino e esta migration não
-- apaga dado. O resto da função é o da 0083, sem mudança.
-- =============================================================================

create or replace function public.notify_cron_failures()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('cron.job_run_details') is null then
    return 0;  -- harness sem pg_cron
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'cron_failure',
         format('Automação com falha: %s', falhas.jobname),
         format('%s execução(ões) do agendador falharam nas últimas 6 h. %s',
                falhas.total,
                case when dest.eh_admin
                     then 'Abra Admin · Integrações · Saúde dos jobs.'
                     else 'Peça ao administrador para abrir Admin · Integrações · Saúde dos jobs.'
                end),
         -- Só quem passa em `is_admin()` abre a tela (0083).
         case when dest.eh_admin then '/admin/integrations' end,
         'in_app'
    from (
      select j.jobname, count(*) as total
        from cron.job j
        join cron.job_run_details d on d.jobid = j.jobid
       where j.jobname like 'faceimob-%'
         -- 'starting'/'running'/'sending'/'connecting' ainda não terminaram.
         and d.status = 'failed'
         and d.start_time > now() - interval '6 hours'
       group by j.jobname
    ) falhas
    cross join lateral (
      -- Um aviso por PESSOA, não por papel: papel é acumulável (0083).
      select ur.profile_id,
             bool_or(ur.role = 'admin') as eh_admin
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role in ('admin', 'director')
       group by ur.profile_id
    ) dest
   where not exists (
     select 1 from public.notifications n
      where n.profile_id = dest.profile_id
        and n.kind = 'cron_failure'
        and n.title = format('Automação com falha: %s', falhas.jobname)
        and n.created_at > now() - interval '6 hours'
   );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_cron_failures is
  'Avisa admin e diretoria quando um job faceimob-* TERMINA com falha (status failed; execução em andamento não conta desde a 0144). O link para Admin · Integrações só acompanha o aviso do admin: a aba exige is_admin() na rota e dentro de cron_jobs_health().';

revoke all on function public.notify_cron_failures() from public, anon, authenticated;
