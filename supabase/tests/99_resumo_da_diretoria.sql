-- =============================================================================
-- 0202 — o gerente vê o total da diretoria; o corretor não vê nada.
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
  dir  uuid := '00000000-0000-0000-0000-000002020001';
  g1   uuid := '00000000-0000-0000-0000-000002020002';
  g2   uuid := '00000000-0000-0000-0000-000002020003';
  c1   uuid := '00000000-0000-0000-0000-000002020004';
  c2   uuid := '00000000-0000-0000-0000-000002020005';
  t1 uuid; t2 uuid; v_dev uuid; v_grupo_venda uuid; v_etapa uuid;
  d1 uuid; d2 uuid; d3 uuid;
  v_mes date := public.month_start(current_date);
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dir, 'dir@r202.test', '{"full_name":"Diretor 202"}'),
    (g1,  'g1@r202.test',  '{"full_name":"Gerente Um 202"}'),
    (g2,  'g2@r202.test',  '{"full_name":"Gerente Dois 202"}'),
    (c1,  'c1@r202.test',  '{"full_name":"Corretor Um 202"}'),
    (c2,  'c2@r202.test',  '{"full_name":"Corretor Dois 202"}');
  insert into public.user_roles (profile_id, role) values
    (dir, 'director'), (g1, 'manager'), (g2, 'manager'), (c1, 'broker'), (c2, 'broker')
  on conflict do nothing;
  insert into public.teams (name, manager_id, director_id) values ('Equipe Um 202', g1, dir) returning id into t1;
  insert into public.teams (name, manager_id, director_id) values ('Equipe Dois 202', g2, dir) returning id into t2;
  insert into public.team_members (team_id, profile_id) values (t1, c1), (t2, c2);
  insert into public.developers (name, flow) values ('Construtora 202', 'internal') returning id into v_dev;
  select id into v_grupo_venda from public.deal_status_groups where code = 'VENDA';
  select id into v_etapa from public.pipeline_stages order by position limit 1;

  -- Equipe 1: uma venda fechada (100 mil). Equipe 2: uma em Status 1 VENDA
  -- (200 mil) e uma proposta aberta que não conta.
  insert into public.deals (code, developer_id, stage_id, month_base, outcome, closed_at, vgv_gross)
  values ('R202-1', v_dev, v_etapa, v_mes, 'won', now(), 100000) returning id into d1;
  insert into public.deals (code, developer_id, stage_id, month_base, outcome, vgv_gross, status_group_id)
  values ('R202-2', v_dev, v_etapa, v_mes, 'open', 200000, v_grupo_venda) returning id into d2;
  insert into public.deals (code, developer_id, stage_id, month_base, outcome, vgv_gross)
  values ('R202-3', v_dev, v_etapa, v_mes, 'open', 50000) returning id into d3;
  insert into public.deal_participants (deal_id, profile_id, role) values
    (d1, c1, 'broker'), (d2, c2, 'broker'), (d3, c2, 'broker');

  perform set_config('request.jwt.claims', json_build_object('sub', g1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.resumo_da_diretoria(v_mes)) = 2, 'o gerente vê as duas equipes da diretoria');
  select * into r from public.resumo_da_diretoria(v_mes) limit 1;
  perform pg_temp.ok(r.director_name = 'Diretor 202' and r.total_vendas = 2 and r.total_vgv = 300000,
    'total da diretoria: 2 vendas, R$ 300 mil (a proposta aberta não conta)');
  perform pg_temp.ok((select vendas from public.resumo_da_diretoria(v_mes) where team_name = 'Equipe Dois 202') = 1,
    'por equipe, com o gerente');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', c1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.resumo_da_diretoria(v_mes)) = 0, 'corretor não vê a diretoria');
  reset role;
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.resumo_da_diretoria(date)', 'execute'), 'anon não executa');

rollback;
