-- 0368 — OFF a partir de Internalizado para corretor, gerente e diretor; outros destinos seguem com a CCA.
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
  dir uuid := '00000000-0000-0000-0000-000003680001';
  v_origem text := (select value from public.deal_statuses where public.status2_chave(value) = 'INTERNALIZADO' order by active desc limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values (dir, 'dir@c368.test', '{"full_name":"Diretor 368"}');
  insert into public.user_roles (profile_id, role) values (dir, 'director') on conflict do nothing;
  perform pg_temp.ok(v_origem is not null, 'o catálogo tem Internalizado');
  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_status_move_block(v_origem, 'OFF') is null, 'diretor dá OFF a partir de Internalizado');
  perform pg_temp.ok(public.deal_status_move_block(v_origem, 'INCOMPLETO') is not null, 'outros destinos saindo de Internalizado seguem barrados');
end;
$$;

rollback;
