-- =============================================================================
-- Regressão da 0032 — o mês do negócio é o do ciclo do jogo, não o do calendário.
--
-- O defeito que motivou a migration: com a temporada de julho ainda aberta, um
-- negócio criado em 03/08 nascia com mês-base agosto (default da coluna) e
-- ficava de fora quando o admin encerrasse o ciclo "julho" em 05/08 — sumia do
-- fechamento e do congelamento do período a que pertence.
--
-- Cobre também os dois efeitos colaterais corrigidos junto: `close_game_season`
-- não trava mais mês nenhum, e `notify_lead_assigned` grava um link que existe.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check16(cond boolean, label text)
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

-- -----------------------------------------------------------------------------
-- Estado conhecido
--
-- Testes anteriores deixam temporada aberta (11) e mês fechado (02). O índice
-- `game_seasons_one_open` só admite uma temporada aberta, então o ponto de
-- partida aqui é "nenhuma aberta, nenhum mês travado".
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000c001';
  cor uuid := '00000000-0000-0000-0000-00000000c002';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@ciclo.test', '{"full_name":"Admin Ciclo"}'),
    (cor, 'cor@ciclo.test', '{"full_name":"Corretor Ciclo"}')
  on conflict do nothing;

  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (cor, 'broker')
  on conflict do nothing;

  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  delete from public.closed_months
   where period in (
     public.month_start(current_date),
     public.month_start((current_date - interval '1 month')::date),
     public.month_start((current_date + interval '1 month')::date)
   );
end
$$;

\echo '== 1. mês-base segue a temporada aberta =='

do $$
declare
  v_mes_anterior date := public.month_start((current_date - interval '1 month')::date);
  v_deal  uuid;
  v_month date;
begin
  insert into public.game_seasons (label, period_start)
  values ('Ciclo Anterior', v_mes_anterior + 4);

  -- Sem `month_base`: o default da coluna é o mês do calendário, e é justamente
  -- ele que o trigger tem que substituir pelo mês do ciclo.
  insert into public.deals (stage_id, created_by, vgv_gross)
  select id, '00000000-0000-0000-0000-00000000c002', 500000
  from public.pipeline_stages where code = 'proposal'
  returning id, month_base into v_deal, v_month;

  perform pg_temp.check16(v_month = v_mes_anterior,
    format('negócio novo nasce no mês do ciclo aberto (%s), não no do calendário (%s)',
           v_mes_anterior, public.month_start(current_date)));

  -- Mês-base escolhido à mão continua valendo: a substituição é só do default.
  insert into public.deals (stage_id, created_by, vgv_gross, month_base)
  select id, '00000000-0000-0000-0000-00000000c002', 100000,
         public.month_start((current_date + interval '6 months')::date)
  from public.pipeline_stages where code = 'proposal'
  returning month_base into v_month;

  perform pg_temp.check16(
    v_month = public.month_start((current_date + interval '6 months')::date),
    'mês-base informado explicitamente não é sobrescrito');
end
$$;

\echo '== 2. close_month_and_season() sem argumento fecha o mês do ciclo =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000c001';
  v_mes_anterior date := public.month_start((current_date - interval '1 month')::date);
  v_mes_atual    date := public.month_start(current_date);
  v_abertos int;
  v_res     jsonb;
begin
  select count(*) into v_abertos from public.deals
   where outcome = 'open' and month_base = v_mes_anterior;
  perform pg_temp.check16(v_abertos >= 1, 'há proposta aberta no mês do ciclo para migrar');

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  -- Sem p_period. Antes da 0032 isto fechava o mês do relógio e deixava o mês
  -- do ciclo aberto para sempre.
  v_res := public.close_month_and_season();

  perform pg_temp.check16((v_res ->> 'period')::date = v_mes_anterior,
    format('sem p_period, fecha o mês do ciclo (%s)', v_mes_anterior));

  perform pg_temp.check16(
    exists (select 1 from public.closed_months where period = v_mes_anterior),
    'o mês do ciclo entra em closed_months');

  perform pg_temp.check16((v_res ->> 'moved_deals')::int = v_abertos,
    format('as %s propostas abertas migraram', v_abertos));

  perform pg_temp.check16(
    not exists (select 1 from public.deals
                where outcome = 'open' and month_base = v_mes_anterior)
    and exists (select 1 from public.deals
                where outcome = 'open' and month_base = v_mes_atual),
    'nenhuma proposta aberta sobra no mês fechado');

  perform pg_temp.check16(
    exists (select 1 from public.game_seasons
            where id = (v_res ->> 'next_season_id')::uuid and closed_at is null),
    'a temporada seguinte abriu na mesma transação');
end
$$;

\echo '== 3. sem temporada aberta, vale o calendário =='

do $$
declare
  v_month date;
begin
  update public.game_seasons
     set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;

  perform pg_temp.check16(public.current_season_month() is null,
    'current_season_month() é nulo com o jogo parado');

  -- O mês corrente pode ter sido travado por um teste anterior; o guard recusaria
  -- o insert antes de chegarmos ao que interessa.
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals (stage_id, created_by, vgv_gross)
  select id, '00000000-0000-0000-0000-00000000c002', 200000
  from public.pipeline_stages where code = 'proposal'
  returning month_base into v_month;

  perform pg_temp.check16(v_month = public.month_start(current_date),
    'sem temporada aberta o negócio cai no mês do calendário');
end
$$;

\echo '== 4. close_game_season não trava mês =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000c001';
  v_antes  int;
  v_depois int;
begin
  insert into public.game_seasons (label, period_start)
  values ('Ciclo do Teste de Fechamento', current_date);

  select count(*) into v_antes from public.closed_months;

  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);

  -- p_close_month = true: o valor que antes gravava month_start(current_date)
  -- em closed_months sem migrar proposta nenhuma.
  perform public.close_game_season(null, true);

  select count(*) into v_depois from public.closed_months;

  perform pg_temp.check16(v_antes = v_depois,
    'close_game_season(null, true) não grava em closed_months');

  perform set_config('request.jwt.claims', '', false);
end
$$;

\echo '== 5. link da notificação de lead (F01) =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000c002';
  v_lead uuid;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Ciclo', '11966660001', 'assigned', cor)
  returning id into v_lead;

  insert into public.lead_assignments (lead_id, profile_id, deadline)
  values (v_lead, cor, now() + interval '10 minutes');

  perform pg_temp.check16(
    (select count(*) from public.notifications
      where kind = 'lead_assigned'
        and link = '/leads?lead=' || v_lead::text) = 2,
    'notify_lead_assigned grava /leads?lead=<id> nos dois canais');

  perform pg_temp.check16(
    not exists (select 1 from public.notifications
                where link = '/leads/' || v_lead::text),
    'a rota inexistente /leads/<id> não é mais gravada');
end
$$;

\echo 'ciclo do game ok'
