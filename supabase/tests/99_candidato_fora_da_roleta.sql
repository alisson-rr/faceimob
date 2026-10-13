-- 0272 — candidato a corretor nunca é entregue pela roleta de leads: nem com a
-- conversa da Luna humana sem dono, nem vindo de origem de vaga; antes de 15 min
-- ou com a Luna ativa, espera; a entrega da Luna completa o candidato aberto.
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
  v_luna uuid; v_ana uuid; v_origem uuid;
  l_humana uuid; l_origem uuid; l_ativa uuid; l_nova uuid; l_compra uuid;
  c_humana uuid; c_ativa uuid; c_luna uuid;
  v_ret uuid; v_n int;
begin
  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra) values ('Luna 272', 'p', true, false) returning id into v_luna;
  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra) values ('Ana 272', 'p', true, true) returning id into v_ana;
  insert into public.lead_sources (code, label, sdr_agent_id) values ('vaga_t272', 'Vaga T272', v_luna) returning id into v_origem;

  -- (1) conversa da Luna humana, sem dono: era o buraco do dreno
  insert into public.leads (full_name, phone, status, created_at) values ('Humana', '51900272001', 'queued', now() - interval '30 minutes') returning id into l_humana;
  insert into public.sdr_conversations (lead_id, agent_id, status, collected) values (l_humana, v_luna, 'human', '{"Nome":"Humana","Unidade":"Zona Norte"}') returning id into c_humana;
  v_ret := public.assign_lead(l_humana);
  perform pg_temp.ok(v_ret is null, 'a roleta não entrega o candidato de conversa humana');
  perform pg_temp.ok((select status = 'discarded' from public.leads where id = l_humana), 'o lead sai das telas de leads');
  perform pg_temp.ok(exists (select 1 from public.candidatos where lead_id = l_humana and zona = 'norte'), 'vira candidato disponível, com a zona');
  perform pg_temp.ok((select status = 'human' from public.sdr_conversations where id = c_humana), 'a conversa não muda de status');

  -- (2) origem de vaga, sem conversa: vira candidato; a Luna depois completa o mesmo
  insert into public.leads (full_name, phone, status, source_id, created_at) values ('Da vaga', '51900272002', 'queued', v_origem, now() - interval '30 minutes') returning id into l_origem;
  perform public.assign_lead(l_origem);
  perform pg_temp.ok(exists (select 1 from public.candidatos where lead_id = l_origem and conversation_id is null), 'origem de vaga sem conversa vira candidato');
  insert into public.sdr_conversations (lead_id, agent_id, status, score, collected) values (l_origem, v_luna, 'active', 80, '{"Nome":"Da Vaga","Unidade":"Zona Sul"}') returning id into c_luna;
  perform public.sdr_virar_candidato(c_luna);
  select count(*) into v_n from public.candidatos where lead_id = l_origem;
  perform pg_temp.ok(v_n = 1, 'a entrega da Luna completa o candidato, sem duplicar');
  perform pg_temp.ok((select conversation_id = c_luna and zona = 'sul' and score = 80 from public.candidatos where lead_id = l_origem), 'o candidato ganha a conversa, a zona e a nota');

  -- (3) Luna ainda conversando: espera
  insert into public.leads (full_name, phone, status, created_at) values ('Ativa', '51900272003', 'queued', now() - interval '30 minutes') returning id into l_ativa;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (l_ativa, v_luna, 'active') returning id into c_ativa;
  perform public.assign_lead(l_ativa);
  perform pg_temp.ok((select status = 'queued' from public.leads where id = l_ativa) and not exists (select 1 from public.candidatos where lead_id = l_ativa), 'com a Luna ativa o lead espera');

  -- (4) recém-chegado de origem de vaga: espera a conversa abrir
  insert into public.leads (full_name, phone, status, source_id) values ('Novo', '51900272004', 'queued', v_origem) returning id into l_nova;
  perform public.assign_lead(l_nova);
  perform pg_temp.ok((select status = 'queued' from public.leads where id = l_nova) and not exists (select 1 from public.candidatos where lead_id = l_nova), 'antes de 15 minutos espera, sem virar candidato');

  -- (5) lead de compra segue o caminho de sempre
  insert into public.leads (full_name, phone, status, created_at) values ('Compra', '51900272005', 'queued', now() - interval '30 minutes') returning id into l_compra;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (l_compra, v_ana, 'human');
  perform public.assign_lead(l_compra);
  perform pg_temp.ok(not exists (select 1 from public.candidatos where lead_id = l_compra), 'lead de compra não vira candidato');
end;
$$;

rollback;
