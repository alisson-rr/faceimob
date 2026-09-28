-- =============================================================================
-- 0161 — Meta remuneração (`sales_comp`) só o administrador grava.
--
-- Cenário: Dirce (diretora) com Gil (gerente) na equipe; Ari é admin.
-- O diretor continua gravando a Meta (`sales`) do gerente, mas não a Meta
-- remuneração — nem nova, nem mudando ou apagando a que o admin cadastrou.
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
  ('00000000-0000-0000-0000-000000016101', 'ari@v0161.test',   '{"full_name":"Ari Admin 0161"}'),
  ('00000000-0000-0000-0000-000000016102', 'dirce@v0161.test', '{"full_name":"Dirce Diretora 0161"}'),
  ('00000000-0000-0000-0000-000000016103', 'gil@v0161.test',   '{"full_name":"Gil Gerente 0161"}')
on conflict do nothing;
insert into public.user_roles (profile_id, role) values
  ('00000000-0000-0000-0000-000000016101', 'admin'),
  ('00000000-0000-0000-0000-000000016102', 'director'),
  ('00000000-0000-0000-0000-000000016103', 'manager')
on conflict do nothing;
insert into public.teams (name, slug, director_id, manager_id) values
  ('Equipe 0161', 'equipe-0161', '00000000-0000-0000-0000-000000016102', '00000000-0000-0000-0000-000000016103');

set role authenticated;

-- Admin grava a Meta remuneração do gerente.
select pg_temp.como('00000000-0000-0000-0000-000000016101');
insert into public.goals (scope, profile_id, period_type, period, metric, target)
values ('profile', '00000000-0000-0000-0000-000000016103', 'month', '2099-11-01', 'sales_comp', 8);

select pg_temp.como('00000000-0000-0000-0000-000000016102');
do $$
declare
  v_rows int;
begin
  -- A Meta do gerente o diretor continua gravando.
  insert into public.goals (scope, profile_id, period_type, period, metric, target)
  values ('profile', '00000000-0000-0000-0000-000000016103', 'month', '2099-11-01', 'sales', 6);

  begin
    insert into public.goals (scope, profile_id, period_type, period, metric, target)
    values ('profile', '00000000-0000-0000-0000-000000016103', 'month', '2099-10-01', 'sales_comp', 9);
    raise exception 'FALHOU: diretor criou Meta remuneração';
  exception when insufficient_privilege then null;
  end;

  update public.goals set target = 99
   where profile_id = '00000000-0000-0000-0000-000000016103' and metric = 'sales_comp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FALHOU: diretor mudou a Meta remuneração'; end if;

  delete from public.goals
   where profile_id = '00000000-0000-0000-0000-000000016103' and metric = 'sales_comp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FALHOU: diretor apagou a Meta remuneração'; end if;

  -- Ler continua: o relatório da Visão Geral mostra a meta ao diretor.
  if not exists (select 1 from public.goals
                  where profile_id = '00000000-0000-0000-0000-000000016103' and metric = 'sales_comp' and target = 8) then
    raise exception 'FALHOU: diretor deixou de ler a Meta remuneração';
  end if;
  raise notice '  ok  meta remuneração só o admin grava';
end
$$;

reset role;
rollback;
