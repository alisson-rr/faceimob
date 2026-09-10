-- =============================================================================
-- 0065 — Notificações, filas e crons: destravar o que estava parado em silêncio
--
-- Seis defeitos, todos da mesma família: o caminho existe, ninguém percorre, e
-- nada na tela nem no banco diz isso.
--
--  1. FILA HISTÓRICA DE WHATSAPP — 77 mensagens com `sent_at is null` e
--     `attempts = 0` desde 30/07: o cron nunca rodou e o worker nunca tentou.
--     Ligar o job hoje mandaria aviso de lead de julho para corretor real em
--     setembro. São descartadas com o motivo escrito na linha.
--
--  2. `dispatch_pending_notifications` disparava o worker com a fila VAZIA, uma
--     requisição por minuto sem nada para entregar. Agora só chama quando há
--     mensagem esperando. Quem decide sobre credencial é o worker, não o
--     gatilho: `getSecret` lê o cofre E o secret da edge function, e o banco só
--     enxerga o cofre — um portão aqui recusaria o token cadastrado pelo
--     caminho normal de deploy do Supabase e a fila ficaria parada com um
--     `raise warning` que ninguém lê. O `notify-dispatch` responde 503 sem
--     gastar tentativa e escreve o motivo em `notifications.last_error`.
--
--  3. `dispatch_pending_submissions` só olhava `status='queued'`, mas a
--     `submission-dispatch` também processa `failed` — e nada, em lugar nenhum,
--     tirava um dossiê de `sending`. Dossiê que falhou ou que morreu no meio do
--     envio ficava parado até alguém apertar Reenviar.
--
--  4. O AVISO DE PRAZO — E O SINO QUE MOSTRAVA A FILA DE SAÍDA.
--     `notify_lead_timeout` gravava SÓ no canal `whatsapp` e com `link` nulo: o
--     aviso de "perdi o lead por prazo" (ata 14/07, item 10) chegava ao sino
--     por acidente — porque o sino lê todos os canais — sem dizer QUAL lead e
--     sem destino. Passa a gravar as DUAS linhas: a `in_app`, que o sino
--     mostra, e a `whatsapp`, que o `notify-dispatch` entrega quando a
--     credencial da Cloud API chegar. Sem a segunda, o requisito literal da ata
--     (avisar o corretor POR WHATSAPP) ficaria sem produtor nenhum no sistema.
--
--     A duplicação que isso causaria é fechada no ponto certo, e não removendo
--     o canal: `notifications` é caixa de entrada (`in_app`) e fila de saída
--     (`whatsapp`, `email`) na mesma tabela, e a policy de SELECT separava só
--     por dono — hoje, no remoto, 63 cópias `whatsapp` de `lead_assigned` para
--     65 `in_app`, com o badge contando o dobro. A policy passa a expor só
--     `in_app` (passo 4c); a fila de saída é do worker, que lê com service role
--     e não passa por RLS.
--
--  5. `perform_checkin` aceitava QUALQUER perfil ativo. `cca`, `sdr` e
--     `marketing` não têm `menu.checkin` e mesmo assim batiam ponto pela edge
--     function — o sistema respondia "sim" por omissão e entrava gente na
--     roleta que não recebe lead.
--
--  6. `perform_checkout` fechava TODOS os check-ins abertos do dia: quem bateu
--     ponto de manhã e à tarde perdia os dois de uma vez.
--
-- Idempotente: `create or replace`, updates com recorte fechado e agendamento
-- verificado antes de mexer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Descarte da fila histórica de WhatsApp
--
-- 24 h é o limite: aviso de lead cai em minutos ou não serve mais. Marcar
-- `sent_at` é o que tira da fila (o worker lê `sent_at is null`); `last_error`
-- conta por que não saiu, para o descarte não virar "sumiu".
--
-- `read_at` também: até o passo 4c o sino lia TODOS os canais e contava
-- `read_at is null` no badge — sem esta coluna, as 77 mensagens de julho
-- continuariam na caixa dos corretores como aviso pendente. Com a policy
-- corrigida a marcação vira redundante para o badge, e continua aqui porque é
-- barata e porque descarte que deixa rastro em uma coluna só é descarte pela
-- metade.
-- -----------------------------------------------------------------------------
update public.notifications
   set sent_at    = now(),
       read_at    = coalesce(read_at, now()),
       last_error = 'fila antiga descartada (0065): mensagem represada por falta de credencial da Cloud API'
 where channel = 'whatsapp'
   and sent_at is null
   and created_at < now() - interval '24 hours';

