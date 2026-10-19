-- =============================================================================
-- 0291 — equipes por diretoria: diretor vê as dele, corretor é recusado, rateio
-- divide a venda entre os corretores.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  dir1 uuid := '00000000-0000-0000-0000-000002910001';
  dir2 uuid := '00000000-0000-0000-0000-000002910002';
  ger  uuid := '00000000-0000-0000-0000-000002910003';
  cor1 uuid := '00000000-0000-0000-0000-000002910004';
  cor2 uuid := '00000000-0000-0000-0000-000002910005';
  cor3 uuid := '00000000-0000-0000-0000-000002910006';
  v_t1 uuid; v_t2 uuid; v_deal uuid;
  v_mes date := public.month_start(coalesce(public.current_season_month(), current_date));
  v_vendas numeric; v_n int; v_ok boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (dir1, 'dir1@c291.test', '{"full_name":"Diretor Um 291"}'),
    (dir2, 'dir2@c291.test', '{"full_name":"Diretor Dois 291"}'),
    (ger,  'ger@c291.test',  '{"full_name":"Gerente 291"}'),
    (cor1, 'cor1@c291.test', '{"full_name":"Corretor Um 291"}'),
    (cor2, 'cor2@c291.test', '{"full_name":"Corretor Dois 291"}'),
    (cor3, 'cor3@c291.test', '{"full_name":"Corretor Tres 291"}');
  insert into public.user_roles (profile_id, role) values
    (dir1, 'director'), (dir2, 'director'), (ger, 'manager'), (cor1, 'broker'), (cor2, 'broker'), (cor3, 'broker')
  on conflict do nothing;
  insert into public.teams (name, slug, director_id, manager_id) values ('Equipe A 291', 'equipe-a-291', dir1, ger) returning id into v_t1;
  insert into public.teams (name, slug, director_id) values ('Equipe B 291', 'equipe-b-291', dir2) returning id into v_t2;
  insert into public.team_members (team_id, profile_id) values (v_t1, cor1), (v_t1, cor2), (v_t2, cor3);

  -- Venda a dois corretores no mês: meia venda para cada.
  -- Em contrato: o Status 1 VENDA conta como venda com o negócio ainda aberto.
  insert into public.deals (stage_id, created_by, status_detail, month_base)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor1, 'EM CONTRATO', v_mes)
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor1, 'broker', 1), (v_deal, cor2, 'broker', 2) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', dir1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.equipes_por_diretoria(v_mes) where equipe_nome like '%291';
  select vendas into v_vendas from public.equipes_por_diretoria(v_mes) where corretor_id = cor1;
  execute 'reset role';
  if v_n <> 2 then raise exception 'FALHOU: diretor 1 deveria ver só os 2 corretores da equipe dele (veio %)', v_n; end if;
  if v_vendas <> 0.5 then raise exception 'FALHOU: venda a dois corretores deveria contar meia (veio %)', v_vendas; end if;
  raise notice '  ok  diretor vê a própria diretoria e a venda rateada conta meia';

  perform set_config('request.jwt.claims', json_build_object('sub', cor1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.equipes_por_diretoria(v_mes);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then raise exception 'FALHOU: corretor não deveria ver as equipes por diretoria'; end if;
  raise notice '  ok  corretor recusado';
end;
$$;

rollback;
