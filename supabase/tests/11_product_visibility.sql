-- Regras de produto: nomes dos participantes do próprio negócio e ranking da
-- equipe não podem ampliar a visibilidade de profiles/leads.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALHOU: % | esperado=% obtido=%', label, want, got;
  end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.become(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    false
  );
end;
$$;

do $$
declare
  bruno uuid := '00000000-0000-0000-0000-0000000000b1';
  bia uuid := '00000000-0000-0000-0000-0000000000b2';
  caio uuid := '00000000-0000-0000-0000-0000000000c1';
  v_deal uuid;
  v_season uuid;
begin
  v_season := public.current_game_season();
  if v_season is null then
    insert into public.game_seasons (label, period_start)
    values ('Temporada Visibilidade', current_date)
    returning id into v_season;
  end if;

  insert into public.game_events (season_id, profile_id, event_code, points) values
    (v_season, bruno, 'venda', 30),
    (v_season, bia,   'venda', 20),
    (v_season, caio,  'venda', 10);

  insert into public.deals (stage_id, created_by, vgv_gross, month_base)
  select id, bruno, 400000, public.month_start((current_date + interval '6 months')::date)
  from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

end
$$;

set role authenticated;
select pg_temp.become('00000000-0000-0000-0000-0000000000b1');

-- O cadastro do gerente continua fechado; só o nome ligado ao negócio abre.
select pg_temp.assert_eq(
  (select count(*)::int from public.profiles
   where id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'corretor não lê diretamente o profile do gerente');
select pg_temp.assert_eq(
  exists(select 1 from public.deal_participant_names()
         where role = 'manager' and full_name = 'Marco Gerente'),
  true, 'corretor lê o nome do gerente do próprio negócio');

-- Ranking alcança a colega da equipe A, mas não o corretor da equipe B.
select pg_temp.assert_eq(
  (select count(*)::int from public.visible_game_ranking(public.current_game_season())
   where profile_id = '00000000-0000-0000-0000-0000000000b2'),
  1, 'ranking inclui colega da equipe');
select pg_temp.assert_eq(
  (select count(*)::int from public.visible_game_ranking(public.current_game_season())
   where profile_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'ranking exclui corretor da outra equipe');

-- A abertura do ranking não altera a carteira.
select pg_temp.assert_eq(
  (select count(*)::int from public.leads where full_name = 'Cliente da Bia'),
  0, 'corretor continua sem ler o lead da colega');

reset role;
\echo 'visibilidade de produto ok'
