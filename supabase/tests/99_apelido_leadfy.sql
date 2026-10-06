-- =============================================================================
-- 0189 — nome curto da Leadfy vira apelido, sem trocar apelido existente.
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
  adm uuid := '00000000-0000-0000-0000-000001890001';
  a uuid := '00000000-0000-0000-0000-000001890002';
  b uuid := '00000000-0000-0000-0000-000001890003';
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@a189.test','{"full_name":"Admin 189"}'),
    (a,'a@a189.test','{"full_name":"Marco Antonio Torres 189"}'),
    (b,'b@a189.test','{"full_name":"Daiane Jardim de Cristo 189"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;
  update public.profiles set nickname = 'Dai' where id = b;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok(
    (select situacao from public.gravar_apelidos_leadfy(array['Marco Antonio 189', 'Daiane Cristo 189', 'Ninguém 189'])
      where nome = 'Marco Antonio 189') = 'gravado', 'nome curto gravado como apelido');
  reset role;

  perform pg_temp.ok((select nickname from public.profiles where id = a) = 'Marco Antonio 189', 'apelido no cadastro');
  perform pg_temp.ok((select nickname from public.profiles where id = b) = 'Dai', 'apelido existente não é trocado');

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.gravar_apelidos_leadfy(array['x']);
    raise exception 'FALHOU: corretor gravou apelidos';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não grava apelidos';
  end;
  reset role;
end
$$;

rollback;
