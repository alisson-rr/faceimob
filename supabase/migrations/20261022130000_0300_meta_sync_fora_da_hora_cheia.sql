-- =============================================================================
-- 0300 · Sincronização da Meta sai da hora cheia
--
-- 22/10/2026: no check-in do meio-dia "o servidor espera um se logar para
-- liberar o próximo". O log das funções no mesmo intervalo (14:55–15:20 UTC)
-- mostra várias funções derrubadas por tempo ("wall clock duration warning /
-- early termination"). A `faceimob-meta-sync` (0197) roda em '0 * * * *' —
-- 15:00 UTC é exatamente 12:00 em Brasília — e é a função longa da casa (até
-- 150 s), disputando o servidor com a leva de check-ins que começa na hora
-- cheia. Passa para o minuto 15 (09:15, 12:15…), longe do início dos turnos das 09:00 e das 12:00. Os jobs de 5 em
-- 5 minutos são curtos e ficam como estão.
-- =============================================================================

do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning '[0300] pg_cron ausente; nada a reagendar.';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-meta-sync') then
      perform cron.unschedule('faceimob-meta-sync');
    end if;
    perform cron.schedule('faceimob-meta-sync', '15 * * * *', $cmd$select public.dispatch_meta_sync();$cmd$);
  exception when others then
    raise warning '[0300] não foi possível reagendar a sincronização da Meta: %', sqlerrm;
  end;
end
$do$;
