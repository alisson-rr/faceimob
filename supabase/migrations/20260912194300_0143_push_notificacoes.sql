-- =============================================================================
-- 0143 · Notificações push: o aviso do sino chega ao aparelho
--
-- Pedido do dono (12/09/2026): push para tudo que envolve receber lead e
-- atividade no lead, com o corretor como destinatário principal.
--
--  1. O PUSH VIAJA NA LINHA `in_app`. Não há fila nova: toda notificação do sino
--     de quem tem aparelho ativado e a categoria ligada vira push. O sino segue
--     sendo o registro durável; o push é só um canal de entrega.
--  2. `push_subscriptions` (um aparelho por linha) e `push_preferences` (por
--     categoria; sem linha = padrão). Aparelho só entra por RPC, que aceita
--     apenas endpoint https de serviço de push conhecido: com endpoint livre, o
--     nosso servidor faria POST para a URL que qualquer usuário escolhesse.
--  3. `push_category(kind)` é a ÚNICA regra kind → categoria.
--  4. Gatilho por COMANDO em `notifications` acorda a edge `push-dispatch` na
--     hora; o cron `faceimob-push-dispatch` cobre a nova tentativa.
--     `claim_push_batch()` reivindica o lote, e os dois chamando juntos não
--     mandam o mesmo aviso em dobro.
--  5. Avisos de ATIVIDADE DE LEAD que faltavam ao dono do lead (§8).
--
-- MAPA DE PRODUTORES — medido na homologação em 12/09/2026 (pg_proc, todas as
-- funções que gravam em `notifications`). Todos gravam `in_app` para quem age:
--   lead_recebido  lead_assigned ............ notify_lead_assigned (lead_assignments
--                                              INSERT: roleta, `reassign_lead` manual,
--                                              handoff do SDR) → corretor que recebeu.
--                                              O link já é `/leads?lead=<id>` desde a
--                                              0032; nada a corrigir na origem.
--   lead_prazo     lead_lost_timeout ........ notify_lead_timeout → corretor que perdeu
--                  lead_no_response ......... mark_no_response_leads → dono do lead
--                  lead_unattended .......... assign_lead → gerente, diretor, admin
--                  task_due ................. notify_due_tasks → responsável
--   lead_atividade whatsapp_human_turn ...... notify_whatsapp_unmatched → dono da
--                                              conversa, SDR, corretor do lead
--                  whatsapp_unmatched ....... notify_whatsapp_unmatched → SDR, admin, sócio
--                  lead_comment, task_assigned, visit_scheduled (novos, §8)
--   credito        cca_pending .............. notify_cca_case_created → papel cca
--                  document_review_* ........ submit_deal_for_manager_review (gerentes),
--                                              review_deal_documents e
--                                              cca_cases_sync_esteira_label (corretores)
--                  submission_failed ........ notify_submission_gave_up → quem pediu, admin
--                  cca_status_changed (novo, §8)
--   outros         cron_failure (0144 conserta a contagem), outbound_expired,
--                  game_paused, public_link_expiring, public_link_pin_rotated,
--                  meta_* (meta_notificar). `meta_enfileirar_resumo_diario` grava só
--                  WhatsApp por desenho: não tem linha de sino, logo não tem push.
--
-- Idempotente e sem dependência de dado da carga: `if not exists`, `create or
-- replace`, `drop ... if exists`. Aplica sem pg_cron e sem pg_net (harness):
-- `net.http_post` só é resolvida quando o push é acionado, e antes disso
-- `push_kick()` confere se ela existe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Entrega por push na própria linha do sino
--
-- `push_claimed_at` não estava no contrato e é necessário: o gatilho acorda o
-- worker a cada notificação e o cron a cada minuto, e duas execuções lendo a
-- mesma pendência mandariam o mesmo "Novo lead" duas vezes. A reivindicação
-- vale 2 min e, quando algum aparelho falha, a edge NÃO a solta: o vencimento é
-- o intervalo entre tentativas. Soltar na hora deixava qualquer insert de outra
-- pessoa acordar a edge e gastar as 5 tentativas em segundos.
--
-- `push_done_subs` (também fora do contrato): aparelhos já tratados. A nova
-- tentativa vai só para quem falhou; sem isso, o celular que já mostrou o aviso
-- tocava de novo a cada tentativa do notebook que falha.
-- -----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists push_sent_at    timestamptz,
  add column if not exists push_attempts   integer not null default 0,
  add column if not exists push_error      text,
  add column if not exists push_claimed_at timestamptz,
  add column if not exists push_done_subs  uuid[];

