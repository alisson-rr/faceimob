-- 0280 — notificação de repasse, destino pessoal e invariantes da roleta.
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
  a uuid := '00000000-0000-0000-0000-000002800001';
  b uuid := '00000000-0000-0000-0000-000002800002';
  v_lead uuid; v_lead2 uuid; v_row public.leads; v_n int; v_det jsonb; v_bnomes int; v_turnos jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@a280.test', '{"full_name":"Ana 275"}'),
    (b, 'b@a280.test', '{"full_name":"Bia 275"}');

  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, attend_deadline)
    values ('Lead 275', '5511999275001', 'assigned', a, now(), now() + interval '10 minutes')
    returning id into v_lead;

  update public.automation_settings set notify_on_assign = true where id;
  -- Histórico que já definiu a vez dos dois corretores. O repasse não o toca.
  insert into public.lead_assignments
    (lead_id, profile_id, sequence, deadline, responded_at, released_at, release_reason, counts_for_queue)
  values (v_lead, a, 1, now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour', 'reassigned', true),
         (v_lead, b, 2, now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes', 'reassigned', true);
  delete from public.notifications where link = '/leads?lead=' || v_lead;
  update public.leads set status = 'in_progress', funnel_stage = 'hot',
    first_contact_at = now() - interval '1 day', next_action_at = now() + interval '2 days'
    where id = v_lead;
  select jsonb_agg(to_jsonb(la) order by la.id) into v_turnos
    from public.lead_assignments la where la.profile_id in (a, b) and la.counts_for_queue;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reassign_lead(v_lead, b);
  reset role;

  select * into v_row from public.leads where id = v_lead;
  perform pg_temp.ok(v_row.assigned_to = b, 'o lead vai direto para o novo corretor');
  perform pg_temp.ok(v_row.status = 'assigned', 'continua aguardando o novo corretor pegar');
  perform pg_temp.ok(v_row.attend_deadline is null, 'sem cronômetro de atendimento');
  perform pg_temp.ok(v_row.next_action_at > now(), 'só fica atrasado se ninguém tratar (próximo contato no futuro)');

  perform pg_temp.ok(v_row.funnel_stage = 'hot' and v_row.first_contact_at = now() - interval '1 day'
    and v_row.next_action_at = now() + interval '2 days', 'preserva etapa, contato e próximo contato futuro');
  perform pg_temp.ok((select count(*) = 1 from public.lead_assignments
    where lead_id = v_lead and profile_id = b and released_at is null
      and not counts_for_queue and responded_at is not null), 'repasse sem vez na roleta e sem trava');
  perform pg_temp.ok(v_turnos is not distinct from
    (select jsonb_agg(to_jsonb(la) order by la.id) from public.lead_assignments la
      where la.profile_id in (a, b) and la.counts_for_queue), 'não altera turnos ou posição de nenhum corretor');
  perform pg_temp.ok((select count(*) = 2 from public.notifications
    where link = '/leads?lead=' || v_lead and kind = 'lead_reassigned' and profile_id = b),
    'um aviso no sino e um no WhatsApp somente para quem recebeu');
  perform pg_temp.ok((select count(distinct channel) = 2 and bool_and(body like '%Ana 275%'
    and body like '%sem cronômetro%' and body not like '%Você tem até%' and body not like '%Atenda em até%')
    from public.notifications where link = '/leads?lead=' || v_lead and kind = 'lead_reassigned'),
    'aviso identifica colega e não inventa prazo');
  perform pg_temp.ok(not exists (select 1 from public.notifications
    where link = '/leads?lead=' || v_lead and (kind = 'lead_assigned'
      or (kind = 'lead_reassigned' and profile_id <> b))), 'sem aviso duplicado de roleta ou destinatário indevido');
  -- Aparelho fictício só para testar elegibilidade; não dispara envio real.
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
  values (b, 'https://fcm.googleapis.com/fcm/send/repasse-0280', repeat('A', 87), repeat('A', 22));
  perform pg_temp.ok(public.push_category('lead_reassigned') = 'lead_atividade'
    and public.push_destino(b, 'lead_reassigned'), 'repasse entra no pipeline push pessoal por padrão');
  perform pg_temp.ok(exists (select 1 from public.push_pendentes(1000) as pendente(id)
    join public.notifications n on n.id = pendente.id
    where n.kind = 'lead_reassigned' and n.profile_id = b and n.link = '/leads?lead=' || v_lead),
    'aviso do repasse fica elegível para despacho push');

  -- O vencimento do prazo não devolve à fila um lead sem prazo.
  perform public.release_expired_leads();
  perform pg_temp.ok((select assigned_to from public.leads where id = v_lead) = b,
                     'a rotina de prazo não tira o lead do novo corretor');

  -- Quem recebeu enxerga os nomes de quem repassou e de quem recebeu.
  select detail into v_det from public.lead_events where lead_id = v_lead and kind = 'reassigned';
  perform pg_temp.ok(v_det->>'actor_name' = 'Ana 275' and v_det->>'to_name' = 'Bia 275',
                     'o evento grava quem repassou e para quem');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_bnomes from public.lead_history_names(v_lead) where full_name in ('Ana 275', 'Bia 275');
  reset role;
  perform pg_temp.ok(v_bnomes = 2, 'o corretor que recebeu vê os dois nomes no histórico');

  -- Um lead que não é visível ao chamador não vaza nomes.
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at)
    values ('Lead alheio 275', '5511999275002', 'assigned', a, now()) returning id into v_lead2;
  insert into public.lead_events (lead_id, actor_id, kind) values (v_lead2, a, 'claimed');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lead_history_names(v_lead2);
  reset role;
  perform pg_temp.ok(v_n = 0, 'lead de outro corretor não devolve nomes');

  -- Afinidade também não conta para a fila, mas continua com prazo real.
  insert into public.lead_assignments (lead_id, profile_id, sequence, deadline, counts_for_queue)
  values (v_lead2, a, 1, now() + interval '10 minutes', false);
  perform pg_temp.ok((select count(*) = 2 from public.notifications
    where link = '/leads?lead=' || v_lead2 and kind = 'lead_assigned' and profile_id = a),
    'atribuição com prazo mantém avisos existentes, inclusive afinidade');
  perform pg_temp.ok(not exists (select 1 from public.notifications
    where link = '/leads?lead=' || v_lead2 and kind = 'lead_reassigned'), 'afinidade não vira repasse');

  update public.automation_settings set notify_on_assign = false where id;
  update public.lead_assignments set released_at = now(), release_reason = 'reassigned'
    where lead_id = v_lead2 and released_at is null;
  insert into public.lead_assignments
    (lead_id, profile_id, sequence, deadline, responded_at, counts_for_queue)
  values (v_lead2, b, 2, now(), now(), false);
  perform pg_temp.ok(not exists (select 1 from public.notifications
    where link = '/leads?lead=' || v_lead2 and kind = 'lead_reassigned'), 'preserva configuração de avisos desligados');
end $$;

rollback;
