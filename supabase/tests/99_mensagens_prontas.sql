-- =============================================================================
-- 0192 — mensagens prontas: cada um vê as suas e as da equipe; só admin
-- compartilha e mexe nas compartilhadas.
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
  adm uuid := '00000000-0000-0000-0000-000001920001';
  a   uuid := '00000000-0000-0000-0000-000001920002';
  b   uuid := '00000000-0000-0000-0000-000001920003';
  v_equipe uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@a192.test','{"full_name":"Admin 192"}'),
    (a,'a@a192.test','{"full_name":"Corretor A 192"}'),
    (b,'b@a192.test','{"full_name":"Corretor B 192"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'), (a,'broker'), (b,'broker') on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.mensagens_prontas(titulo, texto, compartilhada)
    values ('Boas-vindas', '{saudacao}, {primeiro_nome}! Aqui é {corretor}.', true) returning id into v_equipe;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.mensagens_prontas(titulo, texto) values ('Minha', 'Oi {primeiro_nome}');
  perform pg_temp.ok((select count(*) from public.mensagens_prontas) = 2, 'corretor vê a dele e a da equipe');
  update public.mensagens_prontas set texto = 'mexi' where id = v_equipe;
  perform pg_temp.ok((select texto from public.mensagens_prontas where id = v_equipe) <> 'mexi', 'corretor não edita a da equipe');
  begin
    insert into public.mensagens_prontas(titulo, texto, compartilhada) values ('Spam', 'x', true);
    raise exception 'FALHOU: corretor compartilhou mensagem';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não compartilha mensagem';
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.mensagens_prontas) = 1, 'outro corretor não vê a mensagem pessoal do colega');
  reset role;
end;
$$;

rollback;