comment on column public.notifications.push_sent_at is
  'Push tratado em todos os aparelhos do destinatário (entregue ou assinatura descartada). Nulo = pendente ou fora do push.';
comment on column public.notifications.push_attempts is
  'Lotes que reivindicaram esta linha para push (claim_push_batch). Em 5 o push desiste; o sino continua.';
comment on column public.notifications.push_error is
  'Última falha de push: status HTTP e host do serviço, nunca o endpoint (que é a credencial do aparelho).';
comment on column public.notifications.push_claimed_at is
  'Reivindicação do lote pela push-dispatch; vence em 2 min, que também é o intervalo entre tentativas.';
comment on column public.notifications.push_done_subs is
  'Aparelhos (push_subscriptions.id) já tratados nesta notificação; a nova tentativa pula esses.';

-- O destinatário só escreve `read_at`, que é o que a tela grava
-- (src/integrations/supabase/notifications.ts). A 0023 dá UPDATE da linha
-- inteira e `notifications_update` não recorta coluna: com o push, reescrever
-- `created_at`, `kind` ou `push_*` da própria linha furava o intervalo do
-- `send_test_push` e punha a pessoa na frente da fila de push de todo mundo.
-- Mesmo recorte por coluna que a 0083 fez em `whatsapp_inbound_messages`.
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- `push_test` só pela RPC `send_test_push`. O kind ignora a preferência da
-- pessoa, e `notifications_insert` (0012) deixa admin, diretor e gerente gravar
-- aviso com qualquer conteúdo para qualquer perfil: sem o recorte, um insert em
-- lote chegava à tela de bloqueio de quem desligou todas as categorias.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check ((select public.has_any_role('admin', 'director', 'manager')) and kind <> 'push_test');

-- O cron pergunta "há pendência?" a cada minuto: recorte por data sobre o sino.
create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where channel = 'in_app' and push_sent_at is null;

-- -----------------------------------------------------------------------------
-- 2. Aparelhos
--
-- Escrita só pelas RPCs (§5): elas validam o endpoint e amarram a linha a
-- `auth.uid()`. Pela tabela, o dono lê e apaga a própria linha — e ninguém mais.
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        integer not null default 0
);

comment on table public.push_subscriptions is
  'Aparelhos com push ativado. Entra por register_push_subscription (endpoint validado) e sai no logout, em 404/410 do serviço de push ou após 10 falhas seguidas.';

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Sem INSERT/UPDATE para authenticated no grant: a policy não recorta coluna, e
-- um UPDATE direto trocaria o endpoint validado por qualquer URL.
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- -----------------------------------------------------------------------------
-- 3. Preferências por categoria
-- -----------------------------------------------------------------------------
create table if not exists public.push_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category   text not null,
  enabled    boolean not null,
  primary key (profile_id, category),
  constraint push_preferences_category_check
    check (category in ('lead_recebido', 'lead_prazo', 'lead_atividade', 'credito', 'outros'))
);

comment on table public.push_preferences is
  'Categoria de push ligada ou desligada por pessoa. Sem linha vale o padrão: ligada nas quatro de lead e crédito, desligada em outros.';

alter table public.push_preferences enable row level security;

drop policy if exists push_preferences_own on public.push_preferences;
create policy push_preferences_own on public.push_preferences
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

revoke all on public.push_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.push_preferences to authenticated;
grant select on public.push_preferences to service_role;

