-- =============================================================================
-- Regressão da 0083 — fila de saída com teto, motivo em toda linha e o que
-- falha em silêncio avisando alguém.
--
-- Por que este arquivo existe: a 0065 provou o ENCANAMENTO (job ativo, gatilho
-- econômico, sino separado da fila) e nada provava o REGIME PERMANENTE. Entre
-- 03/09 e 06/09 a fila de WhatsApp cresceu de 77 para 312 linhas pendentes sem
-- que um único teste piscasse: nenhum deles olha o TAMANHO da fila nem a IDADE
-- das mensagens, e o 04_cron_scheduling.sql conta jobs, não entregas.
--
-- O que se afirma aqui:
--   1. A caixa de entrada é `in_app` também na escrita: o destinatário não
--      apaga nem carimba a linha da fila de saída.
--   2. A mensagem vencida sai da fila com motivo escrito, e a recente não sai.
--      O gatilho do cron expira ANTES de decidir se chama o worker, e o
--      descarte avisa o admin no sino — uma vez a cada 12 h, não por passada.
--   3. (a superfície da fila é a `notification_queue_health()` da 0082, de
--      outra frente; aqui só se garante que ela passa a contar fila viva.)
--   4. Atividade vencida gera UM aviso, e só um.
--   5. Job com falha avisa admin e diretoria — o primeiro produtor que alcança
--      o papel director — sem repetir dentro de 6 h.
--   6. Mensagem de WhatsApp que ninguém soube rotear fica registrada e avisa o
--      SDR; a que virou conversa não avisa ninguém; replay não duplica.
--   7. Dossiê que estoura 5 tentativas avisa quem pediu o envio.
--   8. Os dois jobs novos estão agendados.
--
-- Não depende de seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check83(cond boolean, label text)
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
  cor uuid := '00000000-0000-0000-0000-000000830001';
  adm uuid := '00000000-0000-0000-0000-000000830002';
  agt uuid := '00000000-0000-0000-0000-000000830003';
  dir uuid := '00000000-0000-0000-0000-000000830004';
  -- Papel é acumulável e isso é o caso NORMAL (CONTEXT.md). Na homologação já
  -- existe um perfil com {admin,director,manager,broker}. Todo produtor que
  -- escolhe destinatário por `role in (...)` casa uma vez por papel: sem
  -- `distinct`, essa pessoa recebe o mesmo aviso em dobro — e o `not exists`
  -- de anti-repetição não enxerga a linha irmã inserida no MESMO comando.
  dua uuid := '00000000-0000-0000-0000-000000830005';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'corretor@f83.test', '{"full_name":"Corretor 0083"}'),
    (adm, 'admin@f83.test',    '{"full_name":"Admin 0083"}'),
    (agt, 'sdr@f83.test',      '{"full_name":"SDR 0083"}'),
    (dir, 'diretor@f83.test',  '{"full_name":"Diretor 0083"}'),
    (dua, 'acumulado@f83.test','{"full_name":"Admin Diretor SDR 0083"}')
  on conflict do nothing;

  -- `handle_new_auth_user` dá `broker` a todo mundo; cada um aqui precisa do
  -- seu papel exato, porque é o papel que decide quem recebe cada aviso.
  delete from public.user_roles where profile_id in (adm, agt, dir, dua);
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (agt, 'sdr'), (dir, 'director'),
    (dua, 'admin'), (dua, 'director'), (dua, 'sdr')
  on conflict do nothing;
end
$$;

\echo '== 1. a caixa de entrada é in_app também na escrita =='

do $$
declare
  cor      uuid := '00000000-0000-0000-0000-000000830001';
  v_in     uuid;
  v_out    uuid;
  v_apagou bigint;
  v_marcou bigint;
