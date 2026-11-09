-- =============================================================================
-- 0326 — silêncio noturno: das 22h às 7h não sai WhatsApp nem push.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

-- Fronteiras no relógio de São Paulo (UTC-3).
select pg_temp.ok(not public.silencio_noturno('2026-11-09 21:59:00-03'), '21:59 ainda envia');
select pg_temp.ok(public.silencio_noturno('2026-11-09 22:00:00-03'), '22:00 silencia');
select pg_temp.ok(public.silencio_noturno('2026-11-10 06:59:00-03'), '06:59 silencia');
select pg_temp.ok(not public.silencio_noturno('2026-11-10 07:00:00-03'), '07:00 volta a enviar');

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000003260001';
  v_id uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c3260.test', '{"full_name":"Corretor 3260"}');
  insert into public.notifications (profile_id, kind, title, body, channel)
    values (cor, 'lead_assigned', 't', 'b', 'whatsapp') returning id into v_id;

  perform set_config('faceimob.silencio_noturno', 'on', true);
  perform public.dispatch_pending_notifications();
  perform pg_temp.ok(
    (select sent_at is not null and last_error like 'silêncio noturno%' from public.notifications where id = v_id),
    'à noite o WhatsApp sai da fila sem envio, com o motivo');
  perform pg_temp.ok(not exists (select 1 from public.claim_push_batch(50)), 'à noite o push não é reivindicado');
  perform pg_temp.ok(not public.dispatch_pending_push(), 'à noite o cron do push não acorda a edge');
end;
$$;

rollback;