-- -----------------------------------------------------------------------------
-- 4. A regra: que aviso é de qual categoria, e quem recebe push
-- -----------------------------------------------------------------------------
create or replace function public.push_category(p_kind text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_kind = 'lead_assigned' then 'lead_recebido'
    when p_kind in ('lead_lost_timeout', 'lead_no_response', 'lead_unattended', 'task_due')
      then 'lead_prazo'
    when p_kind in ('lead_comment', 'task_assigned', 'visit_scheduled',
                    'whatsapp_human_turn', 'whatsapp_unmatched')
      then 'lead_atividade'
    when p_kind in ('cca_pending', 'cca_status_changed', 'submission_failed',
                    'document_review_requested', 'document_review_approved', 'document_review_returned')
      then 'credito'
    -- Kind novo de lead ou de crédito que alguém esqueça de classificar não pode
    -- nascer em 'outros', que vem desligada: o aviso sumiria do celular sem erro.
    when p_kind like 'lead\_%' then 'lead_atividade'
    when p_kind like 'cca\_%' or p_kind like 'document\_review\_%' then 'credito'
    -- push_test, cron_failure, outbound_expired, game_paused, public_link_*, meta_*…
    else 'outros'
  end;
$$;

comment on function public.push_category(text) is
  'Única regra kind → categoria de push (lead_recebido, lead_prazo, lead_atividade, credito, outros). A edge push-dispatch deriva TTL e urgência da categoria.';

revoke all on function public.push_category(text) from public, anon;
grant execute on function public.push_category(text) to authenticated, service_role;

-- Destinatário com aparelho de perfil ativo e categoria ligada. `push_test`
-- ignora a preferência: é o botão "testar" da própria pessoa.
create or replace function public.push_destino(p_profile_id uuid, p_kind text)
returns boolean
language sql
stable
as $$
  select exists (
           select 1
             from public.push_subscriptions s
             join public.profiles p on p.id = s.profile_id and p.status = 'active'
            where s.profile_id = p_profile_id
         )
     and (
           p_kind = 'push_test'
           or coalesce(
                (select pp.enabled
                   from public.push_preferences pp
                  where pp.profile_id = p_profile_id
                    and pp.category = public.push_category(p_kind)),
                public.push_category(p_kind) <> 'outros')
         );
$$;

-- O que ainda deve sair: 15 min (aviso de lead velho não serve), 5 tentativas,
-- reivindicação vencida.
create or replace function public.push_pendentes(p_limit integer)
returns setof uuid
language sql
stable
as $$
  select n.id
    from public.notifications n
   where n.channel = 'in_app'
     and n.push_sent_at is null
     and n.push_attempts < 5
     and n.created_at > now() - interval '15 minutes'
     and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '2 minutes')
     and public.push_destino(n.profile_id, n.kind)
   order by n.created_at
   limit p_limit;
$$;

revoke all on function public.push_destino(uuid, text) from public, anon, authenticated;
revoke all on function public.push_pendentes(integer) from public, anon, authenticated;
grant execute on function public.push_destino(uuid, text) to service_role;
grant execute on function public.push_pendentes(integer) to service_role;

-- A edge reivindica o lote. A condição de reivindicação se repete no UPDATE de
-- propósito: sob READ COMMITTED, a segunda execução que esperou a trava da linha
-- reavalia o WHERE na versão nova e pula o que a primeira acabou de pegar.
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
   where n.id in (select public.push_pendentes(least(greatest(coalesce(p_limit, 50), 1), 200)))
     and n.push_sent_at is null
     and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '2 minutes')
  returning n.id, n.profile_id, n.kind, public.push_category(n.kind), n.title, n.body,
            n.link, n.created_at, n.push_attempts, n.push_done_subs;
$$;

comment on function public.claim_push_batch(integer) is
  'Reivindica até p_limit notificações in_app pendentes de push (push_pendentes) para a edge push-dispatch. Só service_role.';

revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Acionar a edge: gatilho na hora, cron para a nova tentativa
--
-- Mesmo padrão da 0083/0118 para URL e chave (cofre, security definer). Banco
-- sem pg_net volta `false` sem erro: o aviso fica no sino.
-- -----------------------------------------------------------------------------
create or replace function public.push_kick()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return false;
  end if;

  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'push_kick: cadastre functions_url e service_role_key em Integrações.';
    return false;
  end if;

  perform net.http_post(
    url                  := rtrim(v_url, '/') || '/push-dispatch',
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_key
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  return true;
end;
$$;

revoke all on function public.push_kick() from public, anon, authenticated;

create or replace function public.dispatch_pending_push()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- O job roda a cada minuto: sem pendência, nenhuma requisição HTTP.
  if not exists (select 1 from public.push_pendentes(1)) then
    return false;
  end if;
  return public.push_kick();
end;
$$;

comment on function public.dispatch_pending_push() is
  'Cron faceimob-push-dispatch: aciona a edge push-dispatch só quando há notificação pendente de push (push_pendentes). Volta false sem HTTP.';

revoke all on function public.dispatch_pending_push() from public, anon, authenticated;
grant execute on function public.dispatch_pending_push() to service_role;

-- Por COMANDO, não por linha: `meta_notificar` e o aviso de cron gravam várias
-- linhas num insert só, e cada uma acordaria a edge.
--
-- O push é carona do aviso. Qualquer falha aqui vira `warning` e o INSERT segue:
-- a atribuição de lead que gravou a notificação não pode ser desfeita porque o
-- pg_net, o cofre ou a edge estão fora do ar.
create or replace function public.notifications_push_kick()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from novas nv
     where nv.channel = 'in_app'
       and public.push_destino(nv.profile_id, nv.kind)
  ) then
    perform public.push_kick();
  end if;
  return null;
