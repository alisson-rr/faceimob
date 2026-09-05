-- =============================================================================
-- 64 · SDR (migration 0064): porta do handoff, motivo honesto, conversa
--      assumida por humano, encadeamento sem ciclo e fila geral protegida.
--
-- O que cada asserção defende:
--   · `sdr_handoff` era executável por QUALQUER authenticated — corretor
--     conseguia devolver conversa alheia à roleta e carimbar o funil.
--   · handoff por esgotamento de turnos não pode virar 'qualified' no funil.
--   · o status 'human' precisa existir para o robô calar (o
--     whatsapp-inbound-webhook só atende conversa 'active').
--   · cadeia A→B→A prende o lead girando entre dois agentes.
--   · excluir a última fila geral ativa quebra sdr_handoff e assign_lead.
--   · o papel `sdr` precisa ler o lead da conversa que ele já enxerga.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check64(cond boolean, label text)
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

do $$
declare
  sdr_id    uuid := '00000000-0000-0000-0000-00000000f641';
  broker_id uuid := '00000000-0000-0000-0000-00000000f642';
  agente_a  uuid;
  agente_b  uuid;
  grupo     uuid;
  v_lead    uuid;
  v_conv    uuid;
  v_stage   lead_funnel_stage;
  n         int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (sdr_id,    'sdr@t64.test',    '{"full_name":"SDR T64"}'),
    (broker_id, 'broker@t64.test', '{"full_name":"Corretor T64"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values
    (sdr_id, 'sdr'), (broker_id, 'broker')
  on conflict do nothing;

  insert into public.sdr_agents (name, role) values ('Agente A T64', 'qualifier')
  returning id into agente_a;
  insert into public.sdr_agents (name, role, max_turns) values ('Agente B T64', 'handoff', 2)
  returning id into agente_b;

  -- ---------------------------------------------------------------------------
  -- 4. Ciclo de handoff: A→B é válido; B→A fecharia o laço.
  -- ---------------------------------------------------------------------------
  update public.sdr_agents set handoff_to_agent_id = agente_b where id = agente_a;
  perform pg_temp.check64(
    (select handoff_to_agent_id from public.sdr_agents where id = agente_a) = agente_b,
    'encadeamento A→B é aceito');

  begin
    update public.sdr_agents set handoff_to_agent_id = agente_a where id = agente_b;
    raise exception 'FALHOU: ciclo A→B→A foi aceito';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  ciclo A→B→A é recusado pelo trigger';
  end;

  begin
    update public.sdr_agents set handoff_to_agent_id = agente_a where id = agente_a;
    raise exception 'FALHOU: agente delegando para si mesmo foi aceito';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  agente não delega para ele mesmo';
  end;

  -- ---------------------------------------------------------------------------
  -- Cenário do handoff: fila geral, lead e conversa.
  -- ---------------------------------------------------------------------------
  select g.id into grupo from public.distribution_groups g
  where g.kind = 'general' and g.active limit 1;
  if grupo is null then
    insert into public.distribution_groups (name, slug, kind)
    values ('Fila Geral T64', 'fila-geral-t64', 'general')
    returning id into grupo;
  end if;

  insert into public.leads (full_name, phone, status, funnel_stage, utm_source)
  values ('Lead T64', '11966660064', 'queued', 'new', 'meta_t64')
  returning id into v_lead;

  insert into public.sdr_conversations (lead_id, agent_id)
  values (v_lead, agente_b)
  returning id into v_conv;

  -- ---------------------------------------------------------------------------
  -- 3. Status 'human' — o operador assume e o robô cala.
  -- ---------------------------------------------------------------------------
  update public.sdr_conversations set status = 'human' where id = v_conv;
  perform pg_temp.check64(
    (select status from public.sdr_conversations where id = v_conv) = 'human',
    'conversa aceita o status human (robô para de responder)');
  update public.sdr_conversations set status = 'active' where id = v_conv;

  -- ---------------------------------------------------------------------------
  -- 1. Porta do handoff: corretor logado não devolve conversa à roleta.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', broker_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.sdr_handoff(v_conv);
    raise exception 'FALHOU: corretor executou sdr_handoff';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor não executa sdr_handoff (42501)';
    when sqlstate 'P0001' then
      if sqlerrm like 'FALHOU%' then raise; end if;
      raise;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);

  perform pg_temp.check64(
    (select status from public.sdr_conversations where id = v_conv) = 'active',
    'a conversa recusada continua ativa');

  -- ---------------------------------------------------------------------------
  -- 2. Teto de turnos: devolve o lead SEM dizer que ele foi qualificado.
  -- ---------------------------------------------------------------------------
  perform public.sdr_handoff(v_conv, 'exhausted');

  select funnel_stage into v_stage from public.leads where id = v_lead;
  perform pg_temp.check64(v_stage = 'new',
    'handoff por esgotamento não carimba o funil como qualificado');
  perform pg_temp.check64(
    (select sdr_qualified_at is null from public.leads where id = v_lead),
    'handoff por esgotamento não carimba sdr_qualified_at');
  perform pg_temp.check64(
    exists (select 1 from public.lead_events
            where lead_id = v_lead and kind = 'sdr_qualified'
              and detail->>'reason' = 'exhausted'),
    'o motivo do handoff fica no log do lead');
  perform pg_temp.check64(
    (select status from public.sdr_conversations where id = v_conv) = 'handed_off',
    'a conversa é encerrada como handed_off');
  perform pg_temp.check64(
    (select qualified_at is null from public.sdr_conversations where id = v_conv),
    'conversa esgotada não ganha qualified_at');

  -- Qualificação de verdade avança o funil.
  insert into public.leads (full_name, phone, status, funnel_stage, utm_source)
  values ('Lead T64 qualificado', '11966660065', 'queued', 'new', 'meta_t64')
  returning id into v_lead;
  insert into public.sdr_conversations (lead_id, agent_id, score)
  values (v_lead, agente_b, 77)
  returning id into v_conv;

  perform public.sdr_handoff(v_conv, 'qualified');
  select funnel_stage into v_stage from public.leads where id = v_lead;
  perform pg_temp.check64(v_stage = 'qualified',
    'handoff por qualificação avança o funil para qualified');
  perform pg_temp.check64(
    (select sdr_qualified_at is not null from public.leads where id = v_lead),
    'handoff por qualificação carimba sdr_qualified_at');

  -- ---------------------------------------------------------------------------
  -- 6. O papel `sdr` lê o lead da conversa (sem ganhar a fila inteira).
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  select count(*) into n from public.leads where id = v_lead;
  perform pg_temp.check64(n = 1, 'sdr enxerga o lead que tem conversa de SDR');

  reset role;
  perform set_config('request.jwt.claims', '', false);

  insert into public.leads (full_name, phone, status, funnel_stage)
  values ('Lead T64 sem conversa', '11966660066', 'queued', 'new')
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', sdr_id::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  select count(*) into n from public.leads where id = v_lead;
  perform pg_temp.check64(n = 0, 'sdr NÃO passa a enxergar a fila inteira de leads');
  reset role;
  perform set_config('request.jwt.claims', '', false);

  -- ---------------------------------------------------------------------------
  -- 5. A última fila geral ativa não sai. O bloco desfaz o cenário no rollback
  --    do subtransaction, então nenhum grupo real é tocado.
  -- ---------------------------------------------------------------------------
  begin
    update public.distribution_groups set active = false
     where kind = 'general' and id <> grupo;
    delete from public.distribution_groups where id = grupo;
    raise exception 'FALHOU: a última fila geral ativa foi excluída';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  a última fila geral ativa não pode ser excluída';
  end;

  perform pg_temp.check64(
    exists (select 1 from public.distribution_groups where id = grupo and active),
    'a fila geral continua ativa depois da tentativa');
end;
$$;

\echo 'SDR automação (0064) ok'
