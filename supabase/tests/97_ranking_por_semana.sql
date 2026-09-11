\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- =============================================================================
-- 97 · Ranking recortado por semana (migration 0107)
--
-- O prefixo é de DOIS dígitos porque `scripts/validate-schema.sh` só varre
-- `supabase/tests/[0-9][0-9]_*.sql`: um arquivo `107_…` seria pulado em
-- silêncio, e um teste que não roda é pior que teste nenhum.
--
-- Três coisas são cobradas aqui, e todas são de "trocar o ganhador":
--
--  1. A semana é RECORTE da mesma pontuação. A soma das semanas tem de bater
--     com o total da temporada — se o recorte perdesse ou duplicasse evento,
--     o placar semanal e o da temporada contariam histórias diferentes.
--  2. O dia é o de America/Sao_Paulo. O banco roda em UTC: uma esteira das
--     21:30 de DOMINGO em Brasília já é segunda 00:30 em UTC e, sem a conversão,
--     pagaria o prêmio da semana seguinte. Este é o assert que mais importa.
--  3. A visibilidade NÃO afrouxa. Filtro de data é ortogonal a filtro de gente:
--     o corretor da outra equipe continua invisível na chamada com intervalo,
--     exatamente como na chamada sem intervalo (`can_see_game_profile`, 0060).
--
-- E a assinatura antiga (um argumento) continua devolvendo a temporada inteira
-- — `PipelineTopRanking`, `EngagementLayer` e o assert da 11 dependem dela.
--
-- UUIDs na faixa `…-000001070001+`, exclusiva deste arquivo.
-- =============================================================================

create or replace function pg_temp.check107(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.become107(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- `-1` = a pessoa NÃO apareceu no ranking. Separa "invisível" de "zero pontos",
-- que é a diferença entre um bug de visibilidade e uma semana sem venda.
create or replace function pg_temp.pontos107(p_season uuid, p_profile uuid, p_from date, p_to date)
returns int
language sql
stable
as $$
  select coalesce(
    (select r.points from public.visible_game_ranking(p_season, p_from, p_to) r
      where r.profile_id = p_profile),
    -1);
$$;

create or replace function pg_temp.pontos107_temporada(p_season uuid, p_profile uuid)
returns int
language sql
stable
as $$
  select coalesce(
    (select r.points from public.visible_game_ranking(p_season) r
      where r.profile_id = p_profile),
    -1);
$$;

-- -----------------------------------------------------------------------------
-- Cenário: Ana e Bento na mesma equipe; Caio numa equipe separada. Caio existe
-- só para provar o item 3 — sem ele, o teste passaria com uma função que
-- devolvesse a casa inteira.
-- -----------------------------------------------------------------------------
do $$
declare
  ana   uuid := '00000000-0000-0000-0000-000001070001';
  bento uuid := '00000000-0000-0000-0000-000001070002';
  caio  uuid := '00000000-0000-0000-0000-000001070003';
  time_a uuid := '00000000-0000-0000-0000-000001070011';
  time_b uuid := '00000000-0000-0000-0000-000001070012';
  v_season uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana,   'ana@semana107.test',   '{"full_name":"Ana Semana"}'),
    (bento, 'bento@semana107.test', '{"full_name":"Bento Semana"}'),
    (caio,  'caio@semana107.test',  '{"full_name":"Caio Semana"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (ana, 'broker'), (bento, 'broker'), (caio, 'broker')
  on conflict do nothing;

  insert into public.teams (id, name, slug, active) values
    (time_a, 'Equipe Semana A', 'equipe-semana-107-a', true),
    (time_b, 'Equipe Semana B', 'equipe-semana-107-b', true)
  on conflict do nothing;

  insert into public.team_members (team_id, profile_id) values
    (time_a, ana), (time_a, bento), (time_b, caio)
  on conflict do nothing;

  -- Só uma temporada aberta por vez (`game_seasons_one_open`): reaproveita a
  -- que já existir em vez de tentar abrir outra.
  v_season := public.current_game_season();
  if v_season is null then
    insert into public.game_seasons (label, period_start)
    values ('Temporada Semana 107', date '2026-09-01')
    returning id into v_season;
  end if;

  -- Datas fixas e com fuso explícito: o recorte não pode depender de quando o
  -- teste roda nem do TimeZone da sessão.
  --
  --   semana 1 = 07/09 (segunda) a 13/09 (domingo)
  --   semana 2 = 14/09 (segunda) a 20/09 (domingo)
  insert into public.game_events (season_id, profile_id, event_code, points, occurred_at) values
    (v_season, ana,   'venda',    30, timestamptz '2026-09-09 15:00-03'),  -- quarta, semana 1
    (v_season, ana,   'venda',    30, timestamptz '2026-09-16 15:00-03'),  -- quarta, semana 2
    -- A armadilha do fuso: 21:30 de DOMINGO em Brasília já é 2026-09-14 00:30
    -- em UTC. Lido em UTC, este evento migra para a semana 2 sozinho.
    (v_season, bento, 'esteira',  10, timestamptz '2026-09-13 21:30-03'),  -- domingo, semana 1
    -- O par dele, do outro lado da meia-noite de São Paulo: os dois eventos
    -- caem no mesmo dia UTC (14/09) e em semanas DIFERENTES em Brasília.
    (v_season, bento, 'aprovado',  5, timestamptz '2026-09-14 00:30-03'),  -- segunda, semana 2
    (v_season, caio,  'venda',   100, timestamptz '2026-09-09 15:00-03');  -- outra equipe
end
$$;

\echo '== 1. a semana recorta a MESMA pontuação da temporada =='

do $$
declare
  ana   uuid := '00000000-0000-0000-0000-000001070001';
  v_season uuid := public.current_game_season();
begin
  perform pg_temp.become107(ana);

  perform pg_temp.check107(
    pg_temp.pontos107(v_season, ana, date '2026-09-07', date '2026-09-13') = 30,
    'semana 1: Ana com os 30 da venda de quarta');
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, ana, date '2026-09-14', date '2026-09-20') = 30,
    'semana 2: Ana com os 30 da outra quarta');
  perform pg_temp.check107(
    pg_temp.pontos107_temporada(v_season, ana) = 60,
    'temporada inteira: a soma das duas semanas, pela assinatura de um argumento');

  -- Uma semana sem evento é ZERO, não ausência: a pessoa continua no ranking.
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, ana, date '2026-09-21', date '2026-09-27') = 0,
    'semana sem evento devolve zero, e não some com o corretor do placar');
