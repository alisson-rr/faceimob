-- =============================================================================
-- Regressão da 0120 — caixa de conversas do SDR.
--
--   1. provider_message_id segue único: o webhook reserva a mensagem nele antes
--      de baixar o áudio, e um replay não paga a transcrição duas vezes.
--   2. Quem assume e quem resolve é o banco que carimba, em qualquer caminho; o
--      corretor não muda a conversa; a conversa entregue a corretor pode ser
--      assumida para responder ao lead, mas não volta ao robô.
--   3. A roleta só segura o lead de conversa `active` (o robô está falando).
--      A 0120 segurava também a humana com dono, sem prazo; a 0121 desfez isso
--      (não foi pedido e o lead encalhava se o SDR esquecesse). Humana, com ou
--      sem dono, e resolvida são distribuídas.
--   4. O marketing lê as mensagens recebidas; o corretor não. O SDR lê o nome
--      dos outros operadores (é o que a tela mostra em "Humano · nome").
--   5. Avisos: o áudio que falhou avisa o SDR; mensagem em conversa com dono
--      avisa só o dono, uma vez a cada 30 min; em conversa entregue avisa o SDR
--      e o corretor do lead.
--   6. "Sem lead" agrupa por telefone; marcar como resolvido grava o próprio
--      usuário e é recusado com 42501 a quem só lê.
--
-- Os papéis entram com `set local role authenticated`, como o PostgREST faz.
-- Não depende de seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check120(cond boolean, label text)
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
  adm  uuid := '00000000-0000-0000-0000-000001200001';
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  sdr2 uuid := '00000000-0000-0000-0000-000001200003';
  mkt  uuid := '00000000-0000-0000-0000-000001200004';
  dir  uuid := '00000000-0000-0000-0000-000001200005';
  cor  uuid := '00000000-0000-0000-0000-000001200006';
  cora uuid := '00000000-0000-0000-0000-000001200007';
  corb uuid := '00000000-0000-0000-0000-000001200008';
  corc uuid := '00000000-0000-0000-0000-000001200009';
  v_group uuid;
  v_shift uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@caixa120.test',  '{"full_name":"Admin 120"}'),
    (sdr1, 'sdr1@caixa120.test', '{"full_name":"SDR Um 120"}'),
    (sdr2, 'sdr2@caixa120.test', '{"full_name":"SDR Dois 120"}'),
    (mkt,  'mkt@caixa120.test',  '{"full_name":"Marketing 120"}'),
    (dir,  'dir@caixa120.test',  '{"full_name":"Diretor 120"}'),
    (cor,  'cor@caixa120.test',  '{"full_name":"Corretor 120"}'),
    (cora, 'cora@caixa120.test', '{"full_name":"Corretor A 120"}'),
    (corb, 'corb@caixa120.test', '{"full_name":"Corretor B 120"}'),
    (corc, 'corc@caixa120.test', '{"full_name":"Corretor C 120"}')
  on conflict do nothing;

  -- `handle_new_auth_user` dá `broker` a todo mundo; aqui o papel exato decide
  -- quem escreve na conversa e quem recebe cada aviso.
  delete from public.user_roles where profile_id in (adm, sdr1, sdr2, mkt, dir);
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (sdr1, 'sdr'), (sdr2, 'sdr'), (mkt, 'marketing'), (dir, 'director'),
    (cor, 'broker'), (cora, 'broker'), (corb, 'broker'), (corc, 'broker')
  on conflict do nothing;

  -- Três corretores: o bloco 3 distribui três leads.
  insert into public.distribution_groups (name, slug, kind, active)
  values ('Roleta 120', 'roleta-120', 'specific', true)
  returning id into v_group;
  insert into public.distribution_group_members (group_id, profile_id, active)
  values (v_group, cora, true), (v_group, corb, true), (v_group, corc, true);

  -- Turno do dia inteiro: o teste não pode depender da hora do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('teste-120', 'Integral 120', '00:00', '00:00', '23:59', -120)
  returning id into v_shift;
  insert into public.checkins (profile_id, shift_id, work_date) values
    (cora, v_shift, public.current_work_date()),
    (corb, v_shift, public.current_work_date()),
    (corc, v_shift, public.current_work_date());

  -- Grupo sem ninguém: o lead de cenário que não é da roleta fica parado nele,
  -- sem cair na fila geral e ir parar num corretor de outro arquivo.
  insert into public.distribution_groups (name, slug, kind, active)
  values ('Parado 120', 'parado-120', 'specific', true);
