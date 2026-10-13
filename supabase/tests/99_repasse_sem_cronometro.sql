-- 0275 — repasse manual sem cronômetro de atendimento e nomes no histórico.
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
  a uuid := '00000000-0000-0000-0000-000002750001';
  b uuid := '00000000-0000-0000-0000-000002750002';
  v_lead uuid; v_lead2 uuid; v_row public.leads; v_n int; v_det jsonb; v_bnomes int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@a275.test', '{"full_name":"Ana 275"}'),
    (b, 'b@a275.test', '{"full_name":"Bia 275"}');

  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, attend_deadline)
    values ('Lead 275', '5511999275001', 'assigned', a, now(), now() + interval '10 minutes')
    returning id into v_lead;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reassign_lead(v_lead, b);
  reset role;

  select * into v_row from public.leads where id = v_lead;
  perform pg_temp.ok(v_row.assigned_to = b, 'o lead vai direto para o novo corretor');
  perform pg_temp.ok(v_row.status = 'assigned', 'continua aguardando o novo corretor pegar');
  perform pg_temp.ok(v_row.attend_deadline is null, 'sem cronômetro de atendimento');
  perform pg_temp.ok(v_row.next_action_at > now(), 'só fica atrasado se ninguém tratar (próximo contato no futuro)');

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
end $$;

rollback;