begin
  insert into public.notifications (profile_id, kind, title, channel)
  values (cor, 'lead_lost_timeout', 'Aviso 0083 no sino', 'in_app')
  returning id into v_in;

  insert into public.notifications (profile_id, kind, title, channel)
  values (cor, 'lead_lost_timeout', 'Aviso 0083 na fila', 'whatsapp')
  returning id into v_out;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- "Marcar todas como lidas" não filtra canal na consulta da tela, e a policy
  -- também não filtrava: o carimbo caía na fila de saída, que a tela nunca
  -- mostrou, e o retorno de `.select('id')` contava mais do que o sino exibia.
  update public.notifications set read_at = now()
   where profile_id = cor and read_at is null;
  get diagnostics v_marcou = row_count;

  -- O destinatário tinha permissão de RLS para APAGAR o próprio aviso de "lead
  -- perdido por prazo" antes de ele ser entregue. Não havia tela para isso —
  -- mas a fronteira é a policy, não a ausência de botão.
  delete from public.notifications where profile_id = cor;
  get diagnostics v_apagou = row_count;

  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check83(v_marcou = 1,
    'marcar como lida alcança só a caixa de entrada, não a fila de saída');
  perform pg_temp.check83(v_apagou = 1,
    'o destinatário não apaga a linha que ainda vai ser entregue');
  perform pg_temp.check83(
    exists (select 1 from public.notifications where id = v_out and read_at is null),
    'a linha de WhatsApp continua intacta e pendente depois das duas tentativas');

  delete from public.notifications where id in (v_in, v_out);
end
$$;

\echo '== 2. corte de idade: o vencido sai com motivo, o recente fica =='

do $$
declare
  cor      uuid := '00000000-0000-0000-0000-000000830001';
  adm      uuid := '00000000-0000-0000-0000-000000830002';
  v_velha  uuid;
  v_nova   uuid;
  v_sino   uuid;
  v_saiu   integer;
begin
  insert into public.notifications (profile_id, kind, title, channel, created_at)
  values (cor, 'lead_lost_timeout', 'Vencida 0083', 'whatsapp', now() - interval '5 hours')
  returning id into v_velha;

  insert into public.notifications (profile_id, kind, title, channel, created_at)
  values (cor, 'lead_lost_timeout', 'Recente 0083', 'whatsapp', now() - interval '10 minutes')
  returning id into v_nova;

  -- A cópia do sino é o registro durável do fato: o corte de idade vale para a
  -- ENTREGA, não para o histórico.
  insert into public.notifications (profile_id, kind, title, channel, created_at)
  values (cor, 'lead_lost_timeout', 'Vencida no sino 0083', 'in_app', now() - interval '5 hours')
  returning id into v_sino;

  v_saiu := public.expire_stale_outbound_notifications();

  perform pg_temp.check83(
    (select sent_at is not null and last_error like 'descartada por idade%'
       from public.notifications where id = v_velha),
    'mensagem vencida sai da fila COM o motivo escrito na linha');
  -- `p_max_age::text` renderizava o interval como "02:00:00" dentro de uma frase
  -- em português que a aba de Integrações mostra e que o admin lê no sino.
  perform pg_temp.check83(
    (select last_error like '%não entregue em 2 h%' and last_error not like '%02:00:00%'
       from public.notifications where id = v_velha),
    'o motivo escrito diz "2 h", não "02:00:00": valor de máquina não vaza em cópia pt-BR');
  perform pg_temp.check83(
    (select sent_at is null from public.notifications where id = v_nova),
    'mensagem recente continua na fila');
  perform pg_temp.check83(
    (select sent_at is null and read_at is null from public.notifications where id = v_sino),
    'a cópia in_app do mesmo evento não é tocada pelo corte de idade');
  perform pg_temp.check83(v_saiu >= 1,
    'a função devolve quantas linhas descartou');

  -- O corte de idade trocaria um silêncio por outro: antes a fila crescia sem
  -- ninguém ver, agora ela sumiria sem ninguém ver — e a aba Saúde dos jobs
  -- continua verde nos dois casos, porque o job de fato roda. Descarte é o
  -- único sinal que prova "o canal não está entregando".
  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'outbound_expired'
               and link = '/admin/integrations' and channel = 'in_app'
               and body like '%passaram de 2 h sem sair%'),
    'o admin é avisado de que houve descarte sem entrega, com o prazo por extenso');
  perform pg_temp.check83(
    not exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'outbound_expired'),
    'o corretor não recebe aviso de credencial: não é dele o conserto');

  -- O gatilho chama esta função a cada minuto; sem a trava de 12 h o aviso
  -- viraria ele mesmo o entulho.
  insert into public.notifications (profile_id, kind, title, channel, created_at)
  values (cor, 'lead_lost_timeout', 'Outra vencida 0083', 'whatsapp', now() - interval '6 hours');
  perform public.expire_stale_outbound_notifications();
  perform pg_temp.check83(
    (select count(*) from public.notifications
      where profile_id = adm and kind = 'outbound_expired') = 1,
    'a passada seguinte não repete o aviso de descarte dentro de 12 h');

  delete from public.notifications where kind = 'outbound_expired';
  delete from public.notifications where id in (v_velha, v_nova, v_sino);
  delete from public.notifications
   where profile_id = cor and title = 'Outra vencida 0083';
