-- 0338 — exigir nova senha por equipe: quem entra no corte, sessões derrubadas,
-- cofre esquecido, e só a própria pessoa libera a marca.
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
  adm uuid := '00000000-0000-0000-0000-000003380001';
  dir uuid := '00000000-0000-0000-0000-000003380002';
  ger uuid := '00000000-0000-0000-0000-000003380003';
  cor uuid := '00000000-0000-0000-0000-000003380004';
  des uuid := '00000000-0000-0000-0000-000003380005';
  fora uuid := '00000000-0000-0000-0000-000003380006';
  t1 uuid; t2 uuid;
  n int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c338.test', '{"full_name":"Admin 338"}'),
    (dir, 'dir@c338.test', '{"full_name":"Diretor 338"}'),
    (ger, 'ger@c338.test', '{"full_name":"Gerente 338"}'),
    (cor, 'cor@c338.test', '{"full_name":"Corretor 338"}'),
    (des, 'des@c338.test', '{"full_name":"Desligado 338"}'),
    (fora, 'out@c338.test', '{"full_name":"Outra equipe 338"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin') on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.profiles set status = 'terminated', terminated_at = now() where id = des;

  insert into public.teams (name, director_id, manager_id) values ('Equipe 338', dir, ger) returning id into t1;
  insert into public.teams (name) values ('Outra 338') returning id into t2;
  insert into public.team_members (team_id, profile_id) values (t1, cor), (t1, des), (t2, fora);

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(
    (select array_agg(profile_id order by profile_id) from public.exigir_nova_senha_alvos(array[t1])) = array[dir, ger, cor],
    'alvos: membro, gerente e diretor; sem desligado e sem outra equipe');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.exigir_nova_senha_alvos(array[t1]);
    raise exception 'FALHOU: corretor listou alvos';
  exception when insufficient_privilege then
    raise notice '  ok  só admin lista os alvos';
  end;

  insert into auth.sessions (id, user_id) values (gen_random_uuid(), cor), (gen_random_uuid(), cor), (gen_random_uuid(), fora);
  insert into auth.refresh_tokens (user_id) values (cor::text), (fora::text);
  insert into private.operation_credentials (label, login, secret, profile_id) values ('Acesso · Corretor 338', 'cor@c338.test', 'velha123', cor);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  n := public.aplicar_exigencia_nova_senha(cor, adm);
  perform pg_temp.ok(n = 2 and not exists (select 1 from auth.sessions where user_id = cor)
    and not exists (select 1 from auth.refresh_tokens where user_id = cor::text),
    'sessões e refresh tokens do alvo apagados');
  perform pg_temp.ok(exists (select 1 from auth.sessions where user_id = fora), 'sessão de quem não é alvo fica');
  perform pg_temp.ok(not exists (select 1 from private.operation_credentials where profile_id = cor), 'cofre esqueceu a senha');
  perform pg_temp.ok(exists (select 1 from public.senha_troca_exigida where profile_id = cor and exigida_por = adm), 'troca marcada');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.aplicar_exigencia_nova_senha(fora, cor);
    raise exception 'FALHOU: logado aplicou a exigência';
  exception when insufficient_privilege then
    raise notice '  ok  só a service role aplica';
  end;
  perform pg_temp.ok(public.concluir_nova_senha(), 'a própria pessoa conclui');
  perform pg_temp.ok(not exists (select 1 from public.senha_troca_exigida where profile_id = cor), 'marca liberada');
end;
$$;

select pg_temp.ok(not has_function_privilege('authenticated', 'public.aplicar_exigencia_nova_senha(uuid,uuid)', 'execute'),
  'authenticated não executa aplicar_exigencia_nova_senha');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.senha_troca_exigida', 'insert')
  and not has_table_privilege('authenticated', 'public.senha_troca_exigida', 'delete'),
  'logado não grava nem apaga a marca direto');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.senha_troca_exigida'::regclass), 'RLS ligada');

rollback;
