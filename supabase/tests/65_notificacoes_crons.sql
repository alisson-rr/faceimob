-- =============================================================================
-- Regressão da 0065 — notificações, filas e crons
--
-- Por que este arquivo existe: o 04_cron_scheduling.sql foi criado para provar
-- que "função correta e nunca executada" não passa mais no teste — e ele mesmo
-- só afirma três jobs. `assign-queued`, `submission-dispatch` e
-- `notify-dispatch` ficaram de fora, justamente os três que dependem de uma
-- edge function do outro lado. O `notify-dispatch` passou um mês pausado com a
-- fila crescendo e nenhum teste reprovou.
--
-- O que se afirma aqui:
--   1. Os três jobs que faltavam existem, apontam para a função certa e o de
--      notificação está ATIVO.
--   2. Os gatilhos não chamam o worker à toa: fila vazia, sem requisição — e
--      fila cheia chama mesmo sem credencial no cofre, porque quem lê o segredo
--      é o worker (cofre OU secret da function). Dossiê recém-marcado `sending`
--      não é repescado, dossiê travado há 20 min é.
--   3. `notify_lead_timeout` grava as DUAS cópias — a `in_app` do sino e a
--      `whatsapp` da fila de saída —, ambas com nome do lead e destino. E o
--      sino continua mostrando UMA por evento: quem separa a caixa de entrada
--      da fila de saída é a policy de SELECT, não a consulta da tela.
--   4. `perform_checkin` recusa quem não tem `menu.checkin`.
--   5. `perform_checkout` fecha um turno, não o dia.
--   6. O contrato do `voice-ai-webhook`: a origem do lead é `lead_sources.code`
--      resolvido para `source_id`. Não existe coluna `source_code` — foi esse
--      nome errado, sem teste nenhum, que sobreviveu desde 02/08.
--
-- Não depende de seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check65(cond boolean, label text)
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

-- -----------------------------------------------------------------------------
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000650001';
  cca uuid := '00000000-0000-0000-0000-000000650002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'corretor@cron.test', '{"full_name":"Corretor Cron"}'),
    (cca, 'cca@cron.test',      '{"full_name":"CCA Cron"}')
  on conflict do nothing;

  -- `handle_new_auth_user` dá `broker` a todo mundo. Quem é só do crédito não
  -- é corretor: é esse perfil que a 0065 passa a recusar no check-in.
  delete from public.user_roles where profile_id = cca;
  insert into public.user_roles (profile_id, role) values (cca, 'cca')
  on conflict do nothing;

  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('cron65', 'Turno 0065', '00:00', '00:00', '23:59', -5)
  on conflict (code) do nothing;

  insert into public.allowed_ips (label, ip_range)
  values ('Loja 0065', '198.51.100.0/24')
  on conflict do nothing;
end
$$;

\echo '== 1. os três jobs que o 04 não cobria =='

do $$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-assign-queued';
  perform pg_temp.check65(v_schedule is not null, 'job faceimob-assign-queued está agendado');
  perform pg_temp.check65(v_command like '%assign_queued_leads%',
    'assign-queued chama assign_queued_leads()');
  perform pg_temp.check65(v_active, 'assign-queued está ativo');

  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-submission-dispatch';
  perform pg_temp.check65(v_schedule is not null, 'job faceimob-submission-dispatch está agendado');
  perform pg_temp.check65(v_command like '%dispatch_pending_submissions%',
    'submission-dispatch chama dispatch_pending_submissions()');
  perform pg_temp.check65(v_active, 'submission-dispatch está ativo');

  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-notify-dispatch';
  perform pg_temp.check65(v_schedule is not null, 'job faceimob-notify-dispatch está agendado');
  perform pg_temp.check65(v_command like '%dispatch_pending_notifications%',
    'notify-dispatch chama dispatch_pending_notifications()');
  -- Ficou pausado de 05/08 a 03/09 e nenhum teste acusou.
  perform pg_temp.check65(v_active, 'notify-dispatch está ATIVO (0065 despausou)');
end
$$;

\echo '== 2. os gatilhos só chamam o worker quando há o que fazer =='

-- O harness é postgres puro e não tem pg_net. O dublê registra a chamada em vez
-- de sair para a rede, e é isso que permite afirmar "disparou" / "não disparou".
-- Onde o pg_net for real, a seção inteira é pulada: um teste não pode fazer
-- requisição HTTP de verdade a partir do banco.
do $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    raise notice '  -- pg_net real instalado; seção 2 pulada para não fazer HTTP de verdade';
    return;
  end if;

  create schema if not exists net;
  create table if not exists net.chamadas (id bigserial primary key, url text);

  execute $fn$
    create or replace function net.http_post(
      url text,
      body jsonb default '{}'::jsonb,
      params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb,
      timeout_milliseconds integer default 5000
    ) returns bigint
    language plpgsql
    as $body$
    begin
      insert into net.chamadas (url) values (http_post.url);
      return 1;
    end;
    $body$;
  $fn$;