end
$$;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000830001';
begin
  if to_regclass('net.chamadas') is null then
    raise notice '  -- sem dublê de pg_net (o 65 o cria); gatilho não verificado aqui';
    return;
  end if;

  insert into private.integration_credentials (provider, label, secret) values
    ('supabase', 'functions_url',    'https://exemplo.invalid/functions/v1'),
    ('supabase', 'service_role_key', 'chave-de-teste')
  on conflict (provider, label) do update set secret = excluded.secret, active = true;

  update public.notifications set sent_at = now()
   where channel <> 'in_app' and sent_at is null;

  -- Fila só com mensagem vencida: o gatilho expira ANTES de decidir e não
  -- gasta requisição. Sem isso o worker seria acordado todo minuto para
  -- entregar aviso que já não serve — e, no dia em que a credencial entrasse,
  -- entregaria mesmo.
  insert into public.notifications (profile_id, kind, title, channel, created_at)
  values (cor, 'lead_lost_timeout', 'Só vencida 0083', 'whatsapp', now() - interval '9 hours');

  delete from net.chamadas;
  perform public.dispatch_pending_notifications();
  perform pg_temp.check83((select count(*) from net.chamadas) = 0,
    'fila só com mensagem vencida não acorda o worker: o gatilho expira antes');

  insert into public.notifications (profile_id, kind, title, channel)
  values (cor, 'lead_lost_timeout', 'Dentro do prazo 0083', 'whatsapp');

  delete from net.chamadas;
  perform public.dispatch_pending_notifications();
  perform pg_temp.check83((select count(*) from net.chamadas) = 1,
    'fila com mensagem dentro do prazo continua acordando o worker');

  update public.notifications set sent_at = now()
   where channel <> 'in_app' and sent_at is null;
end
$$;

\echo '== 4. atividade vencida avisa o dono, uma vez só =='

do $$
declare
  cor     uuid := '00000000-0000-0000-0000-000000830001';
  agt     uuid := '00000000-0000-0000-0000-000000830003';
  v_criou integer;
  v_de_novo integer;
begin
  insert into public.tasks (title, assigned_to, due_at, status)
  values ('Ligar para a Marta 0083', cor, now() - interval '2 hours', 'open');

  -- O SDR não tem `menu.atividades` (0036 concedeu a partner, director, manager
  -- e broker). Ele recebe o aviso — a tarefa é dele —, mas mandá-lo para
  -- `/atividades` é um clique que cai em "Acesso não liberado".
  insert into public.tasks (title, assigned_to, due_at, status)
  values ('Retornar o WhatsApp da Cláudia 0083', agt, now() - interval '3 hours', 'open');

  -- Fora do recorte: vencida há mais de uma semana (histórico, não novidade),
  -- e uma já concluída.
  insert into public.tasks (title, assigned_to, due_at, status)
  values ('Vencida antiga 0083', cor, now() - interval '9 days', 'open');
  insert into public.tasks (title, assigned_to, due_at, status, completed_at)
  values ('Já feita 0083', cor, now() - interval '2 hours', 'done', now());

  v_criou := public.notify_due_tasks();

  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = cor and kind = 'task_due'
               and title = 'Atividade vencida: Ligar para a Marta 0083'
               and link = '/atividades' and channel = 'in_app'),
    'o dono da atividade vencida é avisado, com destino');
  perform pg_temp.check83(v_criou = 2,
    'só a vencida em aberto e dentro da semana gera aviso');

  -- Link só para quem abre a tela. O aviso continua chegando: o que muda é que
  -- ele não promete uma porta fechada, e o corpo diz o que fazer.
  perform pg_temp.check83(
    (select link is null and body like '%peça acesso ao administrador%'
       from public.notifications
      where profile_id = agt and kind = 'task_due'),
    'quem não tem menu.atividades recebe o aviso sem link e com o motivo escrito');

  -- O job roda duas vezes por dia: sem a trava, a mesma tarefa encheria o sino.
  v_de_novo := public.notify_due_tasks();
  perform pg_temp.check83(v_de_novo = 0,
    'a segunda passada do job não repete o aviso da mesma atividade');

  delete from public.notifications where kind = 'task_due';
  delete from public.tasks where assigned_to in (cor, agt);