exception when others then
  raise warning 'notifications_push_kick: push não acionado (%)', sqlerrm;
  return null;
end;
$$;

revoke all on function public.notifications_push_kick() from public, anon, authenticated;

drop trigger if exists notifications_push_kick on public.notifications;
create trigger notifications_push_kick
  after insert on public.notifications
  referencing new table as novas
  for each statement execute function public.notifications_push_kick();

-- -----------------------------------------------------------------------------
-- 6. RPCs do aparelho
-- -----------------------------------------------------------------------------
create or replace function public.get_push_public_key()
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  -- A chave pública não é segredo, mas só existe para quem está logado ativar.
  select ic.secret
    from private.integration_credentials ic
   where ic.provider = 'webpush' and ic.label = 'vapid_public_key' and ic.active;
$$;

revoke all on function public.get_push_public_key() from public, anon;
grant execute on function public.get_push_public_key() to authenticated, service_role;

create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_host text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Entre no sistema para ativar as notificações.' using errcode = '42501';
  end if;

  -- Endpoint é para onde o NOSSO servidor faz POST. Só https, só host de serviço
  -- de push conhecido, sem porta, sem usuário@, sem espaço nem caractere de
  -- controle: host livre transformaria a edge em cliente HTTP de quem quiser.
  if p_endpoint is null or length(p_endpoint) > 2048 then
    raise exception 'Endpoint de push inválido.' using errcode = '22023';
  end if;
  v_host := lower(substring(p_endpoint from '^https://([A-Za-z0-9.-]+)(?:/[!-~]*)?$'));
  if v_host is null or not (
       v_host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com')
       or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$'
       or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$'
     ) then
    raise exception 'Serviço de push não reconhecido.' using errcode = '22023';
  end if;

  -- base64url sem padding: 65 bytes do ponto P-256 não comprimido (0x04 → 'B')
  -- e 16 bytes do segredo de autenticação.
  if p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$' then
    raise exception 'Chave do aparelho (p256dh) inválida.' using errcode = '22023';
  end if;
  if p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'Segredo do aparelho (auth) inválido.' using errcode = '22023';
  end if;

  -- Upsert por endpoint: o mesmo navegador que troca de conta passa a receber
  -- os avisos de quem entrou, e não os de quem saiu.
  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_user_agent), ''), 300))
  on conflict (endpoint) do update
     set profile_id = excluded.profile_id,
         p256dh     = excluded.p256dh,
         auth       = excluded.auth,
         user_agent = excluded.user_agent,
         failures   = 0
  returning s.id into v_id;

  -- Teto de 10 aparelhos por pessoa: cada aviso sai para todos, e sem teto um
  -- script registrando endpoints falsos multiplicaria as chamadas da edge.
  delete from public.push_subscriptions d
   where d.profile_id = v_uid
     and d.id <> v_id
     and d.id not in (
       select k.id
         from public.push_subscriptions k
        where k.profile_id = v_uid and k.id <> v_id
        order by coalesce(k.last_success_at, k.created_at) desc
        limit 9
     );

  return v_id;
end;
$$;

comment on function public.register_push_subscription(text, text, text, text) is
  'Ativa push no aparelho de quem está logado. Valida https + serviço de push conhecido + tamanhos base64url; upsert por endpoint (o aparelho passa a ser de quem registrou por último); no máximo 10 aparelhos por pessoa.';

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Chamado ANTES do logout: aparelho compartilhado não pode seguir recebendo lead
-- de quem saiu. Roda com os privilégios de quem chama — a RLS já recorta.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint
     and profile_id = auth.uid();
$$;

revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- O intervalo do teste mora onde o usuário não escreve. Contar a própria linha
-- `push_test` do sino não segurava: o dono apaga a notificação
-- (`notifications_delete`) e testa de novo, e cada volta é um http_post, uma
-- execução da edge e um POST ao serviço de push com a nossa chave VAPID.
create table if not exists private.push_test_throttle (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_at    timestamptz not null
);

