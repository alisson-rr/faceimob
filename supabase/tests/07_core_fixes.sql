-- =============================================================================
-- Regressão das correções da auditoria de 08/08 (migrations 0020–0022).
--
--   1. Triggers de log rodam com SECURITY DEFINER: usuário autenticado consegue
--      mudar status de lead / etapa de negócio e o log é gravado — antes o RLS
--      das tabelas de log derrubava o UPDATE inteiro em silêncio.
--   2. A matriz de estágios vale no SERVIDOR: mover negócio para etapa sem
--      permissão falha mesmo chamando a API direto, não só na UI.
--   3. assign_queued_leads(): lead preso em 'queued' entra na roleta quando
--      surge corretor elegível; lead em conversa SDR ativa NÃO é varrido.
--   4. close_month_and_season(): fecha mês + temporada numa transação; só
--      admin; mês já fechado é recusado.
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check7(cond boolean, label text)
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
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000ee01';
  cor uuid := '00000000-0000-0000-0000-00000000ee02';
  cor2 uuid := '00000000-0000-0000-0000-00000000ee03';
  v_team uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@core.test',  '{"full_name":"Admin Core"}'),
    (cor,  'cor@core.test',  '{"full_name":"Corretor Core"}'),
    (cor2, 'cor2@core.test', '{"full_name":"Corretor Core Dois"}');

  insert into public.user_roles (profile_id, role) values (adm, 'admin')
  on conflict do nothing;

  insert into public.teams (name, manager_id) values ('Equipe Core', adm)
  returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor), (v_team, cor2);

  -- O 02 fecha o mês corrente e o 03 reabre; garante aberto aqui de novo.
  delete from public.closed_months where period = public.month_start(current_date);
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Log de lead sob authenticated (0020: leads_log_changes SECURITY DEFINER)
-- -----------------------------------------------------------------------------
\echo '== 1. logs de auditoria sob authenticated =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000ee02';
  v_lead uuid;
begin
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Lead Log Core', '11977770001', 'assigned', cor)
  returning id into v_lead;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- Antes da 0020: "new row violates row-level security policy for lead_events".
  update public.leads set status = 'attending' where id = v_lead;

  reset role;

  perform pg_temp.check7(
    exists (select 1 from public.lead_events
            where lead_id = v_lead and kind = 'status_changed'
              and to_value = 'attending' and actor_id = cor),
    'corretor muda status do lead e o log é gravado');
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Matriz de estágios no servidor (0020: deals_guard_stage aplica a matriz)
-- -----------------------------------------------------------------------------
\echo '== 2. matriz de estágios aplicada no servidor =='

do $$
declare
  cor uuid := '00000000-0000-0000-0000-00000000ee02';
  v_deal uuid;
  v_de uuid;
  v_para uuid;
begin
  select id into v_de from public.pipeline_stages where code = 'proposal';
  select id into v_para from public.pipeline_stages where code = 'visit_scheduled';

  insert into public.deals (stage_id, created_by) values (v_de, cor)
  returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role)
  values (v_deal, cor, 'broker')
  on conflict do nothing;

  -- Sem linha na matriz = negado (o corretor aqui não tem papel além do
  -- default 'broker' em user_roles? não tem linha nenhuma — remove por via
  -- das dúvidas o que o seed concedeu para o estágio alvo).
  delete from public.stage_permissions where stage_id = v_para;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  begin
    update public.deals set stage_id = v_para where id = v_deal;
    raise exception 'FALHOU: mover para estágio sem permissão deveria ser negado';
  exception when others then
    if sqlerrm like 'Seu papel não pode%' then
      raise notice '  ok  mover para estágio sem permissão é negado no servidor';
    else
      raise;
    end if;
  end;

  reset role;

  -- Concede e tenta de novo: passa e o histórico registra a mudança
  -- (o INSERT em deal_history sob authenticated também prova a 0020).
  insert into public.user_roles (profile_id, role)
  values ('00000000-0000-0000-0000-00000000ee02', 'broker')
  on conflict do nothing;
  insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
  values (v_para, 'broker', true, true);
  -- Também precisa poder SAIR do estágio atual.
  insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
  values (v_de, 'broker', true, true)
  on conflict (stage_id, role) do update set can_exit = true;

  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  update public.deals set stage_id = v_para where id = v_deal;

  reset role;

  perform pg_temp.check7(
    exists (select 1 from public.deal_history
            where deal_id = v_deal and kind = 'stage_changed' and actor_id = cor),
    'com permissão o negócio move e o histórico registra sob authenticated');
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Varredura da fila (0020 assign_queued_leads + 0022 respeito ao SDR)
-- -----------------------------------------------------------------------------
\echo '== 3. varredura de leads presos em queued =='