-- -----------------------------------------------------------------------------
-- 2. Gatilho da fila de notificações: não chamar o worker com a fila vazia
--
-- Aqui NÃO se checa a credencial da Cloud API. O worker lê o segredo por
-- `getSecret`, que aceita duas origens — o cofre (`private.integration_
-- credentials`) e o secret da edge function (`Deno.env`) —, e o banco só
-- enxerga a primeira. Um portão neste ponto recusaria o token cadastrado pelo
-- caminho normal de deploy do Supabase e deixaria a fila parada avisando só por
-- `raise warning`, que não faz o job falhar e por isso não aparece em
-- `cron_jobs_health()`: a aba Saúde dos jobs ficaria verde com a fila travada.
-- Uma requisição por minuto a uma function que devolve 503 cedo é barata, e o
-- 503 escreve o motivo em `notifications.last_error`.
-- -----------------------------------------------------------------------------
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
  'Gatilho da edge function notify-dispatch. Só dispara com fila não vazia. Quem decide sobre a credencial da Cloud API é o worker (getSecret lê cofre E secret da function; o banco só vê o cofre) — ele devolve 503 sem gastar tentativa e grava o motivo em notifications.last_error.';

-- -----------------------------------------------------------------------------
-- 3. Gatilho da fila de dossiês: repescar o que falhou e o que travou
--
-- O recorte é o MESMO da consulta da `submission-dispatch` (10 min de repesca,
-- teto de 5 tentativas). Mudou um, muda o outro — divergir aqui produz job que
-- dispara e worker que não acha nada, ou o contrário.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_pending_submissions()
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

  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_submissions: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  if not exists (
    select 1 from public.developer_submissions s
     where s.attempts < 5
       and (
         s.status = 'queued'
         or (s.status in ('failed', 'sending')
             and s.updated_at < now() - interval '10 minutes')
       )
  ) then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/submission-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.dispatch_pending_submissions() from public, anon, authenticated;

comment on function public.dispatch_pending_submissions() is
  'Gatilho da edge function submission-dispatch. Dispara para queued e repesca failed/sending parados há mais de 10 min — antes, dossiê que falhou esperava alguém apertar Reenviar.';

-- -----------------------------------------------------------------------------
-- 4. Aviso de lead perdido por prazo chega ao sino, com nome e destino
-- -----------------------------------------------------------------------------
create or replace function public.notify_lead_timeout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notify boolean;
  v_nome   text;
  v_link   text;
  v_titulo text;
  v_corpo  text := 'Você não iniciou o atendimento no prazo e o lead voltou para a roleta.';
begin
  if new.release_reason is distinct from 'timeout' then
    return null;
  end if;

  select notify_on_timeout into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select coalesce(l.full_name, 'sem nome') into v_nome
    from public.leads l where l.id = new.lead_id;

  -- Mesma rota que `notify_lead_assigned` usa desde a 0032: `/leads/<id>` não
  -- existe e caía no 404. Sem link nenhum — o estado até aqui — o corretor lia
  -- "perdi um lead" sem saber qual.
  v_link := '/leads?lead=' || new.lead_id::text;

  v_titulo := 'Lead devolvido à fila: ' || v_nome;

  -- DUAS linhas, uma por canal, como na 0011 — e agora as duas com nome do lead
  -- e destino. A `in_app` é o que o sino mostra; a `whatsapp` é o que o
  -- `notify-dispatch` entrega. Gravar só a primeira deixaria o item 10 da ata
  -- de 14/07 (avisar o corretor POR WHATSAPP que perdeu o lead por prazo) sem
  -- produtor nenhum: o único texto a sair pelo canal seria o de lead atribuído.
  -- Duas linhas não duplicam mais a caixa do corretor — a policy do passo 4c
  -- expõe só `in_app` ao cliente.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, v_link, 'in_app'),
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, v_link, 'whatsapp');

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4b. O CCA passa a ter conteúdo no sino
--
-- Os cinco produtores de notificação alcançam corretor e gerente. Para `cca`,
-- `sdr`, `marketing` e `partner` o sino nunca teria uma linha — e o kind
-- `cca_pending` existia só em dado de seed, sem produtor nenhum no código.
--
-- O evento do CCA é a chegada do dossiê: `review_deal_documents` (0028) cria a
-- `cca_cases` quando o gerente aprova a conferência documental. É o momento em
-- que o trabalho do analista começa e o único que ele não tem como adivinhar.
--
-- Um aviso por analista ativo: a esteira não tem dono definido na chegada
-- (`analyst_id` é preenchido depois), então quem pegar primeiro pega.
-- -----------------------------------------------------------------------------
create or replace function public.notify_cca_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select p.id,
         'cca_pending',
         'Dossiê novo na esteira de crédito',
         format('O negócio %s entrou na análise.', coalesce(d.code, 'sem código')),
         '/cca',
         'in_app'
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
    left join public.deals d on d.id = new.deal_id
   where ur.role = 'cca';

  return null;
