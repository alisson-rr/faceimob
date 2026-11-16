-- =============================================================================
-- 0185 — exportação só admin e sócio; lista de ligação do diretor.
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
  dir uuid := '00000000-0000-0000-0000-000001850001';
  cor uuid := '00000000-0000-0000-0000-000001850002';
  ger uuid := '00000000-0000-0000-0000-000001850003';
  adm uuid := '00000000-0000-0000-0000-000001850004';
  v_time uuid;
  v_n int;
  v_t int;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (dir,'dir@l185.test','{"full_name":"Diretor 185"}'),
    (cor,'cor@l185.test','{"full_name":"Corretor 185"}'),
    (ger,'ger@l185.test','{"full_name":"Gerente 185"}');
  insert into public.user_roles(profile_id,role) values (dir,'director'), (ger,'manager') on conflict do nothing;
  insert into public.teams(name, manager_id, director_id) values ('Equipe 185', ger, dir) returning id into v_time;
  insert into public.team_members(team_id, profile_id) values (v_time, cor);

  insert into public.leads(full_name, phone, campaign_name, assigned_to, created_at) values
    ('Antigo Um', '51999990001', '[FORM] GERAL', cor, now() - interval '40 days'),
    ('Antigo Sem Fone', null, '[FORM] GERAL', cor, now() - interval '40 days'),
    ('Deste Mes', '51999990002', '[FORM] GERAL', cor, now());

  begin
    update public.role_permissions set allowed = true where role = 'director' and permission = 'pipeline.export';
    insert into public.role_permissions(role, permission, allowed) values ('director','pipeline.export',true);
    raise exception 'FALHOU: diretor ganhou a planilha do Pipeline';
  exception when check_violation then
    raise notice '  ok  planilha do Pipeline não liga para diretor';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lista_de_ligacao() l where l.cliente like '%185%' or l.cliente in ('Antigo Um', 'Deste Mes', 'Antigo Sem Fone');
  reset role;
  perform pg_temp.ok(v_n = 1, 'diretor recebe só o lead antigo com telefone da diretoria dele');

  perform set_config('request.jwt.claims', json_build_object('sub', ger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lista_de_ligacao() l where l.cliente = 'Antigo Um';
  reset role;
  perform pg_temp.ok(v_n = 1, 'gerente também extrai a lista antiga da própria equipe');

  -- 0339: mês escolhido e DDD.
  insert into public.leads(full_name, phone, campaign_name, assigned_to, created_at) values
    ('Mes Escolhido 51', '5551999990003', '[FORM] GERAL', cor, '2025-03-10 12:00-03'),
    ('Mes Escolhido 11', '11999990004', '[FORM] GERAL', cor, '2025-03-11 12:00-03'),
    ('Mes Seguinte 51', '51999990005', '[FORM] GERAL', cor, '2025-04-01 00:30-03');
  -- 0340: mês e DDD só para administrador e sócio.
  perform set_config('request.jwt.claims', json_build_object('sub', dir, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.lista_de_ligacao('2025-03-01', '2025-04-01', null);
    raise exception 'FALHOU: diretor escolheu o mês';
  exception when insufficient_privilege then
    raise notice '  ok  diretor não escolhe mês nem DDD';
  end;
  reset role;
  insert into auth.users(id,email,raw_user_meta_data) values (adm,'adm@l185.test','{"full_name":"Admin 185"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin') on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lista_de_ligacao('2025-03-01', '2025-04-01', null) l where l.cliente like 'Mes %';
  select count(*) into v_t from public.lista_de_ligacao('2025-03-01', '2025-04-01', '51') l where l.cliente like 'Mes %';
  reset role;
  perform pg_temp.ok(v_n = 2, 'mês escolhido: só março, sem o lead de 01/04 00:30');
  perform pg_temp.ok(v_t = 1, 'DDD 51 tira o 11 e aceita telefone com 55 na frente');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.lista_de_ligacao();
    raise exception 'FALHOU: corretor extraiu a lista';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não extrai a lista de ligação';
  end;
  reset role;
end
$$;

rollback;
