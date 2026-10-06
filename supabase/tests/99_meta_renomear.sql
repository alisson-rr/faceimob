-- =============================================================================
-- 99 · Renomear campanha na Meta (migration 0197)
--
--   1. Marketing renomeia: nasce 'executando' com o nome antigo e o novo, e
--      meta_action_finish encerra como as outras ações.
--   2. Corretor leva 42501; nome vazio, igual ao atual, conta desligada e
--      campanha sem conta levam 22023.
--   3. nome_novo só existe em renomear (a checagem da tabela segura).
--   4. Grants.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check197(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', label;
  end if;
  raise notice '  ok  %', label;
end;
$$;

create or replace function pg_temp.become197(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

/** Roda a RPC como a pessoa e devolve o SQLSTATE (ou 'ok'). */
create or replace function pg_temp.tenta197(user_id uuid, campanha uuid, nome text)
returns text language plpgsql as $$
begin
  perform pg_temp.become197(user_id);
  set local role authenticated;
  perform public.meta_action_renomear(campanha, nome);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end;
$$;

do $$
declare
  mkt  uuid := '00000000-0000-0000-0000-000001970001';
  cor  uuid := '00000000-0000-0000-0000-000001970002';
  liga uuid := '7f000000-0000-0000-0000-000001970001';
  desl uuid := '7f000000-0000-0000-0000-000001970002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (mkt, 'mara@t197.test', '{"full_name":"Mara Marketing 197"}'),
    (cor, 'caio@t197.test', '{"full_name":"Caio Corretor 197"}')
  on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (mkt, 'marketing'), (cor, 'broker')
  on conflict do nothing;
  insert into public.meta_ad_accounts (id, act_id, name, enabled) values
    (liga, 'act_1970001', 'Conta 0197', true),
    (desl, 'act_1970002', 'Conta desligada 0197', false);
  insert into public.ad_campaigns
    (id, external_id, platform, name, status, daily_budget, meta_account_id, meta_budget_level)
  values
    ('7e000000-0000-0000-0000-000001970001', 'camp-0197', 'meta', 'Velho 0197', 'ACTIVE', 100, liga, 'campaign'),
    ('7e000000-0000-0000-0000-000001970002', 'camp-0197-desl', 'meta', 'Desl 0197', 'ACTIVE', 100, desl, 'campaign'),
    ('7e000000-0000-0000-0000-000001970003', 'camp-0197-manual', 'meta', 'Manual 0197', 'ACTIVE', 100, null, null);
end
$$;

\echo '== 1. marketing renomeia =='
do $$
declare
  mkt uuid := '00000000-0000-0000-0000-000001970001';
  r   jsonb;
  a   record;
begin
  perform pg_temp.become197(mkt);
  set local role authenticated;
  r := public.meta_action_renomear('7e000000-0000-0000-0000-000001970001', '  Novo 0197  ');
  reset role;
  perform pg_temp.check197(r->>'status' = 'executando' and r->>'campaign_external_id' = 'camp-0197'
    and r->>'act_id' = 'act_1970001' and r->>'nome_anterior' = 'Velho 0197' and r->>'nome_novo' = 'Novo 0197',
    'devolve o que a edge precisa, com o nome aparado');
  select * into a from public.meta_actions where id = (r->>'action_id')::uuid;
  perform pg_temp.check197(a.acao = 'renomear' and a.status = 'executando' and a.campaign_name = 'Velho 0197'
    and a.nome_novo = 'Novo 0197' and a.requested_by = mkt and a.decided_by = mkt and a.executed_at is not null,
    'registro com quem pediu, o nome antigo e o novo');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.meta_action_finish(a.id, 'executada',
    '{"antes":{"name":"Velho 0197"},"depois":{"name":"Novo 0197"}}'::jsonb, null);
  perform pg_temp.check197((select status = 'executada' from public.meta_actions where id = a.id),
    'meta_action_finish encerra a troca de nome');
  perform pg_temp.check197((select daily_budget = 100 and status = 'ACTIVE' from public.ad_campaigns
                             where id = '7e000000-0000-0000-0000-000001970001'),
    'o encerramento não mexe em verba nem status');
end
$$;

\echo '== 2. travas =='
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970002', '7e000000-0000-0000-0000-000001970001', 'X') = '42501',
  'corretor não renomeia');
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970001', '7e000000-0000-0000-0000-000001970001', '   ') = '22023',
  'nome vazio é recusado');
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970001', '7e000000-0000-0000-0000-000001970001', repeat('a', 401)) = '22023',
  'nome acima de 400 caracteres é recusado');
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970001', '7e000000-0000-0000-0000-000001970001', 'Velho 0197') = '22023',
  'nome igual ao atual é recusado');
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970001', '7e000000-0000-0000-0000-000001970002', 'Outro') = '22023',
  'conta desligada é recusada');
select pg_temp.check197(
  pg_temp.tenta197('00000000-0000-0000-0000-000001970001', '7e000000-0000-0000-0000-000001970003', 'Outro') = '22023',
  'campanha sem conta da Meta é recusada');

\echo '== 3. nome_novo só em renomear =='
do $$
begin
  begin
    insert into public.meta_actions (campaign_external_id, origem, acao, nome_novo, status, decided_at)
    values ('camp-0197', 'manual', 'pausar', 'X', 'aprovada', now());
    raise exception 'FALHOU: aceitou nome em pausar';
  exception when check_violation then
    raise notice '  ok  nome_novo em pausar é recusado';
  end;
  begin
    insert into public.meta_actions (campaign_external_id, origem, acao, status, decided_at)
    values ('camp-0197', 'manual', 'renomear', 'aprovada', now());
    raise exception 'FALHOU: aceitou renomear sem nome';
  exception when check_violation then
    raise notice '  ok  renomear sem nome é recusado';
  end;
end
$$;

\echo '== 4. grants =='
select pg_temp.check197(not has_function_privilege('anon', 'public.meta_action_renomear(uuid, text)', 'execute'),
  'anon não renomeia');
select pg_temp.check197(has_function_privilege('authenticated', 'public.meta_action_renomear(uuid, text)', 'execute'),
  'authenticated chama (a permissão é conferida dentro)');

rollback;