end;
$$;

-- O grant default do Supabase dá EXECUTE a `anon` em toda função nova de
-- `public` — inclusive em função de gatilho, que ninguém deveria chamar à mão.
-- É o tripwire do 06_anon_surface.sql.
revoke all on function public.notify_cca_case_created() from public, anon, authenticated;

drop trigger if exists notify_cca_case_created on public.cca_cases;
create trigger notify_cca_case_created
  after insert on public.cca_cases
  for each row execute function public.notify_cca_case_created();

comment on function public.notify_cca_case_created is
  'Avisa os analistas de crédito quando um dossiê entra na esteira. Produtor do kind cca_pending, que até a 0065 só existia em dado de seed.';

-- -----------------------------------------------------------------------------
-- 4c. O sino lê a caixa de entrada, não a fila de saída
--
-- `notifications` acumula dois papéis desde a 0011: a caixa do usuário
-- (`channel = 'in_app'`) e a fila de entrega para fora (`whatsapp`, `email`,
-- consumida por `notify-dispatch`). A policy de SELECT separava só por dono, e
-- por isso TODA mensagem de saída aparecia como um segundo aviso idêntico no
-- sino — no remoto, 63 cópias `whatsapp` de `lead_assigned` para 65 `in_app`,
-- com o badge contando as duas.
--
-- A separação fica aqui, e não na consulta do sino (`listMyNotifications`, em
-- src/integrations/supabase/notifications.ts), porque este é o ponto por onde
-- TODO cliente passa: qualquer tela que leia a tabela pelo PostgREST herda o
-- recorte e nenhuma precisa lembrar do filtro. Corrigir só a consulta deixaria
-- a próxima tela repetir o defeito.
--
-- Quem entrega a fila de saída é o worker, com service role — RLS não se aplica
-- a ele, e nada muda no envio. Uma futura tela de "N mensagens paradas" precisa
-- de RPC de qualquer forma: ela agrega TODOS os perfis, e esta policy nunca
-- deixou ninguém ler notificação alheia.
--
-- Consequência: linha de canal `email` ou `whatsapp` deixa de aparecer no sino.
-- Hoje isso só alcança dado de seed (`daily_submitted`, canal `email`, sem
-- produtor no código) — aviso que precisa ser visto na tela nasce `in_app`, que
-- é o default da coluna.
-- -----------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (profile_id = auth.uid() and channel = 'in_app');

-- -----------------------------------------------------------------------------
-- 5. Check-in exige a permissão que o menu já exige
--
-- A checagem fica em `perform_checkin`, não em `checkin_eligibility`: a
-- eligibilidade é consultada com `who` explícito em outros pontos, e
-- `has_permission` olha `auth.uid()` — misturar os dois responderia sobre a
-- pessoa errada. Aqui o sujeito é sempre quem chama.
--
-- `has_permission` já devolve verdadeiro para admin, então administrador
-- continua conseguindo bater ponto para testar a roleta.
-- -----------------------------------------------------------------------------
create or replace function public.perform_checkin(client_ip inet default null)
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who      uuid := auth.uid();
  v_shift    uuid;
  v_ok       boolean;
  v_reason   text;
  v_row      public.checkins;