end
$$;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000650001';
begin
  if to_regclass('net.chamadas') is null then
    return;  -- seção pulada acima
  end if;

  -- O endpoint precisa estar configurado; é o que a 0018 exige antes de tudo.
  insert into private.integration_credentials (provider, label, secret) values
    ('supabase', 'functions_url',    'https://exemplo.invalid/functions/v1'),
    ('supabase', 'service_role_key', 'chave-de-teste')
  on conflict (provider, label) do update set secret = excluded.secret, active = true;

  -- O gatilho NÃO pode olhar a credencial da Meta: o worker lê o segredo por
  -- `getSecret`, que aceita o cofre E o secret da edge function, e o banco só
  -- enxerga o cofre. Um portão aqui deixaria a fila parada justamente no
  -- cadastro pelo caminho normal de deploy — e avisaria por `raise warning`,
  -- que não faz o job falhar e não aparece em `cron_jobs_health()`.
  delete from private.integration_credentials
   where provider = 'meta' and label in ('whatsapp_access_token', 'whatsapp_phone_number_id');

  insert into public.notifications (profile_id, kind, title, channel)
  values (cor, 'lead_assigned', 'Aviso represado', 'whatsapp');

  delete from net.chamadas;
  perform public.dispatch_pending_notifications();
  perform pg_temp.check65((select count(*) from net.chamadas) = 1,
    'fila cheia chama o worker mesmo com o cofre sem token: quem decide é o worker');
  perform pg_temp.check65(
    (select url from net.chamadas limit 1) like '%/notify-dispatch',
    'a chamada vai para /notify-dispatch');

  -- Fila vazia não gasta requisição: o job roda a cada minuto.
  update public.notifications set sent_at = now() where channel = 'whatsapp' and sent_at is null;
  delete from net.chamadas;
  perform public.dispatch_pending_notifications();
  perform pg_temp.check65((select count(*) from net.chamadas) = 0,
    'fila vazia não chama o worker');
end
$$;

do $$
declare
  v_dev  uuid;
  v_deal uuid;
  v_stg  uuid;
  v_sub  uuid;
begin
  if to_regclass('net.chamadas') is null then
    return;
  end if;

  select id into v_stg from public.pipeline_stages
   order by is_initial desc nulls last, position limit 1;
  if v_stg is null then
    raise notice '  -- pipeline sem estágio; repesca de dossiê não verificada aqui';
    return;
  end if;

  insert into public.developers (name, flow, submission_email)
  values ('Construtora 0065', 'external', 'construtora@exemplo.invalid')
  returning id into v_dev;
  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg)
  returning id into v_deal;

  -- Dossiê que FALHOU e acabou de ser marcado: ainda não é hora de repescar.
  insert into public.developer_submissions
    (deal_id, developer_id, to_email, subject, document_ids, status, attempts)
  values (v_deal, v_dev, 'construtora@exemplo.invalid', 'Dossiê', '{}', 'failed', 1)
  returning id into v_sub;

  delete from net.chamadas;
  perform public.dispatch_pending_submissions();
  perform pg_temp.check65((select count(*) from net.chamadas) = 0,
    'dossiê que falhou agora não é repescado no mesmo minuto');

  -- Vinte minutos parado: a tentativa que o marcou já não existe.
  -- O gatilho `set_updated_at` reescreve a coluna em todo UPDATE — é o que faz
  -- a repesca funcionar em produção e o que impede envelhecer a linha aqui.
  alter table public.developer_submissions disable trigger developer_submissions_set_updated_at;
  update public.developer_submissions set updated_at = now() - interval '20 minutes'
   where id = v_sub;
  alter table public.developer_submissions enable trigger developer_submissions_set_updated_at;
  delete from net.chamadas;
  perform public.dispatch_pending_submissions();
  perform pg_temp.check65((select count(*) from net.chamadas) = 1,
    'dossiê parado em failed há 20 min volta para a fila');

  -- Preso em `sending`: nenhuma função, cron ou tela tirava daqui antes.
  alter table public.developer_submissions disable trigger developer_submissions_set_updated_at;
  update public.developer_submissions
     set status = 'sending', updated_at = now() - interval '20 minutes'
   where id = v_sub;
  alter table public.developer_submissions enable trigger developer_submissions_set_updated_at;
  delete from net.chamadas;
  perform public.dispatch_pending_submissions();
  perform pg_temp.check65((select count(*) from net.chamadas) = 1,
    'dossiê preso em sending há 20 min volta para a fila');

  -- Estourou o teto: para de tentar para sempre. `updated_at` fica velho de
  -- propósito — o único motivo de não repescar tem de ser o contador.
  alter table public.developer_submissions disable trigger developer_submissions_set_updated_at;
  update public.developer_submissions
     set attempts = 5, updated_at = now() - interval '20 minutes'
   where id = v_sub;
  alter table public.developer_submissions enable trigger developer_submissions_set_updated_at;
  delete from net.chamadas;
  perform public.dispatch_pending_submissions();
  perform pg_temp.check65((select count(*) from net.chamadas) = 0,
    'dossiê com 5 tentativas não é repescado');

  update public.developer_submissions set status = 'sent', sent_at = now() where id = v_sub;
