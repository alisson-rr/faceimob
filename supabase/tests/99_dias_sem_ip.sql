-- =============================================================================
-- 0191 — dia marcado libera o check-in de qualquer IP; só admin marca.
-- 192.0.2.0/24 (TEST-NET-1): nenhum outro teste cadastra essa faixa.
-- =============================================================================
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
  adm uuid := '00000000-0000-0000-0000-000001910001';
  cor uuid := '00000000-0000-0000-0000-000001910002';
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@a191.test','{"full_name":"Admin 191"}'),
    (cor,'cor@a191.test','{"full_name":"Corretor 191"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'), (cor,'broker') on conflict do nothing;
  delete from public.checkin_dias_sem_ip;

  perform pg_temp.ok(not public.ip_is_allowed('192.0.2.33'::inet, cor), 'sem dia marcado, IP de fora é barrado');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.checkin_dias_sem_ip(dia) values (public.current_work_date());
    raise exception 'FALHOU: corretor marcou dia sem trava';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não marca dia sem trava';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.checkin_dias_sem_ip(dia) values (public.current_work_date());
  reset role;

  perform pg_temp.ok(public.ip_is_allowed('192.0.2.33'::inet, cor), 'no dia marcado, qualquer IP passa');

  delete from public.checkin_dias_sem_ip where dia = public.current_work_date();
  perform pg_temp.ok(not public.ip_is_allowed('192.0.2.33'::inet, cor), 'desmarcado, a trava volta');
end;
$$;

rollback;
