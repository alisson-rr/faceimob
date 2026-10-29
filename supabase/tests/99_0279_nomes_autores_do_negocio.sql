\set ON_ERROR_STOP on
begin;

do $$
declare
  dono uuid := '00000000-0000-0000-0000-000002790001';
  leitor uuid := '00000000-0000-0000-0000-000002790002';
  autor uuid := '00000000-0000-0000-0000-000002790003';
  outro uuid := '00000000-0000-0000-0000-000002790004';
  fora uuid := '00000000-0000-0000-0000-000002790005';
  negocio uuid;
  outro_negocio uuid;
  caso uuid;
  n integer;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dono, 'dono@c279.test', '{"full_name":"Corretor 279"}'),
    (leitor, 'leitor@c279.test', '{"full_name":"CCA leitor 279"}'),
    (autor, 'autor@c279.test', '{"full_name":"CCA autor 279"}'),
    (outro, 'outro@c279.test', '{"full_name":"CCA outro 279"}'),
    (fora, 'fora@c279.test', '{"full_name":"Fora 279"}');
  insert into public.user_roles (profile_id, role) values
    (dono, 'broker'), (leitor, 'cca'), (autor, 'cca'), (outro, 'cca'), (fora, 'broker')
    on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), dono)
    returning id into negocio;
  insert into public.deal_participants (deal_id, profile_id, role)
    values (negocio, dono, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1), fora)
    returning id into outro_negocio;
  insert into public.deal_history (deal_id, actor_id, kind, to_value) values
    (negocio, autor, 'comment', 'Comentário CCA'),
    (negocio, autor, 'stage_changed', 'Movimento CCA'),
    (outro_negocio, outro, 'comment', 'Outro negócio');
  insert into public.cca_cases (deal_id) values (negocio) returning id into caso;
  insert into public.cca_case_events (case_id, actor_id, kind)
    values (caso, leitor, 'status_changed');

  perform set_config('request.jwt.claims', json_build_object('sub', leitor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not exists (select 1 from public.deal_actor_names(negocio)
                 where profile_id = autor and full_name = 'CCA autor 279') then
    raise exception 'CCA não identifica colega autor';
  end if;
  if not exists (select 1 from public.deal_actor_names(negocio) where profile_id = dono)
     or not exists (select 1 from public.deal_actor_names(negocio) where profile_id = leitor) then
    raise exception 'Participante ou autor exclusivo de cca_case_events ausente';
  end if;
  select count(*) into n from public.deal_actor_names(negocio) where profile_id = autor;
  if n <> 1 then raise exception 'Autor duplicado'; end if;
  if exists (select 1 from public.deal_actor_names(negocio) where profile_id in (outro, fora)) then
    raise exception 'Nome sem autoria/participação no negócio vazou';
  end if;
  if exists (select 1 from public.profiles where id = autor) then
    raise exception 'Ficha privada do colega CCA ficou visível';
  end if;
  if exists (select 1 from public.deal_actor_names(null))
     or exists (select 1 from public.deal_actor_names('00000000-0000-0000-0000-000000000000')) then
    raise exception 'Negócio inexistente retornou nomes';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.deal_actor_names(negocio) where profile_id = autor) then
    raise exception 'Participante não identifica autor';
  end if;
  if exists (select 1 from public.deal_actor_names(outro_negocio)) then
    raise exception 'Nomes de outro escopo vazaram';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', fora, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.deal_actor_names(negocio)) then
    raise exception 'Corretor de fora acessou nomes';
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  if exists (select 1 from public.deal_actor_names(negocio)) then
    raise exception 'Sem identidade acessou nomes';
  end if;
  execute 'set local role anon';
  begin
    perform public.deal_actor_names(negocio);
    raise exception 'Anon executou RPC de nomes';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  raise notice 'ok 0279: autores reais, RLS privada, escopo e anon';
end;
$$;

rollback;
