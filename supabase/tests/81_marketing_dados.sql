-- =============================================================================
-- Regressão da 0081 — custo por VENDA e o negócio que contava duas vezes.
--
-- O que este arquivo prova:
--   1. `marketing_campaign_stats` devolve `sales` (negócio GANHO) separado de
--      `conversions` (negócio, incluindo proposta em aberto e venda perdida) —
--      é a diferença entre "custo/negócio" e "custo/venda" na tela;
--   2. um negócio ganho com leads de DUAS campanhas conta uma vez só, na
--      campanha do lead MAIS ANTIGO. Antes da 0081, o `distinct` era pelo par
--      (campanha, negócio): o mesmo VGV somava nas duas e o ROAS das duas
--      inflava — a soma das campanhas passava do VGV real da empresa;
--   3. a guarda de permissão continua: papel sem `reports.view_finance` leva
--      42501, e não tabela vazia (que se leria como "não vendi nada").
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check81(cond boolean, label text)
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

create or replace function pg_temp.become81(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cenário (como postgres, ignorando RLS)
--
--   Adão = admin · Caio = corretor (sem reports.view_finance)
--   Campanha A e campanha B, ambas sem construtora
--   Negócio GANHO de R$ 300.000 e negócio PERDIDO de R$ 100.000
--   Lead A1 (campanha A, mais antigo) e lead B1 (campanha B, mais novo)
--     apontam para o MESMO negócio ganho  ← o caso que inflava as duas
--   Lead A2 aponta para o negócio perdido ← conta em conversions, não em sales
--   Lead A3 não converteu
-- -----------------------------------------------------------------------------
do $$
declare
  adm  uuid := '00000000-0000-0000-0000-000000008101';
  cor  uuid := '00000000-0000-0000-0000-000000008102';
  v_stage uuid;
  v_won  uuid;
  v_lost uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adao@mkt81.test', '{"full_name":"Adão Admin 81"}'),
    (cor, 'caio@mkt81.test', '{"full_name":"Caio Corretor 81"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  insert into public.ad_campaigns (external_id, platform, name, total_spend) values
    ('camp-0081-a', 'meta',   'Campanha A 0081', 3000),
    ('camp-0081-b', 'google', 'Campanha B 0081', 1000);

  -- Mês fechado barraria o insert; nenhum outro teste depende deste período.
  delete from public.closed_months where period = date '2026-01-01';
  select id into v_stage from public.pipeline_stages where code = 'proposal';

  insert into public.deals (stage_id, created_by, month_base, outcome, closed_at, vgv_gross, vgv_net)
  values (v_stage, cor, '2026-01-01', 'won', now(), 300000, 300000)
  returning id into v_won;

  insert into public.deals (stage_id, created_by, month_base, outcome, closed_at, vgv_gross, vgv_net)
  values (v_stage, cor, '2026-01-01', 'lost', now(), 100000, 100000)
  returning id into v_lost;

  -- A ordem de `created_at` é o desempate da atribuição: o mais antigo ganha.
  insert into public.leads (full_name, phone, campaign_id, converted_deal_id, created_at) values
    ('Lead A1 0081', '11966660811', 'camp-0081-a', v_won,  now() - interval '3 days'),
    ('Lead B1 0081', '11966660812', 'camp-0081-b', v_won,  now() - interval '1 day'),
    ('Lead A2 0081', '11966660813', 'camp-0081-a', v_lost, now() - interval '2 days'),
    ('Lead A3 0081', '11966660814', 'camp-0081-a', null,   now() - interval '2 days');
end
$$;

\echo '== 1. venda não é a mesma coisa que negócio =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000008101';
  a record;
begin
  set role authenticated;
  perform pg_temp.become81(adm);

  select * into a from public.marketing_campaign_stats() s where s.campaign_id = 'camp-0081-a';

  perform pg_temp.check81(a.leads = 3, format('a campanha A conta os 3 leads (tem %s)', a.leads));
  -- Dois leads converteram: um no ganho, outro no perdido.
  perform pg_temp.check81(a.conversions = 2,
    format('conversions conta negócio, inclusive o perdido (tem %s)', a.conversions));
  -- E só um deles é venda. Custo/negócio = 3000/2 = 1.500; custo/venda = 3.000.
  perform pg_temp.check81(a.sales = 1,
    format('sales conta só o negócio GANHO (tem %s)', a.sales));
  perform pg_temp.check81(a.sales < a.conversions,
    'custo por venda e custo por negócio não podem ser o mesmo número aqui');
  perform pg_temp.check81(a.revenue = 300000,
    format('a receita é o VGV do negócio ganho (tem %s)', a.revenue));
  reset role;
end
$$;

\echo '== 2. o mesmo negócio não conta em duas campanhas =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000008101';
  b record;
  total numeric;
begin
  set role authenticated;
  perform pg_temp.become81(adm);

  select * into b from public.marketing_campaign_stats() s where s.campaign_id = 'camp-0081-b';

  perform pg_temp.check81(b.leads = 1, format('a campanha B conta o lead dela (tem %s)', b.leads));
  perform pg_temp.check81(b.conversions = 1,
    'o lead da campanha B aponta para negócio (a conversão é dele também)');
  -- O ponto da migration: a atribuição do VGV é do lead MAIS ANTIGO, que é o da
  -- campanha A. Antes, B levava os mesmos 300.000 e o ROAS dela dizia 300×.
  perform pg_temp.check81(b.sales = 0,
    format('a venda é atribuída à campanha do primeiro lead, não às duas (B tem %s)', b.sales));
  perform pg_temp.check81(b.revenue = 0,
    format('o VGV não é contado duas vezes (B tem %s)', b.revenue));

  select sum(s.revenue) into total
  from public.marketing_campaign_stats() s
  where s.campaign_id in ('camp-0081-a', 'camp-0081-b');
  perform pg_temp.check81(total = 300000,
    format('a soma das campanhas é o VGV real, não o dobro (tem %s)', total));
  reset role;
end
$$;

\echo '== 3. a guarda de permissão continua onde estava =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000008102';
begin
  set role authenticated;
  perform pg_temp.become81(cor);
  begin
    perform count(*) from public.marketing_campaign_stats();
    raise exception 'FALHOU: corretor leu marketing_campaign_stats';
  exception
    when insufficient_privilege then
      raise notice '  ok  corretor sem reports.view_finance leva 42501 (e não tabela vazia)';
    when sqlstate 'P0001' then
      if sqlerrm like 'FALHOU%' then raise; end if;
      raise notice '  ok  corretor não lê marketing_campaign_stats';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', false);
end
$$;

-- -----------------------------------------------------------------------------
-- Limpeza: só o que este arquivo criou.
-- -----------------------------------------------------------------------------
do $$
begin
  delete from public.leads where phone in ('11966660811', '11966660812', '11966660813', '11966660814');
  delete from public.deals where created_by = '00000000-0000-0000-0000-000000008102'
     and month_base = date '2026-01-01';
  delete from public.ad_campaigns where external_id in ('camp-0081-a', 'camp-0081-b');
end
$$;

\echo 'Marketing custo por venda e atribuição única (0081) ok'
