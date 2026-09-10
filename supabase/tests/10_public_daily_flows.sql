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

\echo '== 0038: notas, gerente e meio ponto entram; o mês volta dia a dia =='

do $$
declare
  team_a  uuid;
  bruno   uuid := '00000000-0000-0000-0000-0000000000b1';
  v_ontem date := current_date - 1;
  v_out   jsonb;
  v_daily jsonb;
  v_recusou boolean := false;
begin
  select id into team_a from public.teams where name = 'Equipe A';

  -- A tela manda o nome do gerente, as observações e meia venda (venda
  -- dividida entre dois corretores). Espaço nas pontas é cortado no banco.
  v_out := public.public_daily_submit('test-daily-team-a', '123456',
    jsonb_build_array(jsonb_build_object('profile_id', bruno::text, 'leads', 7, 'sales', 0.5)),
    '  Dia corrido, uma venda dividida.  ', ' Marco ');
  perform pg_temp.assert_true((v_out ->> 'saved')::int = 1, 'lançamento com meio ponto é aceito');
  perform pg_temp.assert_true(
    (select r.notes = 'Dia corrido, uma venda dividida.' and r.filled_by_name = 'Marco'
       from public.daily_reports r where r.team_id = team_a and r.report_date = current_date),
    'notas e gerente chegam ao daily_reports, sem espaços nas pontas');
  perform pg_temp.assert_true(
    (select e.sales = 0.5 and e.leads = 7
       from public.daily_entries e join public.daily_reports r on r.id = e.report_id
      where r.team_id = team_a and r.report_date = current_date and e.profile_id = bruno),
    'meia venda fica gravada como 0,5');

  -- Fora do passo de 0,5 o banco recusa (23514) em vez de arredondar em silêncio.
  begin
    perform public.public_daily_submit('test-daily-team-a', '123456',
      jsonb_build_array(jsonb_build_object('profile_id', bruno::text, 'leads', 2.3)));
  exception when check_violation then v_recusou := true;
  end;
  perform pg_temp.assert_true(v_recusou, '2,3 leads é recusado pela constraint de meio ponto');

  -- A chamada de 3 argumentos (contrato antigo) continua resolvendo pelos defaults,
  -- e o formulário é o estado inteiro do dia: sem notas, as notas somem.
  perform public.public_daily_submit('test-daily-team-a', '123456',
    jsonb_build_array(jsonb_build_object('profile_id', bruno::text, 'leads', 7, 'sales', 0.5)));
  perform pg_temp.assert_true(
    (select r.notes is null and r.filled_by_name is null
       from public.daily_reports r where r.team_id = team_a and r.report_date = current_date),
    'reenvio sem notas e sem gerente limpa os dois');

  -- Dia anterior gravado direto (seed, suporte): tem que aparecer no mês.
  insert into public.daily_reports (team_id, report_date, submitted_at, filled_by_name, notes)
  values (team_a, v_ontem, now() - interval '1 day', 'Marco', 'Ontem')
  on conflict (team_id, report_date) do nothing;
  insert into public.daily_entries (report_id, profile_id, leads)
  select r.id, bruno, 4 from public.daily_reports r
   where r.team_id = team_a and r.report_date = v_ontem
  on conflict do nothing;

  v_daily := public.public_daily_team('test-daily-team-a', '123456');
  perform pg_temp.assert_true((v_daily ->> 'today_date')::date = current_date,
    'a RPC diz qual é o hoje do banco');
  perform pg_temp.assert_true(v_daily -> 'month' ? current_date::text,
    'o mês traz o dia de hoje');
  perform pg_temp.assert_true(
    (select (e ->> 'sales')::numeric
       from jsonb_array_elements(v_daily -> 'month' -> current_date::text -> 'entries') e
      where e ->> 'profile_id' = bruno::text) = 0.5
    and (v_daily -> 'month' -> current_date::text) ? 'filled_by'
    and (v_daily -> 'month' -> current_date::text) ? 'notes',
    'cada dia do mês carrega gerente, notas e entradas');
  -- No dia 1 "ontem" é mês passado e fica fora de propósito.
  perform pg_temp.assert_true(
    extract(month from v_ontem) <> extract(month from current_date)
    or (select (e ->> 'leads')::numeric
          from jsonb_array_elements(v_daily -> 'month' -> v_ontem::text -> 'entries') e
         where e ->> 'profile_id' = bruno::text) = 4,
    'o dia anterior vem no mês com as entradas dele');
  perform pg_temp.assert_true(
    v_daily -> 'today' @> jsonb_build_array(jsonb_build_object('profile_id', bruno::text, 'leads', 7)),
    'a chave today continua no contrato');
end;
$$;

\echo '== 0039: o checkpoint da diretoria diz o gerente e soma o mês =='

do $$
declare
  v_checkpoint jsonb;
begin
  v_checkpoint := public.public_director_checkpoint(
    'test-director-open', date_trunc('week', current_date)::date, null);

  perform pg_temp.assert_true(
    (select jsonb_agg(t ->> 'manager_name') from jsonb_array_elements(v_checkpoint -> 'teams') t)
      @> '["Marco Gerente"]'::jsonb,
    'cada equipe vem com o nome do gerente');
  perform pg_temp.assert_true(
    (v_checkpoint -> 'month' ->> 'start')::date = date_trunc('month', current_date)::date
    and (v_checkpoint -> 'month' ->> 'end')::date = current_date,
    'o mês vai do dia 1 até hoje');
  perform pg_temp.assert_true(
    (v_checkpoint -> 'month' -> 'totals' ->> 'leads')::numeric >= 7
    and (v_checkpoint -> 'month' -> 'totals') ? 'visits_scheduled'
    and (v_checkpoint -> 'month' -> 'totals') ? 'visits_done',
    'o acumulado do mês soma as equipes e traz as visitas');
  perform pg_temp.assert_true(
    jsonb_typeof(v_checkpoint -> 'teams' -> 0 -> 'missing_days') = 'array',
    'as pendências continuam semanais por equipe');

  -- Semana de outro mês: o acumulado é daquele mês. Cinco semanas à frente
  -- nunca é o mês corrente e nunca tem lançamento.
  v_checkpoint := public.public_director_checkpoint(
    'test-director-open', (date_trunc('week', current_date) + interval '5 weeks')::date, null);
  perform pg_temp.assert_true(
    (v_checkpoint -> 'month' -> 'totals' ->> 'leads')::numeric = 0,
    'o mês acompanha a semana navegada (mês futuro vem zerado)');
end;
$$;

\echo 'fluxos públicos ok'
