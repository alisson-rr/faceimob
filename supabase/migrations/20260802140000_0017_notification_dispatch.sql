-- =============================================================================
-- 0017 — Fila de entrega das notificações de WhatsApp
--
-- `notify_lead_assigned` e `notify_lead_timeout` já gravavam em `notifications`
-- com `channel = 'whatsapp'`. Ninguém drenava essa fila, então o requisito
-- "avisar o corretor que perdeu o lead por prazo" (ata 14/07) existia como
-- linha no banco e nunca virava mensagem.
--
-- Quem entrega é a edge function `notify-dispatch`, idempotente por `sent_at`.
-- Esta migration cuida do lado do banco: o índice da fila e o agendamento.
--
-- Agendamento: pg_cron não faz HTTP sozinho. Com `pg_net` disponível, agenda o
-- POST para a function. Sem `pg_net`, avisa alto — um disparo que não acontece
-- em silêncio é o estado que esta migration veio corrigir, o mesmo raciocínio
-- da 0013.
-- =============================================================================

-- Índice parcial da fila: o worker sempre lê o mesmo recorte.
create index if not exists notifications_pending_whatsapp_idx
  on public.notifications (created_at)
  where channel = 'whatsapp' and sent_at is null;

-- -----------------------------------------------------------------------------
-- Configuração do endpoint. Guardada no cofre para não hardcodar URL nem chave
-- na migration — e porque só a service role lê de lá.
-- -----------------------------------------------------------------------------
do $do$
declare
  v_has_net  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  v_has_cron boolean := to_regprocedure('cron.schedule(text,text,text)') is not null;
begin
  if not v_has_cron then
    raise notice '[0017] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  -- Estado conhecido antes de agendar, como na 0013.
  begin
    perform cron.unschedule('faceimob-notify-dispatch');
  exception when others then
    null;
  end;

  if not v_has_net then
    raise notice
      '[0017] pg_net indisponível: a fila de WhatsApp NÃO será drenada automaticamente. '
      'Habilite pg_net e reaplique, ou agende uma chamada externa a '
      'POST /functions/v1/notify-dispatch a cada minuto.';
    return;
  end if;

  -- Com pg_net, o cron chama a function. A URL e a chave vêm de
  -- app_settings.* (GUC do projeto), não do código desta migration.
  perform cron.schedule(
    'faceimob-notify-dispatch',
    '* * * * *',
    $cmd$
    select net.http_post(
      url     := current_setting('app.functions_url', true) || '/notify-dispatch',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
                 ),
      body    := '{}'::jsonb
    );
    $cmd$
  );
  raise notice '[0017] notify-dispatch agendada a cada minuto via pg_net.';
end
$do$;
