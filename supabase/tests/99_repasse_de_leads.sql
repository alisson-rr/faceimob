-- 0343 — repasse de leads de quem saiu: lista só os em atendimento de
-- corretor inativo, passa os escolhidos para um ativo e só admin/sócio faz.
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
  adm uuid := '00000000-0000-0000-0000-000003430001';
  saiu uuid := '00000000-0000-0000-0000-000003430002';
  novo uuid := '00000000-0000-0000-0000-000003430003';
  l1 uuid; l2 uuid; l_perdido uuid;
  v_lista jsonb; v_n int; v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@a343.test', '{"full_name":"Admin 343"}'),
    (saiu, 'saiu@a343.test', '{"full_name":"Saiu 343"}'),
    (novo, 'novo@a343.test', '{"full_name":"Novo 343"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (saiu, 'broker'), (novo, 'broker') on conflict do nothing;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at) values
    ('Lead A 343', '51900343001', 'attending', saiu, now()) returning id into l1;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at) values
    ('Lead B 343', '51900343002', 'assigned', saiu, now()) returning id into l2;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, lost_at) values
    ('Lead perdido 343', '51900343003', 'lost', saiu, now(), now()) returning id into l_perdido;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.profiles set status = 'terminated', terminated_at = now() where id = saiu;

  -- corretor não lista nem repassa
  perform set_config('request.jwt.claims', json_build_object('sub', novo, 'role', 'authenticated')::text, true);
  begin
    perform public.leads_de_corretores_inativos();
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'barrado';
  end;
  perform pg_temp.ok(v_msg = 'barrado', 'corretor não vê a lista de repasse');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  v_lista := public.leads_de_corretores_inativos();
  perform pg_temp.ok(
    (select count(*) from jsonb_array_elements(v_lista) e where e ->> 'cliente' like 'Lead % 343') = 2,
    'lista só os leads em atendimento de quem saiu (sem o perdido)');

  v_n := public.repassar_leads(saiu, novo, array[l1, l2, l_perdido]);
  perform pg_temp.ok(v_n = 2, 'repassa só os em atendimento');
  perform pg_temp.ok((select count(*) from public.leads where id in (l1, l2) and assigned_to = novo and attend_deadline is null) = 2,
    'leads vão direto ao corretor ativo, sem cronômetro');
  perform pg_temp.ok((select assigned_to = saiu from public.leads where id = l_perdido), 'o perdido fica onde estava');
  perform pg_temp.ok(exists (select 1 from public.lead_events where lead_id = l1 and kind = 'reassigned'), 'repasse no histórico do lead');

  -- 0349: repassado aguardando com data vencida não atrasa (não trava o check-in).
  update public.leads set next_action_at = now() - interval '3 days' where id in (l1, l2);
  perform pg_temp.ok(public.overdue_lead_count(novo) = 0, 'repassado aguardando não conta como atrasado');

  -- 0344: pegar o repassado leva para "Conversa iniciada", mesmo vindo de etapa adiante.
  update public.leads set funnel_stage = 'warm' where id = l1;
  perform set_config('request.jwt.claims', json_build_object('sub', novo, 'role', 'authenticated')::text, true);
  perform public.claim_lead(l1, null);
  perform pg_temp.ok((select status = 'attending' and funnel_stage = 'first_contact' from public.leads where id = l1),
    'pegar o repassado leva para Conversa iniciada');
  perform pg_temp.ok((select next_action_at > now() from public.leads where id = l1)
    and public.overdue_lead_count(novo) = 0, 'ao pegar, ganha próximo contato no futuro e segue sem atraso');
end;
$$;

rollback;