alter table private.push_test_throttle enable row level security;
revoke all on private.push_test_throttle from public, anon, authenticated;

create or replace function public.send_test_push()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Entre no sistema para testar as notificações.' using errcode = '42501';
  end if;

  -- Um comando só: a trava da linha serializa dois cliques simultâneos, e o
  -- `where` do conflito recusa o segundo dentro de 30 s (nenhuma linha afetada).
  insert into private.push_test_throttle as t (profile_id, last_at)
  values (v_uid, now())
  on conflict (profile_id) do update
     set last_at = excluded.last_at
   where t.last_at <= now() - interval '30 seconds';
  if not found then
    raise exception 'Aguarde 30 segundos para testar de novo.' using errcode = 'P0001';
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values (v_uid, 'push_test', 'Notificações ativadas',
          'É assim que os avisos de lead chegam neste aparelho.', '/leads', 'in_app')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.send_test_push() is
  'Grava o aviso push_test para quem está logado (sai por push ignorando preferências). No máximo 1 a cada 30 s por pessoa.';

revoke all on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;

-- -----------------------------------------------------------------------------
-- 7. WhatsApp do lead avisa o dono do lead
--
-- Até a 0120 o corretor só era avisado em `human_turn`/`audio_falhou` sem dono
-- de conversa, e no máximo uma vez a cada 6 h por telefone — um lead que volta a
-- escrever 20 min depois não chegava ao celular de quem atende.
--
-- Agora, em TODO desfecho ligado a um lead com dono (inclusive `sdr_turn` e
-- `agent_error`): um aviso por lead a cada 10 min. Sem ruído:
--   · lead perdido ou descartado não avisa (a carga do Bubble tem dono antigo
--     em lead encerrado, e remarketing para ele não é atendimento de ninguém);
--   · se o próprio corretor assumiu a conversa, ele já recebe o aviso de dono
--     da conversa — não recebe o segundo;
--   · a reserva do áudio (`sdr_turn` com detail "áudio em processamento", ver
--     whatsapp-inbound-webhook/parse.ts) ainda não é desfecho e não avisa.
--     ponytail: o áudio transcrito que o robô responde fecha a reserva no mesmo
--     `sdr_turn`, e o gatilho de UPDATE só olha mudança de desfecho — esse caso
--     não avisa o corretor; tratar se o SDR por áudio com lead já atribuído virar
--     rotina.
-- O resto é a 0120 sem mudança (SDR, admin e sócio; dono da conversa em 30 min).
-- -----------------------------------------------------------------------------
create or replace function public.notify_whatsapp_unmatched()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dono     uuid;
  v_lead     uuid;
  v_nome     text;
  v_corretor uuid;
  v_status   public.lead_status;
  v_fato     text;
