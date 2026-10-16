-- =============================================================================
-- 0287 — diretor atualiza nascimento e CRECI de quem lidera; o resto não.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  dir    uuid := '00000000-0000-0000-0000-000002870001';
  ger    uuid := '00000000-0000-0000-0000-000002870002';
  cor    uuid := '00000000-0000-0000-0000-000002870003';
  v_team uuid;
  v_ok   boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dir, 'dir@c287.test', '{"full_name":"Diretor 287"}'),
    (ger, 'ger@c287.test', '{"full_name":"Gerente 287"}'),
    (cor, 'cor@c287.test', '{"full_name":"Corretor 287"}');
  insert into public.user_roles (profile_id, role) values
    (dir, 'director'), (ger, 'manager'), (cor, 'broker') on conflict do nothing;
  insert into public.teams (name, slug, director_id, manager_id)
    values ('Equipe 287', 'equipe-287', dir, ger) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  -- Diretor: nascimento, habilitação e CRECI passam.
  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles
     set birth_date = date '1990-05-12', habilitation = 'CRECI', creci = '123456'
   where id = cor;
  execute 'reset role';
  if (select creci from public.profiles where id = cor) is distinct from '123456' then
    raise exception 'FALHOU: diretor deveria gravar o CRECI de quem lidera';
  end if;
  raise notice '  ok  diretor grava nascimento e CRECI';

  -- Diretor: CPF continua do admin.
  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.profiles set cpf = '12345678901' where id = cor;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then raise exception 'FALHOU: diretor não altera CPF'; end if;
  raise notice '  ok  CPF segue só com o admin';

  -- Gerente: nascimento e CRECI continuam fora.
  perform set_config('request.jwt.claims', json_build_object('sub', ger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.profiles set creci = '999' where id = cor;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then raise exception 'FALHOU: gerente não altera CRECI'; end if;
  raise notice '  ok  gerente segue sem nascimento e CRECI';
end;
$$;

rollback;
