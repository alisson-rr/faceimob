-- 0259 — lead com o robô atendendo não aparece na fila do corretor; entregue, aparece.
-- 0259 — lead com o robô atendendo não aparece na fila de quem lê a fila (gerente); entregue, aparece.
begin;
do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002590001';
  v_lead uuid;
  v_conv uuid;
  v_ve boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c259.test', '{"full_name":"Gerente 259"}');
  insert into public.user_roles (profile_id, role) values (cor, 'manager') on conflict do nothing;
  insert into public.leads (full_name, phone, status) values ('Lead 259', '51999990259', 'queued') returning id into v_lead;
  insert into public.sdr_conversations (lead_id, status) values (v_lead, 'active') returning id into v_conv;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists (select 1 from public.leads where id = v_lead) into v_ve;
  reset role;
  if v_ve then raise exception 'FALHOU: gerente não devia ver o lead com o robô atendendo'; end if;
  raise notice '  ok  lead com o robô fica fora da fila';

  update public.sdr_conversations set status = 'handed_off' where id = v_conv;
  set local role authenticated;
  select exists (select 1 from public.leads where id = v_lead) into v_ve;
  reset role;
  if not v_ve then raise exception 'FALHOU: depois da entrega o lead da fila geral devia aparecer'; end if;
  raise notice '  ok  entregue, o lead volta a aparecer na fila';
end;
$$;
rollback;