begin
  if v_who is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- O menu de Check-in é concedido a director, manager, broker e partner. A
  -- RPC aceitava qualquer perfil ativo, então cca, sdr e marketing entravam na
  -- fila da roleta pela edge function apesar de a tela não existir para eles.
  if not public.has_permission('menu.checkin') then
    raise exception 'Seu perfil não faz check-in na roleta.' using errcode = '42501';
  end if;

  v_shift := public.current_shift();
  if v_shift is null then
    raise exception 'Fora da janela de check-in.' using errcode = 'P0001';
  end if;

  select e.allowed, e.reason into v_ok, v_reason
  from public.checkin_eligibility(v_who) e;

  if not v_ok then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  -- A trava de loja é por IP; sem IP identificado não há trava.
  if client_ip is null then
    raise exception 'IP não identificado — faça o check-in pelo aplicativo.'
      using errcode = 'P0001';
  end if;

  if not public.ip_is_allowed(client_ip, v_who) then
    raise exception 'IP % não autorizado para check-in.', host(client_ip)
      using errcode = 'P0001';
  end if;

  -- O dia operacional sai de `current_work_date()` (0057), nunca da data crua
  -- do servidor: o banco roda em UTC e às 21:00 em São Paulo ela já virou — o
  -- turno Noite gravaria a presença com a data de amanhã, o corretor sumiria de
  -- `distribution_queue` (que usa `current_work_date()`) e a unique
  -- (profile_id, work_date, shift_id) deixaria passar um segundo check-in do
  -- mesmo turno. O tripwire de 13_checkin_work_date.sql varre o CORPO desta
  -- função, comentário incluído: não escrever aqui o nome da função de data do
  -- servidor, nem para dizer que ela não deve ser usada.
  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (v_who, v_shift, public.current_work_date(), client_ip)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at = null,
        auto_checkout  = false,
        ip_address     = coalesce(excluded.ip_address, public.checkins.ip_address)
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Check-out fecha um turno, não o dia inteiro
--
-- O UPDATE antigo casava por `profile_id + work_date`, então quem tinha turno
-- da manhã e da tarde abertos perdia os dois — e `returning into` devolvia uma
-- das linhas ao acaso, o que fazia a tela mostrar um horário que não era o do
-- turno fechado.
--
-- Prefere o turno vigente; fora da janela de turno (o caso de quem esquece o
-- ponto aberto e fecha depois) fecha o mais recente. Um por chamada.
-- -----------------------------------------------------------------------------
create or replace function public.perform_checkout()
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.checkins;
  v_shift uuid := public.current_shift();
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- `current_work_date()` (0057) pelo mesmo motivo do check-in: com a data crua
  -- do servidor, o check-out das 21:00 procuraria a presença de amanhã e não
  -- acharia a de hoje.
  select c.id into v_id
    from public.checkins c
   where c.profile_id = auth.uid()
     and c.work_date = public.current_work_date()
     and c.checked_out_at is null
   order by (c.shift_id = v_shift) desc, c.checked_in_at desc
   limit 1;

  if v_id is null then
    raise exception 'Nenhum check-in aberto hoje.' using errcode = 'P0002';
  end if;

  update public.checkins
     set checked_out_at = now()
   where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Ligar o job da fila de WhatsApp
--
-- Pausado desde 05/08 por um motivo que já não vale: o risco era despejar a
-- fila represada. Ela foi descartada no passo 1, e enquanto não houver token o
-- worker devolve 503 sem gastar tentativa e sem enviar nada. Ativo, o caminho
-- fica pronto para o dia em que o token chegar — pela tela de Integrações ou
-- pelo secret da function — sem depender de alguém lembrar de um comando.
-- -----------------------------------------------------------------------------
do $do$
declare
  v_jobid bigint;
begin
  if to_regclass('cron.job') is null then
    raise notice '[0065] pg_cron ausente; nada a ativar (ambiente de teste).';
    return;
  end if;

  execute 'select jobid from cron.job where jobname = ''faceimob-notify-dispatch''' into v_jobid;
  if v_jobid is null then
    raise notice '[0065] job faceimob-notify-dispatch não existe; a 0018 é quem o cria.';
    return;
  end if;

  if to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is not null then
    execute format('select cron.alter_job(job_id := %s, active := true)', v_jobid);
  else
    -- Harness local: o stub de cron.job não tem alter_job.
    execute format('update cron.job set active = true where jobid = %s', v_jobid);
  end if;
  raise notice '[0065] faceimob-notify-dispatch ativo.';
end
$do$;
