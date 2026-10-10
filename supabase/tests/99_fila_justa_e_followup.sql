-- =============================================================================
-- 0263 — quem volta de uma vez entra no fim da fila (caso Julia, 10/10/2026);
-- follow-up 1 h / 23 h, arquivo em 24 h, candidato fora da base, retomada.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

update public.automation_settings set leads_recomeco_em = null, leads_paused = false;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  pedro uuid := '00000000-0000-0000-0000-000002630001';
  julia uuid := '00000000-0000-0000-0000-000002630002';
  v_group uuid;
  v_shift uuid;
  v_lead uuid;
  v_luna uuid;
  v_ana uuid;
  v_conv uuid;
  v_cand uuid;
  v_conv_cand uuid;
  v_n int;
begin
  -- FILA ---------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (pedro, 'pedro@f263.test', '{"full_name":"Pedro 263"}'),
    (julia, 'julia@f263.test', '{"full_name":"Julia 263"}');
  insert into public.user_roles (profile_id, role) values (pedro, 'broker'), (julia, 'broker') on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active)
    values ('Roleta 263', 'roleta-263', 'specific', true) returning id into v_group;
  insert into public.distribution_group_members (group_id, profile_id, active)
    values (v_group, pedro, true), (v_group, julia, true);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
    values ('teste-263', 'Integral 263', '00:00', '00:00', '23:59:59.999999', -263) returning id into v_shift;
  -- Pedro entrou antes e recebeu um lead logo; Julia entrou depois e nunca recebeu.
  insert into public.checkins (profile_id, shift_id, work_date, checked_in_at) values
    (pedro, v_shift, public.current_work_date(), now() - interval '3 hours'),
    (julia, v_shift, public.current_work_date(), now() - interval '2 hours 50 minutes');
  insert into public.leads (full_name, phone, distribution_group_id, status)
    values ('Lead 263', '11900263001', v_group, 'in_progress') returning id into v_lead;
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, assigned_at, deadline, responded_at, counts_for_queue)
    values (v_lead, pedro, v_group, 1, now() - interval '2 hours 55 minutes', now(), now() - interval '10 minutes', true);

  perform pg_temp.ok(
    (select profile_id from public.distribution_queue_interna(v_group) where queue_position = 1) = julia,
    'quem atendeu volta para o fim: Julia (nunca recebeu) fica à frente do Pedro');

  -- AGENTES E CONVERSAS ----------------------------------------------------------
  insert into public.sdr_agents (name, system_prompt, active, lead_de_compra)
    values ('Luna 263', 'p', true, false) returning id into v_luna;
  insert into public.sdr_agents (name, system_prompt, active)
    values ('Ana 263', 'p', true) returning id into v_ana;

  insert into public.leads (full_name, phone, status) values ('Comprador 263', '51900263001', 'queued') returning id into v_lead;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (v_lead, v_ana, 'active') returning id into v_conv;
  insert into public.sdr_messages (conversation_id, author, body, created_at) values
    (v_conv, 'lead', 'oi', now() - interval '90 minutes'),
    (v_conv, 'agent', 'Qual sua renda?', now() - interval '89 minutes');

  perform pg_temp.ok((select count(*) from public.sdr_reservar_followups() where etapa = 1) = 1,
    'sem resposta há 1 h: follow-up 1 reservado');
  perform pg_temp.ok((select count(*) from public.sdr_reservar_followups()) = 0,
    'a reserva não manda o mesmo follow-up duas vezes');

  insert into public.sdr_messages (conversation_id, author, body) values (v_conv, 'lead', 'uns 4 mil');
  perform pg_temp.ok((select followup_stage from public.sdr_conversations where id = v_conv) = 0,
    'o lead respondeu: a etapa do follow-up zera');

  -- 24 h sem resposta: arquiva; lead de compra vai para a base.
  delete from public.sdr_messages where conversation_id = v_conv;
  insert into public.sdr_messages (conversation_id, author, body, created_at) values
    (v_conv, 'lead', 'oi', now() - interval '25 hours'),
    (v_conv, 'agent', 'Qual sua renda?', now() - interval '25 hours' + interval '1 minute');

  insert into public.leads (full_name, phone, status) values ('Candidato 263', '51900263002', 'queued') returning id into v_cand;
  insert into public.sdr_conversations (lead_id, agent_id, status) values (v_cand, v_luna, 'active') returning id into v_conv_cand;
  insert into public.sdr_messages (conversation_id, author, body, created_at) values
    (v_conv_cand, 'lead', 'quero a vaga', now() - interval '25 hours'),
    (v_conv_cand, 'agent', 'Qual unidade?', now() - interval '25 hours' + interval '1 minute');

  v_n := public.sdr_arquivar_sem_resposta();
  perform pg_temp.ok(v_n = 2, format('arquiva as duas conversas paradas há 24 h (%s)', v_n));
  perform pg_temp.ok((select status from public.sdr_conversations where id = v_conv) = 'abandoned',
    'conversa arquivada sai da caixa');
  perform pg_temp.ok((select status from public.leads where id = v_lead) = 'lost',
    'lead de compra sem resposta vai para a base');
  perform pg_temp.ok((select status from public.leads where id = v_cand) = 'discarded',
    'candidato sem resposta não entra na base');

  -- Voltou a escrever: retoma com o robô e o lead volta para a fila.
  perform pg_temp.ok(public.sdr_retomar_conversa(v_conv), 'conversa arquivada é retomada');
  perform pg_temp.ok((select status from public.sdr_conversations where id = v_conv) = 'active'
    and (select status from public.leads where id = v_lead) = 'queued',
    'robô volta a atender e o lead sai da base');

  -- Candidato fora do perfil também vai para descartado.
  update public.leads set status = 'queued', lost_reason = null where id = v_cand;
  perform public.sdr_tirar_lead_da_fila(v_conv_cand, 'SDR IA: fora do perfil');
  perform pg_temp.ok((select status from public.leads where id = v_cand) = 'discarded',
    'candidato fora do perfil vai para descartado');
end;
$$;

rollback;