end
$$;

\echo '== 3. lead perdido por prazo: sino com nome e destino, WhatsApp com produtor =='

do $$
declare
  cor       uuid := '00000000-0000-0000-0000-000000650001';
  v_lead    uuid;
  v_asg     uuid;
  v_link    text;
  v_no_sino bigint;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Marta do Prazo', '11955550065', 'assigned', cor)
  returning id into v_lead;

  v_link := '/leads?lead=' || v_lead::text;

  insert into public.lead_assignments (lead_id, profile_id, deadline)
  values (v_lead, cor, now() - interval '1 minute')
  returning id into v_asg;

  -- O produtor mais frequente do sistema grava duas linhas desde a 0011/0032 —
  -- é ele que enchia o sino de aviso repetido. O par continua: o que muda é
  -- quem o cliente enxerga.
  perform pg_temp.check65(
    (select count(*) from public.notifications
      where profile_id = cor and kind = 'lead_assigned' and link = v_link) = 2,
    'lead atribuído grava duas linhas: a do sino e a da fila de saída');

  update public.lead_assignments
     set released_at = now(), release_reason = 'timeout'
   where id = v_asg;

  perform pg_temp.check65(
    exists (select 1 from public.notifications
             where profile_id = cor and kind = 'lead_lost_timeout'
               and channel = 'in_app'
               and link = v_link
               and title like '%Marta do Prazo%'),
    'aviso in_app existe, diz qual lead e leva até ele');

  -- Sem esta linha o item 10 da ata de 14/07 (avisar POR WHATSAPP quem perdeu
  -- o lead por prazo) fica sem produtor nenhum: o único texto a sair pelo canal
  -- seria o de lead atribuído. `sent_at is null` é o que a fila do
  -- `notify-dispatch` lê.
  perform pg_temp.check65(
    exists (select 1 from public.notifications
             where profile_id = cor and kind = 'lead_lost_timeout'
               and channel = 'whatsapp' and sent_at is null
               and link = v_link
               and title like '%Marta do Prazo%'),
    'a cópia de WhatsApp entra na fila do notify-dispatch');

  perform pg_temp.check65(
    (select count(*) from public.notifications
      where profile_id = cor and kind = 'lead_lost_timeout') = 2,
    'duas linhas por lead devolvido: uma por canal, nem mais nem menos');

  perform pg_temp.check65(
    not exists (select 1 from public.notifications
                 where kind = 'lead_lost_timeout' and link is null),
    'nenhum aviso de prazo fica sem destino (era o estado até a 0065)');

  -- O sino é caixa de entrada; a fila de saída não pode aparecer nele. Quem
  -- separa é a policy de SELECT (passo 4c da 0065) — vale para QUALQUER tela
  -- que leia a tabela pelo PostgREST, não só para a consulta do sino. Dois
  -- eventos aconteceram com este lead (atribuído e devolvido) e quatro linhas
  -- foram gravadas; o corretor tem de ver duas.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  select count(*) into v_no_sino
    from public.notifications
   where kind in ('lead_assigned', 'lead_lost_timeout') and link = v_link;

  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check65(v_no_sino = 2,
    'o corretor vê UM aviso por evento — a cópia de saída não entra no sino');
end
$$;

\echo '== 3b. o sino do CCA deixa de ser sempre vazio =='

do $$
declare
  cca    uuid := '00000000-0000-0000-0000-000000650002';
  v_stg  uuid;
  v_deal uuid;
