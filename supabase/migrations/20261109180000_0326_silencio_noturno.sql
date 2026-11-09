-- =============================================================================
-- 0326 · Silêncio noturno: nada de WhatsApp nem push das 22h às 7h
--
-- Pedido de 09/11/2026: não incomodar os corretores à noite. Das 22:00 às
-- 06:59 (São Paulo):
--   * WhatsApp: o aviso NÃO é enviado e sai da fila com o motivo escrito. Não
--     fica guardado para a manhã: a fila já descarta o que passa de 2 h
--     (0083), e "lead novo" de ontem às 23h chegando às 7h só confunde.
--   * Push do navegador: não sai; a janela do push é de 15 min (0143), então o
--     aviso noturno não acumula para a manhã.
--   * O sino (in_app) continua recebendo tudo: quem abrir o CRM vê.
-- =============================================================================

create or replace function public.silencio_noturno(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  -- `faceimob.silencio_noturno` = 'off'/'on' só existe para os testes SQL, que
  -- chamam os despachos sem controlar o relógio e não podem mudar de resultado
  -- conforme a hora em que a CI roda. Em produção ninguém define e vale a hora.
  select case coalesce(nullif(current_setting('faceimob.silencio_noturno', true), ''), 'auto')
           when 'off' then false
           when 'on'  then true
           else (p_at at time zone 'America/Sao_Paulo')::time >= time '22:00'
             or (p_at at time zone 'America/Sao_Paulo')::time <  time '07:00'
         end;
$$;
comment on function public.silencio_noturno(timestamptz) is
  'Das 22:00 às 06:59 de São Paulo não sai WhatsApp nem push (0326). O sino continua.';
revoke all on function public.silencio_noturno(timestamptz) from public, anon;
grant execute on function public.silencio_noturno(timestamptz) to authenticated, service_role;

-- WhatsApp: mesmo corpo da 0083, com o silêncio antes do HTTP.
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
  -- Antes de qualquer coisa: o que passou do prazo sai da fila com motivo.
  perform public.expire_stale_outbound_notifications();

  -- 0326: à noite o aviso sai da fila sem envio, com o motivo na linha.
  if public.silencio_noturno() then
    update public.notifications
       set sent_at = now(),
           last_error = 'silêncio noturno (22h às 7h): não enviado'
     where channel = 'whatsapp' and sent_at is null;
    return;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

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

-- Push: quem reivindica o lote não pega nada à noite (vale para o gatilho do
-- insert e para o cron).
create or replace function public.claim_push_batch(p_limit integer default 50)
returns table (
  id uuid, profile_id uuid, kind text, category text, title text, body text,
  link text, created_at timestamptz, push_attempts integer, push_done_subs uuid[]
)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.notifications n
     set push_claimed_at = now(),
         push_attempts   = n.push_attempts + 1
   where not public.silencio_noturno()
     and n.id in (select public.push_pendentes(least(greatest(coalesce(p_limit, 50), 1), 200)))
     and n.push_sent_at is null
     and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '2 minutes')
  returning n.id, n.profile_id, n.kind, public.push_category(n.kind), n.title, n.body,
            n.link, n.created_at, n.push_attempts, n.push_done_subs;
$$;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- O cron do push também não acorda a edge à noite.
create or replace function public.dispatch_pending_push()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if public.silencio_noturno() then
    return false;
  end if;
  -- O job roda a cada minuto: sem pendência, nenhuma requisição HTTP.
  if not exists (select 1 from public.push_pendentes(1)) then
    return false;
  end if;
  return public.push_kick();
end;
$$;
revoke all on function public.dispatch_pending_push() from public, anon, authenticated;
grant execute on function public.dispatch_pending_push() to service_role;

-- A tela de custo (0323) não conta o silêncio como falha de envio: não houve
-- tentativa. Mesmo corpo da 0323, com o recorte.
create or replace function public.whatsapp_avisos_por_dia(p_dias integer default 30)
returns table (
  dia         date,
  enviados    bigint,
  falhas      bigint,
  sem_telefone bigint,
  esperando   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 90);
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para ver os avisos de WhatsApp.' using errcode = '42501';
  end if;

  return query
  select (n.created_at at time zone 'America/Sao_Paulo')::date                          as dia,
         count(*) filter (where n.sent_at is not null and n.last_error is null)          as enviados,
         count(*) filter (where n.last_error is not null
                            and n.last_error <> 'perfil sem telefone'
                            and n.last_error not like 'silêncio noturno%')               as falhas,
         count(*) filter (where n.last_error = 'perfil sem telefone')                    as sem_telefone,
         count(*) filter (where n.sent_at is null and n.last_error is null)              as esperando
    from public.notifications n
   where n.channel = 'whatsapp'
     and n.kind = 'lead_assigned'
     and n.created_at >= (now() at time zone 'America/Sao_Paulo')::date - (v_dias - 1)
   group by 1
   order by 1;
end;
$$;
revoke all on function public.whatsapp_avisos_por_dia(integer) from public, anon;
grant execute on function public.whatsapp_avisos_por_dia(integer) to authenticated;