end
$$;

\echo '== 1. estrutura =='

do $$
begin
  perform pg_temp.check120(
    exists (
      select 1
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = 'public.whatsapp_inbound_messages'::regclass
         and i.indisunique
         and i.indnatts = 1
         and a.attname = 'provider_message_id'
    ),
    'provider_message_id segue único: é nele que o webhook reserva a mensagem antes de baixar o áudio');
  perform pg_temp.check120(
    (select count(*) = 3 from information_schema.columns
      where table_schema = 'public' and table_name = 'sdr_messages'
        and column_name in ('media_type', 'media_id', 'sent_by')),
    'sdr_messages tem media_type, media_id e sent_by');
end
$$;

\echo '== 2. quem assume e quem resolve é o banco que carimba =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000001200001';
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  sdr2 uuid := '00000000-0000-0000-0000-000001200003';
  cor  uuid := '00000000-0000-0000-0000-000001200006';
  v_parado   uuid;
  v_lead     uuid;
  v_conv     uuid;
  v_lead_ent uuid;
  v_conv_ent uuid;
  v_corretor bigint;
  v_recusa   text;
  r          record;
begin
  select id into v_parado from public.distribution_groups where slug = 'parado-120';

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Caixa 120', '11900120001', v_parado)
  returning id into v_lead;
  insert into public.sdr_conversations (lead_id, status) values (v_lead, 'active')
  returning id into v_conv;

  -- O mesmo update condicional que a tela faz: status direto na tabela.
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'human' where id = v_conv and status = 'active';
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into r from public.sdr_conversations where id = v_conv;
  perform pg_temp.check120(r.status = 'human' and r.assumed_by = sdr1 and r.assumed_at is not null,
    'o SDR assume e o banco grava quem assumiu e quando');

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set assumed_by = adm where id = v_conv;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(
    (select assumed_by = sdr1 from public.sdr_conversations where id = v_conv),
    'ninguém grava o nome de outro: mexer no dono é assumir em nome próprio');

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'resolved' where id = v_conv;
  get diagnostics v_corretor = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(
    v_corretor = 0 and (select status = 'human' from public.sdr_conversations where id = v_conv),
    'o corretor não assume nem resolve conversa do SDR: a policy casa zero linhas');

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr2::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set assumed_by = sdr2 where id = v_conv and status = 'human';
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(
    (select assumed_by = sdr2 from public.sdr_conversations where id = v_conv),
    'outro SDR assume a conversa humana e passa a ser o dono');

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr2::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'active' where id = v_conv and status = 'human';
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into r from public.sdr_conversations where id = v_conv;
  perform pg_temp.check120(r.status = 'active' and r.assumed_by is null and r.assumed_at is null,
    'devolver ao robô limpa o dono');

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'resolved'
   where id = v_conv and status in ('active', 'human');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  select * into r from public.sdr_conversations where id = v_conv;
  perform pg_temp.check120(r.status = 'resolved' and r.resolved_by = sdr1 and r.resolved_at is not null,
    'resolver grava quem resolveu e quando');

  -- Conversa entregue a corretor: o lead escreveu de novo e precisa de resposta.
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Entregue 120', '11900120002', 'assigned', cor)
  returning id into v_lead_ent;
  insert into public.sdr_conversations (lead_id, status, handed_off_at, handed_off_to)
  values (v_lead_ent, 'handed_off', now(), cor)
  returning id into v_conv_ent;

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'human' where id = v_conv_ent and status = 'handed_off';
  begin
    update public.sdr_conversations set status = 'active' where id = v_conv_ent;
  exception when raise_exception then
    v_recusa := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(
    (select status = 'human' and assumed_by = sdr1 from public.sdr_conversations where id = v_conv_ent),
    'conversa já entregue ao corretor pode ser assumida para responder ao lead');
  perform pg_temp.check120(v_recusa like '%entregue a um corretor%',
    'mas não volta ao robô: ele requalificaria o lead e o tiraria do corretor');
end
$$;

\echo '== 3. a roleta segura só a conversa ativa (0121 desfez a trava da humana com dono) =='

