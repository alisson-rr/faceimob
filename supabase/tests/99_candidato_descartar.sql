-- 0276 — descartar candidato direto do card, disponível ou já pego.
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
  ger1 uuid := '00000000-0000-0000-0000-000002760001';
  ger2 uuid := '00000000-0000-0000-0000-000002760002';
  cor  uuid := '00000000-0000-0000-0000-000002760003';
  c1 uuid; c2 uuid; c3 uuid; v_msg text; v_row public.candidatos;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ger1, 'g1@c276.test', '{"full_name":"Gerente 276 A"}'),
    (ger2, 'g2@c276.test', '{"full_name":"Gerente 276 B"}'),
    (cor,  'co@c276.test', '{"full_name":"Corretor 276"}');
  insert into public.user_roles (profile_id, role) values (ger1, 'manager'), (ger2, 'manager'), (cor, 'broker')
    on conflict do nothing;
  insert into public.candidatos (nome, telefone, zona) values ('Cand 1', '51900276001', 'sul') returning id into c1;
  insert into public.candidatos (nome, telefone, zona) values ('Cand 2', '51900276002', 'norte') returning id into c2;
  insert into public.candidatos (nome, telefone, zona) values ('Cand 3', '51900276003', 'sul') returning id into c3;

  -- Gerente descarta um candidato DISPONÍVEL: fica como descartado e atribuído a ele.
  perform set_config('request.jwt.claims', json_build_object('sub', ger1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.candidato_descartar(c1);
  reset role;
  select * into v_row from public.candidatos where id = c1;
  perform pg_temp.ok(v_row.status = 'descartado' and v_row.responsavel_id = ger1,
                     'gerente descarta o disponível e o descarte fica no nome dele');

  -- Candidato pego por outro gestor não é descartado pelo colega.
  perform set_config('request.jwt.claims', json_build_object('sub', ger1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.candidato_pegar(c2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ger2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.candidato_descartar(c2);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Candidato não encontrado%', 'gerente não descarta o candidato que outro pegou');
  perform pg_temp.ok((select status from public.candidatos where id = c2) = 'em_entrevista', 'e o candidato segue com quem pegou');

  -- Corretor não descarta.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.candidato_descartar(c3);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Só gerentes, diretores%', 'corretor não descarta candidato');

  -- Descartar duas vezes recusa, e anônimo não descarta.
  perform set_config('request.jwt.claims', json_build_object('sub', ger1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.candidato_descartar(c1);
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok(v_msg like 'Candidato não encontrado%', 'não descarta o que já foi descartado');
end $$;

rollback;
