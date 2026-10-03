-- =============================================================================
-- 0210 — relatório da roleta: recebidos, atendidos e perdidos por corretor, e a
-- lista das perdas com o prazo que valeu; cada um vê só o próprio alcance.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.como(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002100001';
  ana uuid := '00000000-0000-0000-0000-000002100002';
  bia uuid := '00000000-0000-0000-0000-000002100003';
  l1 uuid; l2 uuid; l3 uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@r210.test', '{"full_name":"Admin 210"}'),
    (ana, 'ana@r210.test', '{"full_name":"Ana 210"}'),
    (bia, 'bia@r210.test', '{"full_name":"Bia 210"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (ana, 'broker'), (bia, 'broker')
  on conflict do nothing;
  insert into public.leads (full_name, phone, status) values ('Cliente A 210', '11955210001', 'queued') returning id into l1;
  insert into public.leads (full_name, phone, status) values ('Cliente B 210', '11955210002', 'queued') returning id into l2;
  insert into public.leads (full_name, phone, status) values ('Cliente C 210', '11955210003', 'queued') returning id into l3;

  -- Ana: atendeu um em 2 min (prazo de 10) e perdeu um com prazo de 5.
  insert into public.lead_assignments (lead_id, profile_id, sequence, assigned_at, deadline, responded_at)
  values (l1, ana, 1, now() - interval '30 minutes', now() - interval '20 minutes', now() - interval '28 minutes');
  insert into public.lead_assignments (lead_id, profile_id, sequence, assigned_at, deadline, released_at, release_reason)
  values (l2, ana, 1, now() - interval '15 minutes', now() - interval '10 minutes', now() - interval '10 minutes', 'timeout');
  -- Bia: recebeu o que a Ana perdeu.
  insert into public.lead_assignments (lead_id, profile_id, sequence, assigned_at, deadline)
  values (l3, bia, 1, now() - interval '5 minutes', now() + interval '5 minutes');

  perform pg_temp.como(adm);
  set local role authenticated;
  select * into r from public.relatorio_da_roleta(hoje, hoje) where profile_id = ana;
  perform pg_temp.ok(r.recebidos = 2 and r.atendidos = 1 and r.perdidos = 1 and r.realocados = 0,
    'Ana: 2 recebidos, 1 atendido, 1 perdido');
  perform pg_temp.ok(r.resposta_media_seg = 120, 'resposta média de 2 min (' || r.resposta_media_seg || ' s)');
  perform pg_temp.ok(r.prazo_min_seg = 300 and r.prazo_max_seg = 600, 'o relatório mostra que um prazo foi de 5 min');
  select * into r from public.perdas_na_roleta(ana, hoje, hoje);
  perform pg_temp.ok(r.cliente = 'Cliente B 210' and r.prazo_seg = 300, 'a perda vem com o cliente e o prazo de 5 min');
  reset role;

  perform pg_temp.como(bia);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.relatorio_da_roleta(hoje, hoje) where profile_id in (ana, bia)) = 1,
    'o corretor só vê a própria linha');
  perform pg_temp.ok(not exists (select 1 from public.perdas_na_roleta(ana, hoje, hoje)),
    'o corretor não vê as perdas de outro');
  reset role;
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.relatorio_da_roleta(date, date)', 'execute'), 'anon não executa');

rollback;