begin
  if new.outcome not in ('unmatched', 'agent_error', 'human_turn', 'audio_falhou', 'sdr_turn') then
    return null;
  end if;

  if new.outcome = 'sdr_turn' and coalesce(new.detail, '') like 'áudio em processamento%' then
    return null;
  end if;

  if new.outcome in ('unmatched', 'agent_error') then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    -- `distinct on (p.id)`: quem é sdr E admin casaria duas vezes (0083).
    select distinct on (p.id)
           p.id,
           'whatsapp_unmatched',
           'Mensagem de WhatsApp sem destino',
           case
             when new.outcome = 'unmatched' then format(
               '%s escreveu para o número da empresa e a mensagem não casou com nenhum lead nem lista de remarketing. '
               'Ela aparece na aba Conversas do SDR, em "Sem lead". Responda pelo aparelho: o CRM não responde a número sem lead.',
               new.from_phone)
             when new.conversation_id is not null and new.media_type is not null then format(
               '%s mandou uma mídia que o robô não lê ou não respondeu; ela está na conversa. '
               'Assuma a conversa na aba Conversas do SDR.',
               new.from_phone)
             when new.conversation_id is not null then format(
               '%s escreveu numa conversa do SDR e o agente de IA falhou ao responder; a mensagem não entrou no histórico. '
               'Assuma a conversa na aba Conversas do SDR para retomar o atendimento.',
               new.from_phone)
             else format(
               '%s escreveu para o número da empresa e o sistema falhou ao abrir o atendimento. '
               'A mensagem aparece na aba Conversas do SDR, em "Sem lead". Responda pelo aparelho.',
               new.from_phone)
           end,
           case when new.conversation_id is not null then '/sdr?aba=conversas' end,
           'in_app'::public.notification_channel
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id and p.status = 'active'
     where ur.role in ('sdr', 'admin', 'partner')
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = p.id
            and n.kind = 'whatsapp_unmatched'
            and n.body like new.from_phone || '%'
            and n.created_at > now() - interval '6 hours'
       );
  end if;

  if new.conversation_id is not null then
    select c.lead_id, po.id
      into v_lead, v_dono
      from public.sdr_conversations c
      left join public.profiles po on po.id = c.assumed_by and po.status = 'active'
     where c.id = new.conversation_id;
  end if;
  v_lead := coalesce(v_lead, new.lead_id);

  select l.full_name, l.assigned_to, l.status
    into v_nome, v_corretor, v_status
    from public.leads l
   where l.id = v_lead;

  if new.outcome in ('human_turn', 'audio_falhou') and v_lead is not null then
    v_fato := format('%s · %s %s', new.from_phone, coalesce(v_nome, 'lead sem nome'),
      case when new.outcome = 'audio_falhou'
           then 'mandou um áudio que não deu para transcrever, e o robô não respondeu.'
           else 'escreveu numa conversa que o robô não atende mais.'
      end);

    if v_dono is not null then
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select v_dono,
             'whatsapp_human_turn',
             'Mensagem na conversa que você assumiu',
             v_fato || ' Responda pela aba Conversas do SDR.',
             '/sdr?aba=conversas',
             'in_app'::public.notification_channel
       where not exists (
         select 1 from public.notifications n
          where n.profile_id = v_dono
            and n.kind = 'whatsapp_human_turn'
            and n.body like new.from_phone || '%'
            and n.created_at > now() - interval '30 minutes'
       );
    else
      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct on (p.id)
             p.id,
             'whatsapp_human_turn',
             'Mensagem de lead sem responsável',
             v_fato || ' Ninguém assumiu a conversa: assuma na aba Conversas do SDR para responder.',
             '/sdr?aba=conversas',
             'in_app'::public.notification_channel
        from public.user_roles ur
        join public.profiles p on p.id = ur.profile_id and p.status = 'active'
       where ur.role in ('sdr', 'admin', 'partner')
         and not exists (
           select 1 from public.notifications n
            where n.profile_id = p.id
              and n.kind = 'whatsapp_human_turn'
              and n.body like new.from_phone || '%'
              and n.created_at > now() - interval '6 hours'
         );
    end if;
  end if;

  if v_corretor is not null
     and v_corretor is distinct from v_dono
     and v_status not in ('lost', 'discarded') then
    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select p.id,
           'whatsapp_human_turn',
           'Seu lead escreveu no WhatsApp da empresa',
           format('%s · %s %s',
                  new.from_phone,
                  coalesce(v_nome, 'lead sem nome'),
                  case new.outcome
                    when 'audio_falhou' then 'mandou um áudio que não deu para transcrever, e o robô não respondeu. O lead está com você: retome o contato.'
                    when 'human_turn'   then 'escreveu numa conversa que o robô não atende mais. O lead está com você: retome o contato.'
                    when 'agent_error'  then 'escreveu e o robô de SDR falhou ao responder. O lead está com você: retome o contato.'
                    else 'escreveu e o robô de SDR está respondendo. O lead está com você.'
                  end),
           '/leads?lead=' || v_lead::text,
           'in_app'::public.notification_channel
      from public.profiles p
     where p.id = v_corretor
       and p.status = 'active'
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = p.id
            and n.kind = 'whatsapp_human_turn'
            and n.link = '/leads?lead=' || v_lead::text
            and n.created_at > now() - interval '10 minutes'
       );
  end if;

  return null;
end;
$$;

revoke all on function public.notify_whatsapp_unmatched() from public, anon, authenticated;

comment on function public.notify_whatsapp_unmatched is
  'Avisa no sino quem precisa agir sobre uma mensagem recebida. unmatched/agent_error: SDR, admin e sócio, 1 por telefone a cada 6 h. human_turn/audio_falhou: dono da conversa (30 min) ou, sem dono, SDR, admin e sócio (6 h). Em todo desfecho com lead de dono ativo e não encerrado: o corretor do lead, 1 por lead a cada 10 min (0143).';