do $$
declare
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  v_group     uuid;
  v_com_dono  uuid;
  v_resolvida uuid;
  v_sem_dono  uuid;
  v_ativa     uuid;
  v_conv      uuid;
begin
  select id into v_group from public.distribution_groups where slug = 'roleta-120';

  -- `created_at` antigo: a varredura olha os 50 mais antigos da fila, e o teste
  -- não pode depender do que os arquivos anteriores deixaram nela.
  insert into public.leads (full_name, phone, distribution_group_id, created_at)
  values ('Lead Com Dono 120', '11900120011', v_group, '2001-01-01')
  returning id into v_com_dono;
  insert into public.leads (full_name, phone, distribution_group_id, created_at)
  values ('Lead Resolvida 120', '11900120012', v_group, '2001-01-01')
  returning id into v_resolvida;
  insert into public.leads (full_name, phone, distribution_group_id, created_at)
  values ('Lead Sem Dono 120', '11900120013', v_group, '2001-01-01')
  returning id into v_sem_dono;
  insert into public.leads (full_name, phone, distribution_group_id, created_at)
  values ('Lead Ativa 120', '11900120014', v_group, '2001-01-01')
  returning id into v_ativa;

  insert into public.sdr_conversations (lead_id, status) values (v_com_dono, 'active')
  returning id into v_conv;
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'human' where id = v_conv;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  insert into public.sdr_conversations (lead_id, status) values (v_resolvida, 'resolved');
  -- Humana sem dono é o que o webhook deixa quando o áudio falha ou a resolvida
  -- reabre: gravada sem sessão, o carimbo sai nulo.
  insert into public.sdr_conversations (lead_id, status) values (v_sem_dono, 'human');
  insert into public.sdr_conversations (lead_id, status) values (v_ativa, 'active');

  perform public.assign_queued_leads();

  -- Este assert cobrava a 0120 (humana com dono ficava fora da roleta, sem
  -- prazo). A 0121 voltou ao predicado da 0074: o SDR que assume não prende o
  -- lead, e ele chega a um corretor mesmo que a conversa seja esquecida.
  perform pg_temp.check120(
    (select status = 'assigned' from public.leads where id = v_com_dono),
    'lead de conversa assumida por um humano vai para a roleta: o SDR esquecer a conversa não encalha o lead');
  perform pg_temp.check120(
    (select status = 'queued' and assigned_to is null from public.leads where id = v_ativa),
    'lead de conversa ativa com o robô continua fora da roleta (0022)');
  perform pg_temp.check120(
    (select status = 'assigned' from public.leads where id = v_resolvida),
    'conversa resolvida libera o lead para a roleta');
  perform pg_temp.check120(
    (select status = 'assigned' from public.leads where id = v_sem_dono),
    'conversa humana sem dono não prende o lead para sempre');
end
$$;

\echo '== 4. quem lê a caixa =='

