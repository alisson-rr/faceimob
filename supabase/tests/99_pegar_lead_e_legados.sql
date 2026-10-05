-- =============================================================================
-- 0227 — pegar lead com a data escolhida; legado sai do mês fechado.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002270001';
  v_lead uuid;
  v_quando timestamptz := date_trunc('minute', now() + interval '48 hours');
  r public.leads;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c227.test', '{"full_name":"Corretor 227"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Lead 227', '11902270001', 'assigned', cor, now(), now() + interval '24 hours') returning id into v_lead;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.claim_lead(v_lead, v_quando);
  reset role;
  if r.status <> 'attending' or r.funnel_stage <> 'first_contact' or r.next_action_at <> v_quando then
    raise exception 'FALHOU: pegar lead (% / % / %)', r.status, r.funnel_stage, r.next_action_at;
  end if;
  if not exists (select 1 from public.tasks where ref_type = 'lead' and ref_id = v_lead and due_at = v_quando and assigned_to = cor) then
    raise exception 'FALHOU: a atividade do próximo contato não foi criada com 48 h';
  end if;
  raise notice '  ok  pegar o lead grava o próximo contato escolhido (48 h, não 24 h) e cria a atividade';
end;
$$;

rollback;