-- -----------------------------------------------------------------------------
-- 8. Atividade de lead feita por OUTRA pessoa avisa o dono
--
-- Regras comuns aos quatro produtores:
--   · quem fez a ação não é avisado (`auth.uid()`);
--   · sem sessão não avisa: é sistema ou importação — a carga do Bubble entrou
--     pela service role, e reimportar histórico não pode virar milhares de
--     avisos e pushes;
--   · um aviso por pessoa por fato (`distinct`), e só para perfil ativo;
--   · atividade e visita só usam o lead que quem agiu ENXERGA, e o nome do
--     cliente só vai para o dono do lead. `tasks_write` aceita qualquer
--     `created_by = auth.uid()` e `visits_write` qualquer `broker_id` próprio:
--     sem o recorte, apontar para um lead alheio mandava o nome do cliente a quem
--     não o vê e avisava o dono em nome de quem nem sabe do lead.
--     `can_see_lead` não serve: é invoker e, dentro destes definer, enxerga tudo.
--     `auth_visible_profiles()` é a regra de hierarquia da `leads_select` e lê
--     `auth.uid()`;
--   · o link leva ao lead (`/leads?lead=`), que todo papel que atende lead abre;
--     sem lead, a tela do negócio (`/pipeline`) ou de atividades.
--
-- Transferência manual NÃO está aqui: `reassign_lead` insere em
-- `lead_assignments`, e `notify_lead_assigned` já avisa quem recebeu.
-- -----------------------------------------------------------------------------
create or replace function public.notify_lead_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select l.assigned_to,
         'lead_comment',
         'Comentário no seu lead: ' || coalesce(l.full_name, 'sem nome'),
         format('%s comentou: %s',
                coalesce(autor.full_name, 'Alguém'),
                case when length(new.body) > 200 then left(new.body, 199) || '…' else new.body end),
         '/leads?lead=' || l.id::text,
         'in_app'
    from public.leads l
    join public.profiles dono on dono.id = l.assigned_to and dono.status = 'active'
    left join public.profiles autor on autor.id = auth.uid()
   where l.id = new.lead_id
     and l.assigned_to <> auth.uid();

  return null;
end;
$$;

revoke all on function public.notify_lead_comment() from public, anon, authenticated;

drop trigger if exists notify_lead_comment on public.lead_comments;
create trigger notify_lead_comment
  after insert on public.lead_comments
  for each row execute function public.notify_lead_comment();