do $$
declare
  cor2 uuid := '00000000-0000-0000-0000-00000000ee03';
  v_grupo uuid;
  v_shift uuid;
  v_lead uuid;
  v_lead_sdr uuid;
  v_done int;
begin
  -- Grupo novo, sem membros: o lead entra e fica preso em queued.
  insert into public.distribution_groups (name, slug, kind, active)
  values ('Grupo Varredura', 'grupo-varredura', 'specific', true)
  returning id into v_grupo;

  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Preso', '11977770002', v_grupo)
  returning id into v_lead;

  perform pg_temp.check7(public.assign_lead(v_lead) is null,
    'sem corretor elegível o lead fica em queued');

  -- Surge o corretor: entra no grupo e bate o ponto.
  insert into public.distribution_group_members (group_id, profile_id)
  values (v_grupo, cor2);
  insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
  values ('core24', 'Core 24h', '00:00', '00:00', '23:59', -2)
  returning id into v_shift;
  insert into public.checkins (profile_id, shift_id, work_date)
  values (cor2, v_shift, current_date);

  -- Lead em conversa SDR ativa não pode ser varrido (0022).
  insert into public.leads (full_name, phone, distribution_group_id)
  values ('Lead Em SDR', '11977770003', v_grupo)
  returning id into v_lead_sdr;
  insert into public.sdr_conversations (lead_id, status)
  values (v_lead_sdr, 'active');

  v_done := public.assign_queued_leads();

  perform pg_temp.check7(
    (select status = 'assigned' and assigned_to = cor2
       from public.leads where id = v_lead),
    'varredura atribuiu o lead preso quando surgiu corretor elegível');

  perform pg_temp.check7(
    (select status = 'queued' and assigned_to is null
       from public.leads where id = v_lead_sdr),
    'lead em conversa SDR ativa fica fora da varredura');
end
$$;

-- -----------------------------------------------------------------------------
-- 4. Fechamento de mês atômico (0021)
-- -----------------------------------------------------------------------------
\echo '== 4. fechamento de mês + temporada =='

do $$
declare
  adm uuid := '00000000-0000-0000-0000-00000000ee01';
  cor uuid := '00000000-0000-0000-0000-00000000ee02';
  v_stage uuid;
  v_deal uuid;
  v_out jsonb;
begin
  select id into v_stage from public.pipeline_stages where code = 'proposal';

  insert into public.deals (stage_id, month_base, created_by)
  values (v_stage, public.month_start(current_date), adm)
  returning id into v_deal;

  -- Não-admin é recusado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', cor::text, 'role', 'authenticated')::text, false);
  set local role authenticated;
  begin
    perform public.close_month_and_season();
    raise exception 'FALHOU: não-admin fechou o mês';
  exception when others then
    if sqlerrm like 'Apenas o administrador%' then
      raise notice '  ok  não-admin não fecha o mês';
    else
      raise;
    end if;
  end;
  reset role;

  -- Admin fecha: proposta aberta migra, mês trava, segunda chamada é recusada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm::text, 'role', 'authenticated')::text, false);
  set local role authenticated;

  v_out := public.close_month_and_season();

  perform pg_temp.check7((v_out->>'moved_deals')::int >= 1,
    'proposta aberta migrou para o mês seguinte');

  perform pg_temp.check7(
    (select month_base = (public.month_start(current_date) + interval '1 month')::date
       from public.deals where id = v_deal),
    'o negócio de teste está no mês seguinte');

  perform pg_temp.check7(
    exists (select 1 from public.closed_months
            where period = public.month_start(current_date)),
    'mês corrente ficou fechado');

  begin
    perform public.close_month_and_season();
    raise exception 'FALHOU: mês fechado aceitou fechar de novo';
  exception when others then
    if sqlerrm like 'O mês % já está fechado.' then
      raise notice '  ok  fechar mês já fechado é recusado';
    else
      raise;
    end if;
  end;

  reset role;
end
$$;

\echo 'correções de núcleo ok'
