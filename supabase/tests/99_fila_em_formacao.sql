-- =============================================================================
-- 0198 — fila em formação para o admin: quem bateu ponto, em que ordem vai
-- receber e por que não está recebendo (aguardando a abertura ou bloqueado).
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
  adm  uuid := '00000000-0000-0000-0000-000001980001';
  aber uuid := '00000000-0000-0000-0000-000001980002';
  esp1 uuid := '00000000-0000-0000-0000-000001980003';
  esp2 uuid := '00000000-0000-0000-0000-000001980004';
  blq  uuid := '00000000-0000-0000-0000-000001980005';
  fora uuid := '00000000-0000-0000-0000-000001980006';
  g    uuid;
  t_aberto uuid;
  t_fechado uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@f198.test',  '{"full_name":"Admin 198"}'),
    (aber, 'aber@f198.test', '{"full_name":"Aberto 198"}'),
    (esp1, 'esp1@f198.test', '{"full_name":"Espera Um 198"}'),
    (esp2, 'esp2@f198.test', '{"full_name":"Espera Dois 198"}'),
    (blq,  'blq@f198.test',  '{"full_name":"Bloqueado 198"}'),
    (fora, 'fora@f198.test', '{"full_name":"Saiu 198"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (aber, 'broker'), (esp1, 'broker'), (esp2, 'broker'), (blq, 'broker'), (fora, 'broker')
  on conflict do nothing;

  insert into public.distribution_groups (name, slug, kind, active)
  values ('Roleta 198', 'roleta-198', 'specific', true) returning id into g;
  insert into public.distribution_group_members (group_id, profile_id, active)
  values (g, aber, true), (g, esp1, true), (g, esp2, true), (g, blq, true), (g, fora, true);

  -- Um turno já distribuindo e outro que só abre no fim do dia: o teste não depende do relógio.
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('aberto-198', 'Aberto 198', '00:00', '00:00', '23:59:59', -198) returning id into t_aberto;
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('fechado-198', 'Fechado 198', '00:00', '23:58', '23:59', -197) returning id into t_fechado;

  insert into public.checkins (profile_id, shift_id, work_date, checked_out_at) values
    (aber, t_aberto,  public.current_work_date(), null),
    (esp1, t_fechado, public.current_work_date(), null),
    (esp2, t_fechado, public.current_work_date(), null),
    (blq,  t_aberto,  public.current_work_date(), null),
    (fora, t_aberto,  public.current_work_date(), now());

  -- Esp2 recebeu há pouco: vai depois de Esp1, que nunca recebeu.
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Lead esp2 198', '11900198001', 'attending', esp2, now() - interval '10 minutes', now() + interval '1 day');
  insert into public.lead_assignments (lead_id, profile_id, group_id, sequence, deadline, assigned_at)
  select l.id, esp2, g, 1, now(), now() - interval '10 minutes' from public.leads l where l.phone = '11900198001';

  -- Bloqueado: um lead atrasado com o limite em 1 (atribuído agora: depois do recomeço da 0187).
  update public.automation_settings set overdue_block_threshold = 1 where id;
  insert into public.leads (full_name, phone, status, assigned_to, assigned_at, next_action_at)
  values ('Lead blq 198', '11900198002', 'attending', blq, now(), now() - interval '5 minutes');
end
$$;

\echo '== situação e ordem =='
do $$
declare
  r record;
  linhas text;
begin
  perform pg_temp.como('00000000-0000-0000-0000-000001980001');
  set local role authenticated;
  select string_agg(full_name || ':' || situacao || ':' || coalesce(posicao::text, '-'), ' | ' order by coalesce(posicao, 99), full_name)
    into linhas
    from public.fila_em_formacao() where group_name = 'Roleta 198';
  reset role;
  perform pg_temp.ok(linhas = 'Aberto 198:na_fila:1 | Espera Um 198:aguardando:2 | Espera Dois 198:aguardando:3 | Bloqueado 198:bloqueado:-',
    'na fila primeiro, depois quem aguarda pela ordem do motor, bloqueado sem posição, quem saiu fora: ' || coalesce(linhas, '∅'));

  perform pg_temp.como('00000000-0000-0000-0000-000001980001');
  set local role authenticated;
  select * into r from public.fila_em_formacao() where full_name = 'Espera Um 198';
  reset role;
  perform pg_temp.ok(r.abre_as = '23:58' and r.checked_in_at is not null, 'mostra quando a distribuição abre e a hora do check-in');
end
$$;

\echo '== só admin =='
do $$
begin
  perform pg_temp.como('00000000-0000-0000-0000-000001980002');
  set local role authenticated;
  begin
    perform * from public.fila_em_formacao();
    reset role;
    raise exception 'FALHOU: corretor viu a fila em formação';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  corretor leva 42501';
  end;
end
$$;
select pg_temp.ok(not has_function_privilege('anon', 'public.fila_em_formacao()', 'execute'), 'anon não executa');

rollback;