create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_lead      public.leads;
begin
  if v_ator is null or new.status <> 'open' then
    return null;
  end if;

  if new.ref_type = 'lead' then
    select l.* into v_lead from public.leads l
     where l.id = new.ref_id
       and l.assigned_to in (select public.auth_visible_profiles());
  end if;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  -- Quem vai fazer a atividade e, se ela é de um lead, o dono do lead.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'task_assigned',
         case when dest.profile_id = new.assigned_to
              then 'Nova atividade para você: '
              else 'Atividade no seu lead: '
         end || left(new.title, 150),
         format('%s criou%s, %s.',
                coalesce(v_ator_nome, 'Alguém'),
                case when dest.profile_id = v_lead.assigned_to
                     then ' no lead ' || coalesce(v_lead.full_name, 'sem nome') else '' end,
                case when new.due_at is not null
                     then 'com prazo ' || to_char(new.due_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
                     else 'sem prazo'
                end),
         case when v_lead.id is not null then '/leads?lead=' || v_lead.id::text
              when new.ref_type in ('deal', 'cca_case') then '/pipeline'
              else '/atividades'
         end,
         'in_app'
    from (select distinct unnest(array[new.assigned_to, v_lead.assigned_to]) as profile_id) dest
    join public.profiles p on p.id = dest.profile_id and p.status = 'active'
   where dest.profile_id <> v_ator;

  return null;
end;
$$;

revoke all on function public.notify_task_assigned() from public, anon, authenticated;

drop trigger if exists notify_task_assigned on public.tasks;
create trigger notify_task_assigned
  after insert on public.tasks
  for each row execute function public.notify_task_assigned();

create or replace function public.notify_visit_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_lead      public.leads;
begin
  -- Visita registrada já realizada é histórico, não agenda.
  if v_ator is null or new.result <> 'scheduled' then
    return null;
  end if;

  if new.lead_id is not null then
    select l.* into v_lead from public.leads l
     where l.id = new.lead_id
       and l.assigned_to in (select public.auth_visible_profiles());
  end if;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dest.profile_id,
         'visit_scheduled',
         case when dest.profile_id = new.broker_id
              then 'Visita agendada para você'
              else 'Visita no seu lead'
         end || case when dest.profile_id = v_lead.assigned_to
                     then ': ' || coalesce(v_lead.full_name, 'sem nome') else '' end,
         format('%s agendou para %s.',
                coalesce(v_ator_nome, 'Alguém'),
                to_char(new.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')),
         case when v_lead.id is not null then '/leads?lead=' || v_lead.id::text else '/pipeline' end,
         'in_app'
    from (select distinct unnest(array[new.broker_id, v_lead.assigned_to]) as profile_id) dest
    join public.profiles p on p.id = dest.profile_id and p.status = 'active'
   where dest.profile_id <> v_ator;

  return null;
end;
$$;

revoke all on function public.notify_visit_scheduled() from public, anon, authenticated;

drop trigger if exists notify_visit_scheduled on public.visits;
create trigger notify_visit_scheduled
  after insert on public.visits
  for each row execute function public.notify_visit_scheduled();

-- Crédito do negócio mudou de status: avisa os corretores do negócio.
--
-- A DEVOLUÇÃO já avisa: `cca_cases_sync_esteira_label` grava
-- "CCA devolveu o dossiê: <código>" quando o caso volta para
-- 'pending_documents' com a conferência aprovada. Gatilhos AFTER da mesma linha
-- disparam em ordem alfabética de nome, e `cca_cases_sync_esteira_label` vem
-- antes de `notify_cca_status_changed`: a linha dele já existe aqui, na mesma
-- transação (`created_at = now()`), e o segundo aviso do mesmo fato não sai.
create or replace function public.notify_cca_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_code      text;
  -- Mesmos rótulos de src/components/pipeline/ccaStage.ts.
  v_rotulo    constant jsonb := '{
    "pending_documents": "Aguardando documentos",
    "under_review": "Em análise",
    "sent_to_developer": "Enviado à construtora",
    "sent_to_agency": "Enviado à agência",
    "approved": "Aprovado",
    "rejected": "Reprovado",
    "cancelled": "Cancelado"
  }';
begin
  if v_ator is null then
    return null;
  end if;

  select d.code into v_code from public.deals d where d.id = new.deal_id;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'cca_status_changed',
         format('Crédito %s: %s',
                coalesce(v_code, 'negócio sem código'),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         format('%s moveu a análise de crédito de "%s" para "%s".',
                coalesce(v_ator_nome, 'Alguém'),
                coalesce(v_rotulo ->> old.status::text, old.status::text),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         '/pipeline',
         'in_app'
    from (
      select distinct dp0.profile_id
        from public.deal_participants dp0
       where dp0.deal_id = new.deal_id and dp0.role = 'broker'
    ) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> v_ator
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = dp.profile_id
          and n.kind = 'document_review_returned'
          and n.title = 'CCA devolveu o dossiê: ' || v_code
          and n.created_at >= now()
     );

  return null;
end;
$$;

revoke all on function public.notify_cca_status_changed() from public, anon, authenticated;

drop trigger if exists notify_cca_status_changed on public.cca_cases;
create trigger notify_cca_status_changed
  after update of status on public.cca_cases
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_cca_status_changed();

comment on function public.notify_lead_comment() is
  'Comentário de outra pessoa no lead avisa o dono do lead (kind lead_comment). Sem sessão (sistema/importação) não avisa.';
comment on function public.notify_task_assigned() is
  'Atividade criada por outra pessoa avisa o responsável e, se for de lead, o dono do lead (kind task_assigned). Sem sessão não avisa.';
comment on function public.notify_visit_scheduled() is
  'Visita agendada por outra pessoa avisa o corretor da visita e o dono do lead (kind visit_scheduled). Sem sessão não avisa.';
comment on function public.notify_cca_status_changed() is
  'Mudança de status do caso de crédito avisa os corretores do negócio (kind cca_status_changed), exceto quem mudou e exceto a devolução que cca_cases_sync_esteira_label já avisou.';

-- -----------------------------------------------------------------------------
-- 9. Agendamento (padrão da 0083/0118: falha de agendamento vira aviso)
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0143] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;

  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-push-dispatch') then
      perform cron.unschedule('faceimob-push-dispatch');
    end if;
    perform cron.schedule(
      'faceimob-push-dispatch',
      '* * * * *',
      $cmd$select public.dispatch_pending_push();$cmd$
    );
    raise notice '[0143] nova tentativa de push agendada de minuto em minuto.';
  exception when others then
    raise warning '[0143] não foi possível agendar o push: %', sqlerrm;
  end;
end
$do$;
