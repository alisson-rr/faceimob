-- =============================================================================
-- 0293 — lead perdido/descartado some da lista do corretor; a liderança vê.
-- Nomes das colunas da esteira sem o número da planilha antiga.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002930001';
  ger uuid := '00000000-0000-0000-0000-000002930002';
  v_team uuid;
  v_aberto uuid; v_perdido uuid; v_descartado uuid;
  v_n int;
  v_col uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c293.test', '{"full_name":"Corretor 293"}'),
    (ger, 'ger@c293.test', '{"full_name":"Gerente 293"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ger, 'manager') on conflict do nothing;
  insert into public.teams (name, slug, manager_id) values ('Equipe 293', 'equipe-293', ger) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  insert into public.leads (full_name, phone, assigned_to, status)
    values ('Aberto 293', '5551999992931', cor, 'assigned') returning id into v_aberto;
  insert into public.leads (full_name, phone, assigned_to, status, lost_at, lost_reason)
    values ('Perdido 293', '5551999992932', cor, 'lost', now(), 'teste') returning id into v_perdido;
  insert into public.leads (full_name, phone, assigned_to, status, lost_reason)
    values ('Descartado 293', '5551999992933', cor, 'discarded', 'teste') returning id into v_descartado;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.leads where id in (v_aberto, v_perdido, v_descartado);
  execute 'reset role';
  if v_n <> 1 then raise exception 'FALHOU: corretor deveria ver só o lead aberto (viu %)', v_n; end if;
  raise notice '  ok  corretor não vê perdido nem descartado';

  perform set_config('request.jwt.claims', json_build_object('sub', ger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.leads where id in (v_aberto, v_perdido, v_descartado);
  execute 'reset role';
  if v_n <> 3 then raise exception 'FALHOU: gerente deveria ver os três leads do corretor (viu %)', v_n; end if;
  raise notice '  ok  gerente segue vendo o histórico';

  if exists (select 1 from public.cca_stages where name ~ '^\s*\d+\s*\.\s*\S') then
    raise exception 'FALHOU: nome de coluna da esteira ainda começa com número';
  end if;
  raise notice '  ok  colunas da esteira sem número no nome';
end;
$$;

rollback;
