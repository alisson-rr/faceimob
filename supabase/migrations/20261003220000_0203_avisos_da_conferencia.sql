-- =============================================================================
-- 0203 — avisos da conferência: push e e-mail para cada papel
--
-- Pedido do cliente em 03/10/2026: "não recebi e-mail de análise para
-- conferência nem de análise enviada ao CCA; verifique as notificações ao
-- corretor, gerente, diretor, admin e CCA quando pertinente, e-mail e push".
--
-- O que havia (push = a linha `in_app`, entregue pela push-dispatch):
--   · envio para conferência  → push só aos gerentes do negócio; e-mail nenhum;
--   · aprovação (vai ao CCA)  → push aos corretores e ao CCA; e-mail nenhum;
--   · devolução               → push aos corretores; e-mail nenhum.
-- Os e-mails que existiam eram os de movimento de status, atrás de
-- interruptores que nascem desligados.
--
-- Agora, num gatilho só (no fim da transação, quando a mensagem do envio já
-- está gravada), cada mudança de `document_review_status` completa o que
-- faltava, sem repetir o push que a função de origem já dá:
--   · enviada  → push a corretores, diretores e administradores; e-mail a
--                corretores, gerentes, diretores e administradores;
--   · aprovada → push a gerentes, diretores e administradores; e-mail a
--                todos eles, aos corretores e ao CCA;
--   · devolvida→ push aos diretores; e-mail a corretores, gerentes e diretores.
-- Quem fez a ação não recebe o próprio aviso. O e-mail usa a fila da Brevo
-- (`cca_move_emails`) com origem 'conferencia' e interruptor próprio, ligado.
-- =============================================================================

alter table public.automation_settings
  add column if not exists conferencia_email boolean not null default true;
comment on column public.automation_settings.conferencia_email is
  'E-mail dos avisos da conferência (enviada, aprovada, devolvida) — 0203. Ligado por padrão.';

alter table public.cca_move_emails drop constraint if exists cca_move_emails_source_check;
alter table public.cca_move_emails
  add constraint cca_move_emails_source_check check (source in ('cca', 'pipeline', 'conferencia'));

-- O descarte por interruptor desligado passa a conhecer a origem nova. Corpo
-- da 0157, mudando só o `case`.
create or replace function public.dispatch_pending_cca_emails()
returns void language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare v_url text; v_key text;
begin
  update public.cca_move_emails e set status = 'expired',
    last_error = case when e.created_at < now() - interval '24 hours'
      then 'Não saiu em 24 h: descartado para não chegar fora de hora.'
      else 'Envio desligado em Admin → Integrações: descartado.' end
  where e.status in ('queued','sending','failed') and e.attempts < 5
    and (e.created_at < now() - interval '24 hours' or not coalesce(
      (select case e.source when 'pipeline' then s.pipeline_move_email
                            when 'conferencia' then s.conferencia_email
                            else s.cca_move_email end
       from public.automation_settings s where s.id), false));
  if not exists (select 1 from public.cca_move_emails e where e.attempts < 5
    and (e.status = 'queued' or (e.status in ('failed','sending') and e.updated_at < now() - interval '10 minutes'))) then return; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  select secret into v_url from private.integration_credentials where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials where provider = 'supabase' and label = 'service_role_key' and active;
  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_cca_emails: configure functions_url e service_role_key em Integrações.';
    return;
  end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/cca-email-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key), body := '{}'::jsonb);
end;
$$;

create or replace function public.avisar_conferencia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator     uuid := auth.uid();
  v_evento   text;
  v_titulo   text;
  v_mensagem text;
  v_cliente  text;
  v_ator_nome text;
  v_push     text[];   -- papéis do negócio que ganham push aqui
  v_email    text[];   -- papéis do negócio que ganham e-mail
  v_admin    boolean;
  v_cca      boolean;
  v_kind     text;
