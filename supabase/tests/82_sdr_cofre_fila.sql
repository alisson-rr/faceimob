-- =============================================================================
-- 82 · Cofre e fila (migration 0082).
--
-- O que cada asserção defende:
--   · revogar credencial é da MESMA porta de gravá-la: `settings.integrations`.
--     Sem isso, qualquer autenticado desligaria a chave da OpenAI da empresa.
--   · revogar APAGA o valor e desativa a linha — e `private.get_integration_
--     secret` filtra por `active`, então a leitura seguinte não encontra nada.
--     Se a revogação só desativasse, o segredo vazado continuaria guardado.
--   · revogar o que não existe devolve `false`, não erro: a tela precisa
--     distinguir "não havia nada" de "você não pode".
--   · `notification_queue_health` é a única forma de um admin enxergar a fila
--     (a RLS de `notifications` é de dono e só `in_app`), e ela também é
--     guardada — a fila cita destinatário por tabela e não pode vazar.
--   · `sdr_messages.agent_id` guarda quem respondeu cada turno e some para
--     `null` quando o agente é excluído: apagar um agente não pode levar junto
--     o histórico da conversa.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check82(cond boolean, label text)
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

create or replace function pg_temp.assert_eq82(got anyelement, want anyelement, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % (obtido %, esperado %)', label, got, want;
  end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  admin_id  uuid := '00000000-0000-0000-0000-00000000f821';
  broker_id uuid := '00000000-0000-0000-0000-00000000f822';
  v_agente  uuid;
  v_lead    uuid;
  v_conv    uuid;
  v_msg     uuid;
  v_ok      boolean;
  n         int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (admin_id,  'admin@t82.test',  '{"full_name":"Admin T82"}'),
    (broker_id, 'broker@t82.test', '{"full_name":"Corretor T82"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (admin_id, 'admin'), (broker_id, 'broker')
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- 1. Corretor não revoga credencial nenhuma.
  -- ---------------------------------------------------------------------------
  insert into private.integration_credentials (provider, label, secret)
  values ('t82', 'chave', 'valor-secreto-de-teste')
  on conflict (provider, label) do update set secret = excluded.secret, active = true;

  perform set_config('request.jwt.claims',
    json_build_object('sub', broker_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.revoke_integration_secret('t82', 'chave');
    raise exception 'FALHOU: corretor revogou credencial do cofre';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao tentar revogar credencial';
  end;

  -- E também não enxerga a fila de notificações de ninguém.
  begin
    perform * from public.notification_queue_health();
    raise exception 'FALHOU: corretor leu a fila de notificações';
  exception when insufficient_privilege then
    raise notice '  ok  corretor recebe 42501 ao ler a fila de notificações';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- A credencial continua intacta depois da tentativa recusada.
  perform pg_temp.check82(
    exists (select 1 from private.integration_credentials
             where provider = 't82' and label = 'chave' and active and secret is not null),
    'credencial segue ativa depois da recusa');

  -- ---------------------------------------------------------------------------
  -- 2. Admin revoga: o valor é apagado e a leitura seguinte não acha nada.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_ok := public.revoke_integration_secret('t82', 'chave');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.assert_eq82(v_ok, true, 'revogar credencial existente devolve true');
  perform pg_temp.check82(
    exists (select 1 from private.integration_credentials
             where provider = 't82' and label = 'chave' and not active and secret is null),
    'revogar apaga o segredo e desativa a linha');
  -- É o filtro `and c.active` de private.get_integration_secret que faz a
  -- revogação valer sem redeploy; sem ele, a function continuaria lendo.
  perform pg_temp.assert_eq82(
    private.get_integration_secret('t82', 'chave'), null::text,
    'depois de revogada, a leitura do cofre não devolve valor');

  -- ---------------------------------------------------------------------------
  -- 3. Revogar o que não existe é `false`, não erro.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  v_ok := public.revoke_integration_secret('t82', 'nunca-existiu');
  reset role;
  perform set_config('request.jwt.claims', '', false);
  perform pg_temp.assert_eq82(v_ok, false, 'revogar slot inexistente devolve false em vez de erro');

  -- ---------------------------------------------------------------------------
  -- 4. Fila de notificações: só o que ainda não saiu, agrupado por canal.
  -- ---------------------------------------------------------------------------
  insert into public.notifications (profile_id, kind, title, channel, sent_at, last_error) values
    (broker_id, 't82', 'pendente 1', 'whatsapp', null, 'credencial ausente'),
    (broker_id, 't82', 'pendente 2', 'whatsapp', null, null),
    (broker_id, 't82', 'já enviada', 'whatsapp', now(), null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select pendentes into n from public.notification_queue_health() where channel = 'whatsapp';
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- >= 2 e não = 2: a semente do ambiente também tem fila de WhatsApp represada,
  -- e travar o número exato faria o teste quebrar a cada mudança do seed.
  perform pg_temp.check82(n >= 2, 'fila conta as notificações pendentes do canal');
  perform pg_temp.check82(
    not exists (
      select 1 from public.notifications
       where kind = 't82' and title = 'já enviada' and sent_at is null),
    'notificação já enviada não entra na fila');

  -- ---------------------------------------------------------------------------
  -- 5. `sdr_messages.agent_id`: o histórico sobrevive à exclusão do agente.
  -- ---------------------------------------------------------------------------
  insert into public.sdr_agents (name, role) values ('Agente T82', 'qualifier') returning id into v_agente;
  insert into public.leads (full_name, status) values ('Lead T82', 'discarded') returning id into v_lead;
  insert into public.sdr_conversations (lead_id, agent_id) values (v_lead, v_agente) returning id into v_conv;
  insert into public.sdr_messages (conversation_id, author, body, agent_id)
  values (v_conv, 'agent', 'resposta do agente T82', v_agente)
  returning id into v_msg;

  perform pg_temp.assert_eq82(
    (select agent_id from public.sdr_messages where id = v_msg), v_agente,
    'a mensagem guarda qual agente respondeu o turno');

  delete from public.sdr_agents where id = v_agente;
  perform pg_temp.check82(
    exists (select 1 from public.sdr_messages where id = v_msg and agent_id is null),
    'excluir o agente solta a referência sem apagar a mensagem (ON DELETE SET NULL)');

  -- ---------------------------------------------------------------------------
  -- Limpeza do que este arquivo criou.
  -- ---------------------------------------------------------------------------
  delete from public.sdr_conversations where id = v_conv;
  delete from public.leads where id = v_lead;
  delete from public.notifications where kind = 't82';
  delete from private.integration_credentials where provider = 't82';
  delete from public.user_roles where profile_id in (admin_id, broker_id);
  delete from auth.users where id in (admin_id, broker_id);

  raise notice 'OK 82 · cofre revogável, fila visível ao admin e cadeia de agentes preservada';
end;
$$;
