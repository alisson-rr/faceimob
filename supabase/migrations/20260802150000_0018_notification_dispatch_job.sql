-- =============================================================================
-- 0018 — Agendamento efetivo da fila de notificações
--
-- A 0017 criou o índice da fila e tentou agendar, mas dependia de duas coisas
-- que não existiam: a extensão `pg_net` e dois GUCs (`app.functions_url`,
-- `app.service_role_key`) que ninguém define. Resultado prático: a migration
-- aplicou, avisou, e nenhum job foi criado — a fila de WhatsApp continua parada.
--
-- Correção em duas frentes:
--
--  1. `pg_net` é habilitada aqui (está disponível em projeto Supabase; só falta
--     no harness local, que é Postgres puro).
--  2. A URL e a chave saem do cofre em vez de GUC. O cofre já existe, já é
--     restrito e o admin já o preenche pela tela de Integrações — um GUC exigiria
--     `alter database`, que ninguém lembra de rodar e não aparece em lugar nenhum
--     da interface.
--
-- A função é SECURITY DEFINER para alcançar `private`. Ela não recebe parâmetro
-- e não devolve dado: é só o gatilho do worker.
-- =============================================================================

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net with schema extensions';
  else
    raise notice '[0018] pg_net indisponível (esperado no harness local).';
  end if;
end
$do$;

create or replace function public.dispatch_pending_notifications()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  -- Sem configuração não há o que tentar. Silêncio aqui seria o mesmo defeito
  -- da 0017; o aviso aparece no log do job e em cron_jobs_health().
  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_notifications: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  -- Nada a enviar: não gasta requisição HTTP à toa (o job roda a cada minuto).
  if not exists (
    select 1 from public.notifications
     where channel = 'whatsapp' and sent_at is null
  ) then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/notify-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.dispatch_pending_notifications() from public, anon, authenticated;

comment on function public.dispatch_pending_notifications() is
  'Gatilho da edge function notify-dispatch. Chamada pelo pg_cron; lê URL e chave do cofre.';

-- -----------------------------------------------------------------------------
-- Agendamento. Mesmo padrão defensivo da 0013: estado conhecido antes de criar.
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0018] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    perform cron.unschedule('faceimob-notify-dispatch');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'faceimob-notify-dispatch',
    '* * * * *',
    $cmd$select public.dispatch_pending_notifications();$cmd$
  );
  raise notice '[0018] notify-dispatch agendada a cada minuto.';
end
$do$;