do $$
declare
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  sdr2 uuid := '00000000-0000-0000-0000-000001200003';
  mkt  uuid := '00000000-0000-0000-0000-000001200004';
  cor  uuid := '00000000-0000-0000-0000-000001200006';
  v_mkt       bigint;
  v_cor       bigint;
  v_nome_sdr  bigint;
  v_nome_cor  bigint;
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0120.rls', '5511900120040', 'Oi, vi o anúncio', 'unmatched');

  perform set_config('request.jwt.claims',
    json_build_object('sub', mkt::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_mkt from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0120.rls';
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_cor from public.whatsapp_inbound_messages where provider_message_id = 'wamid.0120.rls';
  select count(*) into v_nome_cor from public.sdr_operator_names where id = sdr2;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_nome_sdr from public.sdr_operator_names where id = sdr2;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(v_mkt = 1,
    'o marketing, que já opera as conversas, lê as mensagens recebidas');
  perform pg_temp.check120(v_cor = 0,
    'o corretor continua sem ler a caixa de mensagens recebidas');
  perform pg_temp.check120(v_nome_sdr = 1,
    'o SDR lê o nome de outro operador: é o que a tela escreve em "Humano · nome"');
  perform pg_temp.check120(v_nome_cor = 0,
    'o corretor não lê a lista de operadores');
end
$$;

\echo '== 5. o sino cobre o que agora entra na conversa =='

do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000001200001';
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  sdr2 uuid := '00000000-0000-0000-0000-000001200003';
  cor  uuid := '00000000-0000-0000-0000-000001200006';
  v_parado  uuid;
  v_lead_a  uuid;
  v_conv_a  uuid;
  v_lead_b  uuid;
  v_conv_b  uuid;
  v_lead_c  uuid;
  v_conv_c  uuid;
begin
  select id into v_parado from public.distribution_groups where slug = 'parado-120';

  -- (a) Áudio que não transcreveu: o webhook passa a conversa para humano sem
  -- dono. É o caso que antes ninguém ficava sabendo.
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Audio 120', '11900120051', v_parado)
  returning id into v_lead_a;
  insert into public.sdr_conversations (lead_id, status) values (v_lead_a, 'human')
  returning id into v_conv_a;
  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome, media_type)
  values ('wamid.0120.audio', '5511900120051', '[áudio não transcrito]', v_lead_a, v_conv_a, 'audio_falhou', 'audio');

  perform pg_temp.check120(
    exists (select 1 from public.notifications
             where profile_id = sdr1 and kind = 'whatsapp_human_turn'
               and body like '5511900120051%' and link = '/sdr?aba=conversas'),
    'o áudio que não transcreveu avisa o SDR, com o caminho da caixa');
  perform pg_temp.check120(
    exists (select 1 from public.notifications
             where profile_id = adm and kind = 'whatsapp_human_turn' and body like '5511900120051%'),
    'e o administrador, como o aviso de mensagem sem destino');
  perform pg_temp.check120(
    not exists (select 1 from public.notifications
                 where profile_id = cor and body like '5511900120051%'),
    'o corretor que não tem o lead não é avisado');

  -- (b) Conversa com dono: o aviso é dele, e só dele.
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Dono 120', '11900120052', v_parado)
  returning id into v_lead_b;
  insert into public.sdr_conversations (lead_id, status) values (v_lead_b, 'active')
  returning id into v_conv_b;
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  update public.sdr_conversations set status = 'human' where id = v_conv_b;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0120.dono.1', '5511900120052', 'Pode me ligar?', v_lead_b, v_conv_b, 'human_turn');

  perform pg_temp.check120(
    (select count(*) = 1 and bool_and(profile_id = sdr1) from public.notifications
      where kind = 'whatsapp_human_turn' and body like '5511900120052%'),
    'mensagem em conversa com dono avisa só o dono');

  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0120.dono.2', '5511900120052', 'Alô?', v_lead_b, v_conv_b, 'human_turn');

  perform pg_temp.check120(
    (select count(*) = 1 from public.notifications
      where kind = 'whatsapp_human_turn' and body like '5511900120052%'),
    'o dono recebe no máximo um aviso por conversa a cada 30 min');

  -- (c) Entregue a corretor: antes caía como unmatched e avisava o SDR; agora
  -- entra na conversa e continua avisando — e avisa também o corretor.
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Entregue Aviso 120', '11900120053', 'assigned', cor)
  returning id into v_lead_c;
  insert into public.sdr_conversations (lead_id, status, handed_off_at, handed_off_to)
  values (v_lead_c, 'handed_off', now(), cor)
  returning id into v_conv_c;
  insert into public.whatsapp_inbound_messages
    (provider_message_id, from_phone, body, lead_id, conversation_id, outcome)
  values ('wamid.0120.entregue', '5511900120053', 'Ainda tem unidade?', v_lead_c, v_conv_c, 'human_turn');

  perform pg_temp.check120(
    exists (select 1 from public.notifications
             where profile_id = sdr1 and kind = 'whatsapp_human_turn' and body like '5511900120053%')
    and exists (select 1 from public.notifications
                 where profile_id = sdr2 and kind = 'whatsapp_human_turn' and body like '5511900120053%'),
    'mensagem em conversa entregue avisa o SDR, como o unmatched avisava');
  perform pg_temp.check120(
    exists (select 1 from public.notifications
             where profile_id = cor and kind = 'whatsapp_human_turn'
               and body like '5511900120053%' and link = '/leads?lead=' || v_lead_c::text),
    'e o corretor do lead, com o link do lead: ele não abre /sdr');

  -- (d) Sem lead: a caixa agora existe, e o aviso aponta para ela.
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome)
  values ('wamid.0120.semlead', '5511900120054', 'Oi', 'unmatched');

  perform pg_temp.check120(
    (select bool_and(body like '%"Sem lead"%' and body not like '%ainda não há caixa%')
       from public.notifications
      where profile_id = sdr1 and kind = 'whatsapp_unmatched' and body like '5511900120054%'),
    'o aviso de mensagem sem destino aponta a seção "Sem lead" e não diz mais que não há caixa');
