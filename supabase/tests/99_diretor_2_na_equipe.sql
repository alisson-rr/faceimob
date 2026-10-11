-- =============================================================================
-- 0266 — Diretor 2: os dois veem a equipe, os dois entram no negócio, cada um
-- leva meia venda no resumo da diretoria; só admin define o Diretor 2.
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
  fabio uuid := '00000000-0000-0000-0000-000002660001';
  archi uuid := '00000000-0000-0000-0000-000002660002';
  victor uuid := '00000000-0000-0000-0000-000002660003';
  cor uuid := '00000000-0000-0000-0000-000002660004';
  v_team uuid;
  v_deal uuid;
  v_n int;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (fabio, 'fabio@d266.test', '{"full_name":"Fabio 266"}'),
    (archi, 'archi@d266.test', '{"full_name":"Archimedes 266"}'),
    (victor, 'victor@d266.test', '{"full_name":"Victor 266"}'),
    (cor, 'cor@d266.test', '{"full_name":"Corretor 266"}');
  insert into public.user_roles (profile_id, role) values
    (fabio, 'director'), (archi, 'director'), (victor, 'manager'), (cor, 'broker') on conflict do nothing;
  insert into public.teams (name, slug, director_id, manager_id)
    values ('Equipe 266', 'equipe-266', fabio, victor) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  -- Diretor não define o Diretor 2.
  perform set_config('request.jwt.claims', json_build_object('sub', fabio, 'role', 'authenticated')::text, true);
  begin
    update public.teams set co_director_id = archi where id = v_team;
    raise exception 'FALHOU: diretor não devia definir o Diretor 2';
  exception when insufficient_privilege then
    raise notice '  ok  só admin define o Diretor 2';
  end;
  perform set_config('request.jwt.claims', '', true);
  update public.teams set co_director_id = archi where id = v_team;

  -- Archimedes vê o corretor da equipe.
  perform set_config('request.jwt.claims', json_build_object('sub', archi, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(exists (select 1 from public.auth_visible_profiles() v where v = cor), 'Diretor 2 vê os corretores da equipe');
  perform set_config('request.jwt.claims', '', true);

  -- Negócio criado pelo corretor (ele entra como corretor): os dois diretores entram sozinhos.
  insert into public.deals (stage_id, created_by, month_base, vgv_gross, outcome, closed_at)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor,
            date_trunc('month', current_date)::date, 200000, 'won', now())
    returning id into v_deal;
  select count(*) into v_n from public.deal_participants where deal_id = v_deal and role = 'director' and profile_id in (fabio, archi);
  perform pg_temp.ok(v_n = 2, 'os dois diretores entram no negócio');

  -- Resumo: meia venda para cada.
  perform set_config('request.jwt.claims', json_build_object('sub', archi, 'role', 'authenticated')::text, true);
  for r in select * from public.resumo_da_diretoria(current_date) where team_id = v_team loop
    perform pg_temp.ok(r.vendas = 0.5 and r.total_vendas = 0.5, format('meia venda para %s (%s)', r.director_name, r.vendas));
  end loop;
  select count(*) into v_n from public.resumo_da_diretoria(current_date) where team_id = v_team;
  perform pg_temp.ok(v_n = 2, 'a equipe aparece para os dois diretores no resumo');
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
