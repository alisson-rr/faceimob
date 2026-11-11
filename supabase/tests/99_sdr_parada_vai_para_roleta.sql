-- 0330 — conversa da IA parada há 24 h: lead de compra vai para a roleta;
-- candidato fica onde está; conversa recente continua com a IA.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  v_ana uuid; v_luna uuid;
  l_parada uuid; l_recente uuid; l_cand uuid;
  c_parada uuid; c_recente uuid; c_cand uuid;
begin
  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra) values ('Ana 330', 'p', true, true) returning id into v_ana;
  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra) values ('Luna 330', 'p', true, false) returning id into v_luna;

  insert into public.leads (full_name, phone, status, created_at) values ('Parada', '51900330001', 'queued', now() - interval '30 days') returning id into l_parada;
  insert into public.sdr_conversations (lead_id, agent_id, status, started_at, last_message_at)
  values (l_parada, v_ana, 'active', now() - interval '30 days', now() - interval '25 hours') returning id into c_parada;

  insert into public.leads (full_name, phone, status, created_at) values ('Recente', '51900330002', 'queued', now() - interval '2 days') returning id into l_recente;
  insert into public.sdr_conversations (lead_id, agent_id, status, started_at, last_message_at)
  values (l_recente, v_ana, 'active', now() - interval '2 days', now() - interval '2 hours') returning id into c_recente;

  insert into public.leads (full_name, phone, status, created_at) values ('Candidato', '51900330003', 'queued', now() - interval '30 days') returning id into l_cand;
  insert into public.sdr_conversations (lead_id, agent_id, status, started_at, last_message_at)
  values (l_cand, v_luna, 'active', now() - interval '30 days', now() - interval '25 hours') returning id into c_cand;

  perform public.assign_queued_leads();

  perform pg_temp.ok((select status = 'handed_off' from public.sdr_conversations where id = c_parada),
    'conversa da IA parada há 24 h é entregue à roleta');
  perform pg_temp.ok((select status in ('queued', 'assigned') from public.leads where id = l_parada),
    'o lead de compra parado segue para a roleta (na fila ou com corretor)');
  perform pg_temp.ok((select status = 'active' from public.sdr_conversations where id = c_recente)
    and (select status = 'queued' and assigned_to is null from public.leads where id = l_recente),
    'conversa com mensagem nas últimas 24 h continua com a IA');
  perform pg_temp.ok((select status = 'active' from public.sdr_conversations where id = c_cand)
    and (select status = 'queued' and assigned_to is null from public.leads where id = l_cand),
    'candidato não vai para a roleta: fica onde está');
end;
$$;

rollback;