end
$$;

\echo '== 2. a virada da semana é no fuso de São Paulo, não em UTC =='

do $$
declare
  ana   uuid := '00000000-0000-0000-0000-000001070001';
  bento uuid := '00000000-0000-0000-0000-000001070002';
  v_season uuid := public.current_game_season();
begin
  perform pg_temp.become107(ana);

  -- Sem `at time zone 'America/Sao_Paulo'`, a esteira das 21:30 de domingo
  -- (00:30 UTC de segunda) cairia na semana 2 e a aprovação das 00:30 de
  -- segunda (03:30 UTC de segunda) ficaria onde está: o prêmio de domingo à
  -- noite pagaria na semana errada.
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, bento, date '2026-09-07', date '2026-09-13') = 10,
    'domingo 21:30 de Brasília conta na semana que fecha naquele domingo');
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, bento, date '2026-09-14', date '2026-09-20') = 5,
    'segunda 00:30 de Brasília conta na semana que abre naquela segunda');
  perform pg_temp.check107(
    pg_temp.pontos107_temporada(v_season, bento) = 15,
    'e os dois juntos continuam sendo o total da temporada');
end
$$;

\echo '== 3. o filtro de data não amplia a visibilidade =='

do $$
declare
  ana   uuid := '00000000-0000-0000-0000-000001070001';
  caio  uuid := '00000000-0000-0000-0000-000001070003';
  bento uuid := '00000000-0000-0000-0000-000001070002';
  v_season uuid := public.current_game_season();
begin
  perform pg_temp.become107(ana);

  -- Premissa do assert seguinte: sem esta linha ele passaria pelo motivo errado.
  perform pg_temp.check107(
    pg_temp.pontos107_temporada(v_season, caio) = -1,
    'cenário: o corretor da outra equipe já era invisível na chamada sem intervalo');

  perform pg_temp.check107(
    pg_temp.pontos107(v_season, caio, date '2026-09-07', date '2026-09-13') = -1,
    'e continua invisível na chamada com intervalo — recorte de data não abre gente');
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, bento, date '2026-09-07', date '2026-09-13') = 10,
    'enquanto o colega da própria equipe continua visível na mesma chamada');

  -- O outro lado: quem enxerga a casa continua enxergando com o filtro ligado.
  perform pg_temp.become107(caio);
  perform pg_temp.check107(
    pg_temp.pontos107(v_season, ana, date '2026-09-07', date '2026-09-13') = -1,
    'e a recusa é recíproca: Caio também não lê a semana da equipe da Ana');
end
$$;

select set_config('request.jwt.claims', '', false);

\echo 'ranking por semana: ok'
