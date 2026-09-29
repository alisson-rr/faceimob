-- =============================================================================
-- 0167 — o diretor move corretor entre as equipes dele e muda a situação,
-- mas não edita os dados da pessoa.
--
-- Cenário: Dirce (diretora) com duas equipes, de Gil e de Gus; Cora é corretora
-- da equipe de Gil.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.como(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000016701', 'dirce@v0167.test', '{"full_name":"Dirce Diretora 0167"}'),
  ('00000000-0000-0000-0000-000000016702', 'gil@v0167.test',   '{"full_name":"Gil Gerente 0167"}'),
  ('00000000-0000-0000-0000-000000016703', 'gus@v0167.test',   '{"full_name":"Gus Gerente 0167"}'),
  ('00000000-0000-0000-0000-000000016704', 'cora@v0167.test',  '{"full_name":"Cora Corretora 0167"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000016701', 'director'),
  ('00000000-0000-0000-0000-000000016702', 'manager'),
  ('00000000-0000-0000-0000-000000016703', 'manager')
on conflict do nothing;
insert into public.teams (id, name, slug, director_id, manager_id) values
  ('00000000-0000-0000-0000-00000001670a', 'Equipe Gil 0167', 'equipe-gil-0167',
   '00000000-0000-0000-0000-000000016701', '00000000-0000-0000-0000-000000016702'),
  ('00000000-0000-0000-0000-00000001670b', 'Equipe Gus 0167', 'equipe-gus-0167',
   '00000000-0000-0000-0000-000000016701', '00000000-0000-0000-0000-000000016703');
insert into public.team_members (team_id, profile_id) values
  ('00000000-0000-0000-0000-00000001670a', '00000000-0000-0000-0000-000000016704');

set role authenticated;

select pg_temp.como('00000000-0000-0000-0000-000000016701');
do $$
declare
  v_rows int;
begin
  begin
    update public.profiles set full_name = 'Outro Nome' where id = '00000000-0000-0000-0000-000000016704';
    raise exception 'FALHOU: diretor trocou o nome do corretor';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set phone = '5511999990000' where id = '00000000-0000-0000-0000-000000016704';
    raise exception 'FALHOU: diretor trocou o telefone do corretor';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set badge_requested_at = current_date where id = '00000000-0000-0000-0000-000000016704';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FALHOU: diretor não pediu o crachá'; end if;

  update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-000000016704';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FALHOU: diretor não suspendeu o corretor'; end if;
  update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-000000016704';

  -- Mover de uma equipe dele para a outra, numa operação só.
  perform public.move_team_member('00000000-0000-0000-0000-000000016704', '00000000-0000-0000-0000-00000001670b');
  if not exists (select 1 from public.team_members
                  where profile_id = '00000000-0000-0000-0000-000000016704' and left_at is null
                    and team_id = '00000000-0000-0000-0000-00000001670b') then
    raise exception 'FALHOU: corretor não foi para a equipe de Gus';
  end if;

  -- O gerente que lidera equipe não é movido pelo diretor.
  begin
    perform public.move_team_member('00000000-0000-0000-0000-000000016702', '00000000-0000-0000-0000-00000001670b');
    raise exception 'FALHOU: diretor moveu o gerente da equipe que ele lidera';
  exception when insufficient_privilege then null;
  end;

  raise notice '  ok  diretor muda situação, crachá e equipe, não os dados';
end
$$;

-- O gerente na PRÓPRIA ficha: contato sim, situação não (antes caía no ramo de gestor).
select pg_temp.como('00000000-0000-0000-0000-000000016702');
do $$
begin
  update public.profiles set phone = '5511988887777' where id = '00000000-0000-0000-0000-000000016702';

  begin
    update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-000000016702';
    raise exception 'FALHOU: gerente mudou a própria situação';
  exception when insufficient_privilege then null;
  end;
  -- Nem puxa gente de equipe que não lidera.
  begin
    perform public.move_team_member('00000000-0000-0000-0000-000000016704', '00000000-0000-0000-0000-00000001670a');
    raise exception 'FALHOU: gerente puxou corretor de outra equipe';
  exception when insufficient_privilege then null;
  end;
  raise notice '  ok  gestor edita o próprio contato, não a própria situação';
end
$$;

reset role;
rollback;
