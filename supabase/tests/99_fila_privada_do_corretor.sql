-- =============================================================================
-- 0310 — o corretor vê só o próprio vínculo e os próprios grupos de
-- distribuição; o gerente segue vendo todos.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor_a uuid := '00000000-0000-0000-0000-000003100001';
  cor_b uuid := '00000000-0000-0000-0000-000003100002';
  ger   uuid := '00000000-0000-0000-0000-000003100003';
  g1    uuid;
  g2    uuid;
  v_n   int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor_a, 'a@f310.test', '{"full_name":"Corretor A 310"}'),
    (cor_b, 'b@f310.test', '{"full_name":"Corretor B 310"}'),
    (ger,   'g@f310.test', '{"full_name":"Gerente 310"}');
  insert into public.user_roles (profile_id, role) values (cor_a, 'broker'), (cor_b, 'broker'), (ger, 'manager')
  on conflict do nothing;
  insert into public.distribution_groups (name, slug, kind, active) values ('Grupo 1 · 310', 'g1-310', 'specific', true) returning id into g1;
  insert into public.distribution_groups (name, slug, kind, active) values ('Grupo 2 · 310', 'g2-310', 'specific', true) returning id into g2;
  insert into public.distribution_group_members (group_id, profile_id, active) values (g1, cor_a, true), (g1, cor_b, true), (g2, cor_b, true);

  perform set_config('request.jwt.claims', json_build_object('sub', cor_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.distribution_group_members where group_id in (g1, g2);
  if v_n <> 1 then raise exception 'FALHOU: o corretor deveria ver só o próprio vínculo (viu %)', v_n; end if;
  select count(*) into v_n from public.distribution_groups where id in (g1, g2);
  if v_n <> 1 then raise exception 'FALHOU: o corretor deveria ver só o grupo de que participa (viu %)', v_n; end if;
  execute 'reset role';
  raise notice '  ok  corretor vê só o próprio vínculo e o próprio grupo';

  perform set_config('request.jwt.claims', json_build_object('sub', ger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.distribution_group_members where group_id in (g1, g2);
  execute 'reset role';
  if v_n <> 3 then raise exception 'FALHOU: o gerente deveria ver a fila inteira (viu %)', v_n; end if;
  raise notice '  ok  gerente segue vendo todos os vínculos';
end;
$$;

rollback;