end
$$;

\echo '== 6. "Sem lead": lista por telefone e marcar como resolvido =='

do $$
declare
  sdr1 uuid := '00000000-0000-0000-0000-000001200002';
  dir  uuid := '00000000-0000-0000-0000-000001200005';
  cor  uuid := '00000000-0000-0000-0000-000001200006';
  v_conv        uuid;
  v_pendentes   int;
  v_ultima      text;
  v_midia       text;
  v_de_conversa bigint;
  v_dir_ve      bigint;
  v_dir_barrado boolean := false;
  v_cor_barrado boolean := false;
  v_marcadas    int;
  v_sobrou      bigint;
begin
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome, created_at)
  values ('wamid.0120.sl.1', '5511900120060', 'Bom dia', 'unmatched', now() - interval '10 minutes');
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, outcome, media_type)
  values ('wamid.0120.sl.2', '5511900120060', '[áudio]', 'unmatched', 'audio');

  -- Mensagem que entrou numa conversa é da lista principal, não de "Sem lead".
  select c.id into v_conv from public.sdr_conversations c
    join public.leads l on l.id = c.lead_id
   where l.phone like '%11900120052';
  insert into public.whatsapp_inbound_messages (provider_message_id, from_phone, body, conversation_id, outcome)
  values ('wamid.0120.sl.3', '5511900120061', 'Oi', v_conv, 'sdr_turn');

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select u.pendentes, u.ultima_mensagem, u.media_type into v_pendentes, v_ultima, v_midia
    from public.whatsapp_inbox_unmatched() u where u.from_phone = '5511900120060';
  select count(*) into v_de_conversa
    from public.whatsapp_inbox_unmatched() u where u.from_phone = '5511900120061';
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', dir::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into v_dir_ve
    from public.whatsapp_inbox_unmatched() u where u.from_phone = '5511900120060';
  begin
    perform public.whatsapp_inbound_resolve_phone('5511900120060');
  exception when insufficient_privilege then
    v_dir_barrado := true;
  end;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.whatsapp_inbound_resolve_phone('5511900120060');
  exception when insufficient_privilege then
    v_cor_barrado := true;
  end;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr1::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_marcadas := public.whatsapp_inbound_resolve_phone('5511900120060');
  select count(*) into v_sobrou
    from public.whatsapp_inbox_unmatched() u where u.from_phone = '5511900120060';
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check120(v_pendentes = 2 and v_ultima = '[áudio]' and v_midia = 'audio',
    'a lista agrupa por telefone, conta as pendentes e mostra a última mensagem com a mídia');
  perform pg_temp.check120(v_de_conversa = 0,
    'mensagem que entrou numa conversa não aparece em "Sem lead"');
  perform pg_temp.check120(v_dir_ve = 1, 'o diretor lê a lista');
  perform pg_temp.check120(v_dir_barrado,
    'mas marcar como resolvido recusa o diretor com 42501');
  perform pg_temp.check120(v_cor_barrado, 'e recusa o corretor com 42501');
  perform pg_temp.check120(v_marcadas = 2, 'o SDR marca as duas mensagens do telefone');
  perform pg_temp.check120(
    (select bool_and(handled_by = sdr1 and handled_at is not null)
       from public.whatsapp_inbound_messages where from_phone = '5511900120060'),
    'marcar como resolvido grava o próprio usuário em handled_by');
  perform pg_temp.check120(v_sobrou = 0, 'o telefone resolvido sai da lista');
end
$$;

-- -----------------------------------------------------------------------------
-- Limpeza: os avisos saem para TODO sdr/admin ativo do banco, inclusive os de
-- outros arquivos, e não podem ficar no sino deles.
-- -----------------------------------------------------------------------------
do $$
begin
  delete from public.notifications
   where kind in ('whatsapp_human_turn', 'whatsapp_unmatched')
     and body like '5511900120%';
  delete from public.whatsapp_inbound_messages where provider_message_id like 'wamid.0120.%';
end
$$;

\echo '0120 ok'
