-- =============================================================================
-- 0163 — a venda do jogo nasce no contrato (Status 1 VENDA), uma vez só.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- As travas de etapa (documento, conferência) têm testes próprios; aqui o que
-- importa é o jogo. Desligadas só dentro desta transação.
alter table public.deals disable trigger deals_guard_stage;
alter table public.deals disable trigger deals_guard_document_review;

create or replace function pg_temp.check163(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000000016301';
  v_deal uuid;
  v_sea  uuid;
  vendas int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@v0163.test', '{"full_name":"Corretor 0163"}') on conflict do nothing;
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;

  update public.game_seasons set closed_at = now(), period_end = greatest(period_start, current_date)
   where closed_at is null;
  insert into public.game_seasons (label, period_start) values ('Temporada 0163', current_date)
  returning id into v_sea;

  -- O gatilho deals_add_creator_participant põe o autor como corretor do negócio.
  insert into public.deals (stage_id, created_by, vgv_gross, status_detail)
  select id, cor, 300000, '08. VIROU NEGÓCIO' from public.pipeline_stages where code = 'proposal'
  returning id into v_deal;

  select count(*) into vendas from public.game_events
   where season_id = v_sea and ref_id = v_deal and event_code = 'venda';
  perform pg_temp.check163(vendas = 0, 'virou negócio ainda não é venda do jogo');

  update public.deals set status_detail = '04. EM CONTRATO' where id = v_deal;
  select count(*) into vendas from public.game_events
   where season_id = v_sea and ref_id = v_deal and event_code = 'venda' and profile_id = cor;
  perform pg_temp.check163(vendas = 1, 'em contrato pontua a venda do corretor');

  -- Com a trava de etapa desligada o desfecho não sai da etapa: vai junto.
  update public.deals set stage_id = (select id from public.pipeline_stages where code = 'closed'), outcome = 'won', closed_at = now()
   where id = v_deal;
  perform pg_temp.check163((select outcome from public.deals where id = v_deal) = 'won', 'negócio fechado');
  select count(*) into vendas from public.game_events
   where season_id = v_sea and ref_id = v_deal and event_code = 'venda';
  perform pg_temp.check163(vendas = 1, 'fechar depois do contrato não pontua a venda de novo');

  update public.deals set stage_id = (select id from public.pipeline_stages where code = 'lost'),
         outcome = 'lost', closed_at = now(), lost_reason = 'Distrato'
   where id = v_deal;
  perform pg_temp.check163(exists (select 1 from public.game_events
    where season_id = v_sea and ref_id = v_deal and event_code = 'distrato' and profile_id = cor),
    'perder depois do contrato é distrato');

  perform pg_temp.check163(not exists (select 1 from public.role_permissions
    where role = 'broker' and permission = 'menu.gamification'), 'corretor sem a aba Game');
  perform pg_temp.check163(exists (select 1 from public.role_permissions
    where role = 'manager' and permission = 'menu.gamification'), 'gerente continua com a aba Game');
end
$$;

rollback;