end
$$;

\echo '== 5. job com falha avisa quem pode agir =='

do $$
declare
  adm      uuid := '00000000-0000-0000-0000-000000830002';
  dir      uuid := '00000000-0000-0000-0000-000000830004';
  cor      uuid := '00000000-0000-0000-0000-000000830001';
  dua      uuid := '00000000-0000-0000-0000-000000830005';
  v_jobid  bigint;
  v_criou  integer;
  v_repete integer;
begin
  if to_regclass('cron.job_run_details') is null then
    raise notice '  -- sem stub de cron.job_run_details; aviso de falha não verificado';
    return;
  end if;

  select jobid into v_jobid from cron.job where jobname = 'faceimob-notify-dispatch';
  if v_jobid is null then
    raise notice '  -- job de referência ausente; aviso de falha não verificado';
    return;
  end if;

  insert into cron.job_run_details (jobid, status, start_time, return_message)
  values (v_jobid, 'failed', now() - interval '5 minutes', 'erro simulado 0083');

  v_criou := public.notify_cron_failures();

  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'cron_failure'
               and title like '%faceimob-notify-dispatch%'
               and link = '/admin/integrations'),
    'o admin é avisado quando um job falha');
  -- Nenhum dos 14 produtores anteriores gravava para `director`: o sino da
  -- diretoria lia "Nada por aqui" para sempre.
  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = dir and kind = 'cron_failure'),
    'a diretoria também é avisada — primeiro produtor que alcança o papel director');
  -- ...mas SEM o link. `/admin/integrations` exige `menu.admin_integrations`,
  -- que não tem uma linha em `role_permissions` (só `is_admin()` passa), e
  -- `cron_jobs_health()` tem `where is_admin()` no corpo: o diretor levaria um
  -- clique a "Acesso não liberado" e, se a rota abrisse, a uma aba vazia.
  perform pg_temp.check83(
    (select link is null and body like '%Peça ao administrador%'
       from public.notifications where profile_id = dir and kind = 'cron_failure'),
    'o aviso da diretoria não promete uma tela que o app recusa: sem link, com a ação escrita');
  -- Quem acumula admin e diretor abre a tela, e por isso recebe o link.
  perform pg_temp.check83(
    (select link = '/admin/integrations'
       from public.notifications where profile_id = dua and kind = 'cron_failure'),
    'quem é admin recebe o link, mesmo acumulando o papel de diretor');
  perform pg_temp.check83(
    not exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'cron_failure'),
    'o corretor não recebe aviso de agendador: não é dele o conserto');
  perform pg_temp.check83(v_criou >= 2, 'um aviso por destinatário, na primeira passada');
  -- Um aviso por PESSOA, não por papel. Quem é admin e diretor ao mesmo tempo
  -- casaria duas vezes no `role in ('admin','director')`, e a trava de 6 h não
  -- pega a linha irmã inserida no mesmo comando.
  perform pg_temp.check83(
    (select count(*) from public.notifications
      where profile_id = dua and kind = 'cron_failure') = 1,
    'quem acumula admin e diretor recebe UM aviso de job com falha, não dois');

  -- O job de aviso roda de hora em hora; a trava é de 6 h por job.
  v_repete := public.notify_cron_failures();
  perform pg_temp.check83(v_repete = 0,
    'a passada seguinte não repete o mesmo job dentro de 6 h');

  delete from public.notifications where kind = 'cron_failure';
  delete from cron.job_run_details where return_message = 'erro simulado 0083';
end
$$;

\echo '== 6. mensagem de WhatsApp que ninguém soube rotear deixa de sumir =='

