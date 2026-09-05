-- =============================================================================
-- 0058 — as duas saídas erradas do rateio automático de VGV.
--
-- 1. Tirar o ÚLTIMO corretor do negócio precisa zerar gerente e diretor. Antes
--    o `return` da guarda de divisão por zero vinha primeiro, e o gestor ficava
--    com o percentual que tivesse — a única linha com share num negócio sem
--    corretor nenhum.
--
-- 2. Corretor em DUAS equipes ativas precisa creditar sempre o mesmo gerente e
--    o mesmo diretor. O `limit 1` sem `order by` deixava a escolha para o
--    planejador do Postgres; passa a valer a filiação mais recente.
--
-- Os contratos que já existiam continuam cobrados aqui (100/n entre corretores,
-- arredondamento fechando em 100, gestor sempre em 0): quem mexer no rateio
-- para consertar um dos dois casos acima não pode quebrar o resto.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check58(cond boolean, label text)
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

\echo '== rateio de VGV (0058) =='

do $$
declare
  ger_a uuid := '00000000-0000-0000-0000-000000005801';
  dir_a uuid := '00000000-0000-0000-0000-000000005802';
  ger_b uuid := '00000000-0000-0000-0000-000000005803';
  dir_b uuid := '00000000-0000-0000-0000-000000005804';
  cor_1 uuid := '00000000-0000-0000-0000-000000005805';
  cor_2 uuid := '00000000-0000-0000-0000-000000005806';
  v_stage uuid;
  v_deal  uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_share numeric;
  v_soma  numeric;
  v_count int;
  v_manager uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ger_a, 'ger.a@rateio.test', '{"full_name":"Gerente Alfa"}'),
    (dir_a, 'dir.a@rateio.test', '{"full_name":"Diretor Alfa"}'),
    (ger_b, 'ger.b@rateio.test', '{"full_name":"Gerente Beta"}'),
    (dir_b, 'dir.b@rateio.test', '{"full_name":"Diretor Beta"}'),
    (cor_1, 'cor.1@rateio.test', '{"full_name":"Corretor Um"}'),
    (cor_2, 'cor.2@rateio.test', '{"full_name":"Corretor Dois"}');

  select id into v_stage from public.pipeline_stages where code = 'proposal';
  perform pg_temp.check58(v_stage is not null, 'catálogo de etapas carregado');

  -- `deals_guard_closed_month` é BEFORE INSERT e testes anteriores fecham meses.
  delete from public.closed_months where period = public.month_start(current_date);

  -- ---------------------------------------------------------------------------
  -- 1. Dois corretores dividem 100; o gestor entra e fica em 0.
  -- ---------------------------------------------------------------------------
  insert into public.deals (stage_id, vgv_gross) values (v_stage, 500000)
  returning id into v_deal;

  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, cor_1, 'broker'), (v_deal, cor_2, 'broker');
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, ger_a, 'manager');

  select sum(share_pct) into v_soma
    from public.deal_participants where deal_id = v_deal and role = 'broker';
  perform pg_temp.check58(v_soma = 100, 'dois corretores fecham 100% do rateio');

  select share_pct into v_share
    from public.deal_participants where deal_id = v_deal and profile_id = ger_a;
  perform pg_temp.check58(v_share = 0, 'gerente entra no negócio fora do rateio');

  -- ---------------------------------------------------------------------------
  -- 2. O caso da 0058: sai o último corretor e o gestor NÃO pode sobrar com
  --    percentual. Forçar o share do gerente antes é o que reproduz o defeito —
  --    com ele já em 0 o teste passaria pelo motivo errado.
  -- ---------------------------------------------------------------------------
  delete from public.deal_participants where deal_id = v_deal and profile_id = cor_2;
  update public.deal_participants
     set share_pct = 50 where deal_id = v_deal and profile_id = ger_a;

  delete from public.deal_participants where deal_id = v_deal and profile_id = cor_1;

  select count(*) into v_count
    from public.deal_participants where deal_id = v_deal and role = 'broker';
  perform pg_temp.check58(v_count = 0, 'o negócio ficou sem corretor');

  select share_pct into v_share
    from public.deal_participants where deal_id = v_deal and profile_id = ger_a;
  perform pg_temp.check58(v_share = 0,
    'sem corretor, o gerente é zerado — e não fica com a única fatia do negócio');

  -- ---------------------------------------------------------------------------
  -- 3. Corretor em duas equipes ativas: o autofill escolhe sempre a mesma —
  --    a filiação mais recente.
  -- ---------------------------------------------------------------------------
  insert into public.teams (name, slug, manager_id, director_id, active) values
    ('Rateio Alfa', 'rateio-alfa-58', ger_a, dir_a, true) returning id into v_team_a;
  insert into public.teams (name, slug, manager_id, director_id, active) values
    ('Rateio Beta', 'rateio-beta-58', ger_b, dir_b, true) returning id into v_team_b;

  insert into public.team_members (team_id, profile_id, joined_at) values
    (v_team_a, cor_1, current_date - 60),
    (v_team_b, cor_1, current_date - 5);

  insert into public.deals (stage_id, vgv_gross) values (v_stage, 300000)
  returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, cor_1, 'broker');

  select count(*) into v_count
    from public.team_members tm join public.teams t on t.id = tm.team_id
   where tm.profile_id = cor_1 and tm.left_at is null;
  perform pg_temp.check58(v_count = 2, 'cenário tem o corretor em duas equipes ativas');

  select profile_id into v_manager
    from public.deal_participants where deal_id = v_deal and role = 'manager';
  perform pg_temp.check58(v_manager = ger_b,
    'o autofill credita o gerente da equipe mais recente, não uma qualquer');

  select count(*) into v_count
    from public.deal_participants where deal_id = v_deal and profile_id = dir_b and role = 'director';
  perform pg_temp.check58(v_count = 1,
    'o diretor vem da MESMA equipe que o gerente');

  select count(*) into v_count
    from public.deal_participants
   where deal_id = v_deal and profile_id in (ger_a, dir_a);
  perform pg_temp.check58(v_count = 0,
    'ninguém da equipe antiga entra junto');

  -- E o corretor único continua com o rateio inteiro.
  select share_pct into v_share
    from public.deal_participants where deal_id = v_deal and profile_id = cor_1;
  perform pg_temp.check58(v_share = 100, 'corretor único leva 100% do rateio');
end;
$$;

\echo '== rateio de VGV: ok =='
