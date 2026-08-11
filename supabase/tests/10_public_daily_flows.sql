\set ON_ERROR_STOP on

\echo '== Diário e checkpoint públicos =='

create or replace function pg_temp.assert_true(got boolean, label text)
returns void
language plpgsql
as $$
begin
  if got is distinct from true then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  v_daily jsonb;
  v_checkpoint jsonb;
begin
  perform pg_temp.assert_true(
    (select p.provolatile = 'v'
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'public_daily_team'),
    'public_daily_team é VOLATILE porque atualiza last_seen_at'
  );

  perform pg_temp.assert_true(
    (select p.provolatile = 'v'
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'public_director_checkpoint'),
    'public_director_checkpoint é VOLATILE porque atualiza last_seen_at'
  );

  insert into public.public_links (kind, team_id, slug, pin_hash)
  select 'daily_team', t.id, 'test-daily-team-a', extensions.crypt('123456', extensions.gen_salt('bf', 6))
  from public.teams t
  where t.name = 'Equipe A';

  insert into public.public_links (kind, director_id, slug)
  values ('director_checkpoint', '00000000-0000-0000-0000-0000000000d1', 'test-director-open');

  v_daily := public.public_daily_team('test-daily-team-a', '123456');
  perform pg_temp.assert_true(v_daily ->> 'team_name' = 'Equipe A', 'PIN correto abre o Diário');

  v_checkpoint := public.public_director_checkpoint(
    'test-director-open',
    date_trunc('week', current_date)::date,
    null
  );
  perform pg_temp.assert_true(v_checkpoint ->> 'director' = 'Dora Diretora', 'checkpoint devolve o nome da diretora');
  perform pg_temp.assert_true(jsonb_array_length(v_checkpoint -> 'teams') = 2, 'checkpoint devolve as duas equipes');
  perform pg_temp.assert_true(
    (v_checkpoint -> 'teams' -> 0) ? 'team_id'
      and (v_checkpoint -> 'teams' -> 0) ? 'team_name',
    'equipes usam o contrato team_id/team_name'
  );

  insert into public.public_links (kind, director_id, slug, pin_hash)
  values (
    'director_checkpoint',
    '00000000-0000-0000-0000-0000000000d1',
    'test-director-pin',
    extensions.crypt('123456', extensions.gen_salt('bf', 6))
  );

  v_checkpoint := public.public_director_checkpoint('test-director-pin', current_date, null);
  perform pg_temp.assert_true(v_checkpoint = '{"pin_required": true}'::jsonb, 'link protegido pede PIN sem vazar dados');
  perform pg_temp.assert_true(
    public.public_director_checkpoint('test-director-pin', current_date, '999999') is null,
    'PIN incorreto não devolve dados'
  );
  perform pg_temp.assert_true(
    public.public_director_checkpoint('test-director-pin', current_date, '123456') ->> 'director' = 'Dora Diretora',
    'PIN correto abre o checkpoint'
  );
end;
$$;

\echo 'fluxos públicos ok'