begin
  if new.document_review_status is not distinct from old.document_review_status then
    return null;
  end if;

  if new.document_review_status = 'pending' then
    v_evento := 'Análise enviada para conferência';
    v_kind := 'document_review_requested';
    v_push := array['broker', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := false;
    -- A mensagem do envio é o último comentário que a função gravou.
    select h.to_value into v_mensagem from public.deal_history h
     where h.deal_id = new.id and h.kind = 'comment' order by h.created_at desc limit 1;
  elsif new.document_review_status = 'approved' then
    v_evento := 'Análise aprovada e enviada ao CCA';
    v_kind := 'document_review_approved';
    v_push := array['manager', 'director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := true; v_cca := true;
    v_mensagem := 'A conferência foi aprovada e o negócio seguiu para a análise de crédito.';
  elsif new.document_review_status = 'returned' then
    -- Devolve o gerente (conferência) ou o CCA (pendência de documento).
    v_evento := 'Análise devolvida para ajustes';
    v_kind := 'document_review_returned';
    v_push := array['director'];
    v_email := array['broker', 'manager', 'director'];
    v_admin := false; v_cca := false;
    v_mensagem := coalesce(new.document_review_reason, 'A documentação voltou para ajustes.');
  else
    return null;
  end if;

  select nullif(btrim(c.full_name), '') into v_cliente from public.deal_clients c where c.deal_id = new.id and c.ordinal = 1;
  select full_name into v_ator_nome from public.profiles where id = v_ator;
  v_titulo := v_evento || ': ' || coalesce(v_cliente, new.code, 'negócio');

  -- Push (sino). Fora quem agiu e quem já recebeu da função de origem.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct q.pid, v_kind, v_titulo, left(coalesce(v_mensagem, ''), 2000),
         case when v_kind = 'document_review_requested' then '/pipeline?conferencia=pendente' else '/pipeline' end,
         'in_app'::notification_channel
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_push)
      union
      select ur.profile_id from public.user_roles ur where v_admin and ur.role in ('admin', 'partner')
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where q.pid is distinct from v_ator
     -- Quem a função de origem já avisou: gerente no envio, corretor na
     -- aprovação e na devolução.
     and not exists (
       select 1 from public.deal_participants x
        where x.deal_id = new.id and x.profile_id = q.pid
          and x.role::text = case new.document_review_status
                               when 'pending' then 'manager' else 'broker' end);

  -- E-mail (fila da Brevo), um por endereço.
  insert into public.cca_move_emails
    (deal_id, profile_id, to_email, deal_code, client_name, stage_name, actor_name, message, source, detalhes)
  select distinct on (lower(btrim(p.email::text)))
         new.id, p.id, btrim(p.email::text), new.code, v_cliente, v_evento, coalesce(v_ator_nome, 'Sistema'),
         coalesce(v_mensagem, ''), 'conferencia',
         public.email_detalhes_do_negocio(new.id)
           || jsonb_build_object('status2', v_evento, 'observacao', coalesce(v_mensagem, ''))
    from (
      select dp.profile_id as pid from public.deal_participants dp
       where dp.deal_id = new.id and dp.role::text = any (v_email)
      union
      select ur.profile_id from public.user_roles ur where v_admin and ur.role in ('admin', 'partner')
      union
      select ur.profile_id from public.user_roles ur where v_cca and ur.role = 'cca'
    ) q
    join public.profiles p on p.id = q.pid and p.status = 'active'
   where q.pid is distinct from v_ator
     and coalesce((select s.conferencia_email from public.automation_settings s where s.id), false)
     and btrim(p.email::text) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     and p.email::text !~* '@sem-email\.local$'
   order by lower(btrim(p.email::text)), p.id;

  return null;
end;
$$;

revoke all on function public.avisar_conferencia() from public, anon, authenticated;

-- No fim da transação: o envio grava a mensagem DEPOIS de trocar o status.
drop trigger if exists avisar_conferencia on public.deals;
create constraint trigger avisar_conferencia
  after update of document_review_status on public.deals
  deferrable initially deferred
  for each row execute function public.avisar_conferencia();