begin
  select id into v_stg from public.pipeline_stages
   order by is_initial desc nulls last, position limit 1;
  if v_stg is null then
    raise notice '  -- pipeline sem estágio; aviso do CCA não verificado aqui';
    return;
  end if;

  insert into public.deals (stage_id) values (v_stg) returning id into v_deal;

  -- É o que `review_deal_documents` faz quando o gerente aprova a conferência.
  insert into public.cca_cases (deal_id) values (v_deal);

  perform pg_temp.check65(
    exists (select 1 from public.notifications
             where profile_id = cca and kind = 'cca_pending'
               and channel = 'in_app' and link = '/cca'),
    'analista de crédito é avisado quando o dossiê entra na esteira');

  -- O kind existia só em dado de seed: nenhum produtor no código o gerava.
  perform pg_temp.check65(
    (select count(*) from public.notifications
      where profile_id = cca and kind = 'cca_pending') = 1,
    'um aviso por dossiê, não um por documento');
end
$$;

\echo '== 4. check-in é só de quem tem menu.checkin =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000650001';
  cca uuid := '00000000-0000-0000-0000-000000650002';
  v_row public.checkins;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', cca::text, 'role', 'authenticated')::text, false);

  begin
    v_row := public.perform_checkin('198.51.100.10'::inet);
    raise exception 'FALHOU: perfil de CCA bateu ponto na roleta';
  exception when insufficient_privilege then
    raise notice '  ok  perfil sem menu.checkin é recusado pelo banco, não só pelo menu';
  end;

  perform pg_temp.check65(
    not exists (select 1 from public.checkins where profile_id = cca),
    'a recusa não deixa presença gravada');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  v_row := public.perform_checkin('198.51.100.10'::inet);
  perform pg_temp.check65(v_row.id is not null, 'corretor continua batendo ponto normalmente');
end
$$;

\echo '== 5. check-out fecha um turno, não o dia =='

do $$
declare
  cor      uuid := '00000000-0000-0000-0000-000000650001';
  v_outro  uuid;
  v_row    public.checkins;
begin
  -- Segundo turno aberto no mesmo dia, como quem bate ponto de manhã e à tarde.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('cron65b', 'Turno 0065 B', '00:00', '00:00', '23:59', 90)
  on conflict (code) do nothing;
  select id into v_outro from public.work_shifts where code = 'cron65b';

  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (cor, v_outro, public.current_work_date(), '198.51.100.10'::inet)
  on conflict (profile_id, work_date, shift_id) do update set checked_out_at = null;

  perform pg_temp.check65(
    (select count(*) from public.checkins
      where profile_id = cor and work_date = public.current_work_date() and checked_out_at is null) = 2,
    'cenário: dois check-ins abertos hoje');

  v_row := public.perform_checkout();
  perform pg_temp.check65(v_row.checked_out_at is not null, 'check-out fecha a presença');
  perform pg_temp.check65(
    (select count(*) from public.checkins
      where profile_id = cor and work_date = public.current_work_date() and checked_out_at is null) = 1,
    'um check-out fecha UM turno — o outro continua aberto');
  perform pg_temp.check65(
    (select shift_id from public.checkins where id = v_row.id) = public.current_shift(),
    'o turno fechado é o vigente, não um ao acaso');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 6. contrato do voice-ai-webhook: origem por código, id externo único =='

do $$
declare
  v_source uuid;
  v_lead   uuid;
begin
  -- O webhook recebe `source_code` no PAYLOAD e resolve contra lead_sources.
  -- Gravar direto numa coluna `source_code` era o que a function fazia até a
  -- correção de 03/09 — e nunca funcionou, porque a coluna não existe.
  perform pg_temp.check65(
    not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'leads' and column_name = 'source_code'),
    'leads NÃO tem coluna source_code (a origem é source_id)');

  -- O catálogo real traz este código; criado aqui para o arquivo não depender
  -- do seed, como os demais testes.
  insert into public.lead_sources (code, label, channel)
  values ('whatsapp', 'WhatsApp', 'whatsapp')
  on conflict (code) do nothing;

  select id into v_source from public.lead_sources where code = 'whatsapp';
  perform pg_temp.check65(v_source is not null,
    'lead_sources.code é a chave que o payload manda (ex.: whatsapp)');

  insert into public.leads (external_id, full_name, phone_raw, source_id, status, funnel_stage)
  values ('chamada-0065', 'Lead da IA de voz', '11944440065', v_source, 'queued', 'new')
  returning id into v_lead;

  perform pg_temp.check65(
    (select source_id from public.leads where id = v_lead) = v_source,
    'o lead da voz nasce com a origem resolvida');

  -- Reenvio do mesmo evento: a plataforma de terceiro retenta por padrão.
  begin
    insert into public.leads (external_id, full_name, status, funnel_stage)
    values ('chamada-0065', 'Lead duplicado', 'queued', 'new');
    raise exception 'FALHOU: external_id repetido criou um segundo lead';
  exception when unique_violation then
    raise notice '  ok  external_id repetido é recusado pelo índice único (idempotência)';
  end;
end
$$;

\echo 'notificações e crons ok'