do $$
declare
  agt   uuid := '00000000-0000-0000-0000-000000830003';
  adm   uuid := '00000000-0000-0000-0000-000000830002';
  cor   uuid := '00000000-0000-0000-0000-000000830001';
  dua   uuid := '00000000-0000-0000-0000-000000830005';
  v_dup boolean := false;
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0083.unmatched', '5511988880083', 'Oi, ainda tem o apartamento?', 'unmatched');

  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = agt and kind = 'whatsapp_unmatched'
               and body like '5511988880083%'),
    'o SDR é avisado da mensagem que o robô não soube rotear');
  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'whatsapp_unmatched'),
    'o admin também vê — é quem configura o roteamento');
  -- Mesma armadilha do §5 pelo outro produtor: `role in ('sdr','admin')`.
  perform pg_temp.check83(
    (select count(*) from public.notifications
      where profile_id = dua and kind = 'whatsapp_unmatched') = 1,
    'quem acumula sdr e admin recebe UM aviso de mensagem sem destino, não dois');
  perform pg_temp.check83(
    not exists (select 1 from public.notifications
                 where profile_id = cor and kind = 'whatsapp_unmatched'),
    'o corretor não recebe conversa que não é dele');
  -- Sem tela de caixa de entrada de WhatsApp: apontar para uma rota que não
  -- existe seria mentir no clique.
  -- Link nulo sozinho deixa o SDR num beco: no sino a linha continua sendo um
  -- botão com hover que, ao ser clicado, só marca como lida. O corpo tem de
  -- carregar a saída — responder pelo aparelho — e assumir que a caixa de
  -- entrada ainda não existe.
  perform pg_temp.check83(
    (select link is null and body like '%Responda pelo aparelho%'
       from public.notifications
      where profile_id = agt and kind = 'whatsapp_unmatched' limit 1),
    'o aviso não promete uma tela que ainda não existe, e diz o que fazer sem ela');

  -- Cliente insistente não pode virar 20 linhas no sino de cada analista.
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0083.unmatched.2', '5511988880083', 'Alô?', 'unmatched');
  perform pg_temp.check83(
    (select count(*) from public.notifications
      where profile_id = agt and kind = 'whatsapp_unmatched') = 1,
    'o mesmo telefone não gera um aviso por mensagem dentro de 6 h');

  -- Mensagem que virou conversa é registro, não pendência.
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0083.ok', '5511977770083', 'Tenho interesse', 'sdr_turn');
  perform pg_temp.check83(
    not exists (select 1 from public.notifications
                 where kind = 'whatsapp_unmatched' and body like '5511977770083%'),
    'mensagem que virou turno de conversa não vira pendência de ninguém');

  -- Replay da Meta: o único de provider_message_id é o que impede o segundo
  -- registro (e, com ele, o segundo aviso).
  begin
    insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
    values ('wamid.0083.unmatched', '5511988880083', 'Oi, ainda tem o apartamento?', 'unmatched');
  exception when unique_violation then
    v_dup := true;
  end;
  perform pg_temp.check83(v_dup, 'replay da Meta não cria segundo registro da mesma mensagem');

  delete from public.notifications where kind = 'whatsapp_unmatched';
  delete from public.whatsapp_inbound_messages where provider_message_id like 'wamid.0083%';
end
$$;

