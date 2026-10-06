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
  v_time uuid;
  v_n int;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (dir,'dir@l185.test','{"full_name":"Diretor 185"}'),
    (cor,'cor@l185.test','{"full_name":"Corretor 185"}');
  insert into public.user_roles(profile_id,role) values (dir,'director') on conflict do nothing;
  insert into public.teams(name, director_id) values ('Equipe 185', dir) returning id into v_time;
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
