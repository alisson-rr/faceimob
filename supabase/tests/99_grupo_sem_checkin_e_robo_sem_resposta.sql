-- =============================================================================
-- 0260 — grupo que dispensa check-in entrega a quem não fez check-in; canal do
-- grupo validado. 0262 — a entrega por silêncio saiu.
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
  rh uuid := '00000000-0000-0000-0000-000002600001';
  v_group uuid;
  v_agent uuid;
  v_lead uuid;
  v_conv uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (rh, 'rh@g260.test', '{"full_name":"Gerente RH 260"}');
  insert into public.user_roles (profile_id, role) values (rh, 'manager') on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active, channels)
    values ('RH 260', 'rh-260', 'specific', true, array['whatsapp']) returning id into v_group;
  insert into public.distribution_group_members (group_id, profile_id, active) values (v_group, rh, true);

  -- Sem check-in e com o grupo exigindo: ninguém na fila.
  perform pg_temp.ok((select count(*) from public.distribution_queue_interna(v_group)) = 0,
    'grupo comum sem check-in não entrega');

  update public.distribution_groups set deliver_without_checkin = true where id = v_group;
  perform pg_temp.ok((select profile_id from public.distribution_queue_interna(v_group)) = rh,
    'grupo que dispensa check-in entrega a quem não fez check-in');

  insert into public.sdr_agents (name, system_prompt, handoff_group_id, active)
    values ('Agente 260', 'teste', v_group, true) returning id into v_agent;
  insert into public.leads (full_name, phone, status) values ('Lead 260', '51999990260', 'queued') returning id into v_lead;
  insert into public.sdr_conversations (lead_id, agent_id, status, started_at, last_message_at)
    values (v_lead, v_agent, 'active', now() - interval '2 hours', now() - interval '40 minutes') returning id into v_conv;

  -- 0262: conversa parada não é mais entregue sozinha.
  perform pg_temp.ok(to_regprocedure('public.sdr_entregar_sem_resposta()') is null,
    'entrega por silêncio não existe mais (0262)');

  perform public.sdr_handoff(v_conv, 'qualified');
  perform pg_temp.ok((select assigned_to from public.leads where id = v_lead) = rh,
    'lead qualificado vai para o membro do grupo do agente, sem check-in');

  begin
    update public.distribution_groups set channels = array['email'] where id = v_group;
    raise exception 'FALHOU: canal desconhecido devia ser recusado';
  exception when check_violation then
    raise notice '  ok  canal fora de formulário/WhatsApp é recusado';
  end;
end;
$$;

rollback;