do $$
declare
  agt      uuid := '00000000-0000-0000-0000-000000830003';
  cor      uuid := '00000000-0000-0000-0000-000000830001';
  v_ve_sdr bigint;
  v_ve_cor bigint;
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0083.rls', '5511966660083', 'Mensagem com dado do cliente', 'unmatched');

  -- O corpo é a mensagem do cliente: dado pessoal. Lê quem trata.
  perform set_config('request.jwt.claims',
    json_build_object('sub', agt::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_ve_sdr from public.whatsapp_inbound_messages;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_ve_cor from public.whatsapp_inbound_messages;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check83(v_ve_sdr >= 1, 'o SDR lê a mensagem que precisa tratar');
  perform pg_temp.check83(v_ve_cor = 0,
    'o corretor não lê a caixa de mensagens recebidas — é dado pessoal de cliente');

  delete from public.notifications where kind = 'whatsapp_unmatched';
  delete from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0083.rls';
end
$$;

-- A policy de UPDATE não separa coluna: quem passa em `has_any_role` passa para
-- a linha inteira. Quem recorta é o GRANT — `update (handled_at, handled_by)` —
-- e sem ele um sdr/gerente/diretor reescreveria `body`, `from_phone`, `outcome`
-- e `provider_message_id`, isto é, editaria a mensagem do cliente. O DELETE não
-- é concedido a ninguém: registro bruto de conversa não se apaga pela tela.
do $$
declare
  agt      uuid := '00000000-0000-0000-0000-000000830003';
  v_barrou_delete boolean := false;
  v_barrou_body   boolean := false;
  v_marcou        bigint;
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0083.grant', '5511955550083', 'Corpo original do cliente', 'unmatched');

  perform set_config('request.jwt.claims',
    json_build_object('sub', agt::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  begin
    delete from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0083.grant';
  exception when insufficient_privilege then
    v_barrou_delete := true;
  end;

  begin
    update public.whatsapp_inbound_messages set body = 'reescrito pelo sdr'
     where provider_message_id = 'wamid.0083.grant';
  exception when insufficient_privilege then
    v_barrou_body := true;
  end;

  -- A única escrita que a tela precisa fazer continua passando.
  update public.whatsapp_inbound_messages set handled_at = now(), handled_by = agt
   where provider_message_id = 'wamid.0083.grant';
  get diagnostics v_marcou = row_count;

  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check83(v_barrou_delete,
    'o sdr não apaga a mensagem recebida: DELETE não é concedido a authenticated');
  perform pg_temp.check83(v_barrou_body,
    'o sdr não reescreve o corpo da mensagem do cliente: o UPDATE é por coluna');
  perform pg_temp.check83(
    (select body = 'Corpo original do cliente'
       from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0083.grant'),
    'o corpo original permanece intacto depois das duas tentativas');
  perform pg_temp.check83(v_marcou = 1,
    'marcar como tratada continua funcionando — é a escrita que a tela precisa');

  delete from public.notifications where kind = 'whatsapp_unmatched';
  delete from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0083.grant';
end
$$;

\echo '== 7. dossiê que desistiu avisa quem pediu =='

do $$
declare
  adm    uuid := '00000000-0000-0000-0000-000000830002';
  cor    uuid := '00000000-0000-0000-0000-000000830001';
  v_dev  uuid;
  v_deal uuid;
  v_stg  uuid;
  v_sub  uuid;
begin
  select id into v_stg from public.pipeline_stages
   order by is_initial desc nulls last, position limit 1;
  if v_stg is null then
    raise notice '  -- pipeline sem estágio; aviso de dossiê morto não verificado';
    return;
  end if;

  insert into public.developers (name, flow, submission_email)
  values ('Construtora 0083', 'external', 'construtora83@exemplo.invalid')
  returning id into v_dev;
  insert into public.deals (developer_id, stage_id) values (v_dev, v_stg)
  returning id into v_deal;

  insert into public.developer_submissions
    (deal_id, developer_id, to_email, subject, document_ids, status, attempts, requested_by)
  values (v_deal, v_dev, 'construtora83@exemplo.invalid', 'Dossiê 0083', '{}', 'failed', 4, cor)
  returning id into v_sub;

  perform pg_temp.check83(
    not exists (select 1 from public.notifications where kind = 'submission_failed'),
    'quatro tentativas ainda são tentativas: ninguém é avisado antes do teto');

  update public.developer_submissions
     set status = 'failed', attempts = 5, last_error = 'Brevo respondeu 400'
   where id = v_sub;

  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = cor and kind = 'submission_failed'
               and link = '/cca' and body like '%Brevo respondeu 400%'),
    'quem pediu o envio descobre que o dossiê não saiu, e por quê');
  perform pg_temp.check83(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'submission_failed'),
    'o admin também é avisado: é quem conserta a credencial');

  delete from public.notifications where kind = 'submission_failed';
end
$$;

\echo '== 8. os dois produtores novos estão agendados =='

do $$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  if to_regclass('cron.job') is null then
    raise notice '  -- sem cron.job; agendamento não verificado';
    return;
  end if;

  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-cron-failure-alert';
  perform pg_temp.check83(v_schedule is not null, 'faceimob-cron-failure-alert está agendado');
  perform pg_temp.check83(v_command like '%notify_cron_failures%',
    'o job de alerta chama notify_cron_failures()');
  perform pg_temp.check83(v_active, 'faceimob-cron-failure-alert está ativo');

  select j.schedule, j.command, j.active into v_schedule, v_command, v_active
    from cron.job j where j.jobname = 'faceimob-task-due';
  perform pg_temp.check83(v_schedule is not null, 'faceimob-task-due está agendado');
  perform pg_temp.check83(v_command like '%notify_due_tasks%',
    'o job de atividade vencida chama notify_due_tasks()');
  perform pg_temp.check83(v_active, 'faceimob-task-due está ativo');
end
$$;

\echo '0083 ok'
