-- =============================================================================
-- 0208 — encerrar com motivo segue o Status 2: a etapa de que o perfil não sai
-- não trava o encerramento; OFF continua só com `deals.mark_off_distrato`; mover
-- a etapa à mão continua na matriz de etapa.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

-- Erro (sqlstate) ou 'ok' de um update como `quem`.
create function pg_temp.tenta(quem uuid, p_deal uuid, p_status text, p_stage text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', quem::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.deals
     set stage_id = (select id from public.pipeline_stages where code = p_stage),
         status_detail = coalesce(p_status, status_detail),
         lost_reason = case when p_stage = 'lost' then p_status end
   where id = p_deal;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002080001';
  cor uuid := '00000000-0000-0000-0000-000002080002';
  v_deal uuid;
  v_deal2 uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@e208.test', '{"full_name":"Admin 208"}'),
    (cor, 'cor@e208.test', '{"full_name":"Corretor 208"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);
  -- O corretor não sai de "Em Análise" (matriz de etapa do cliente).
  update public.stage_permissions set can_exit = false
   where role = 'broker' and stage_id = (select id from public.pipeline_stages where code = 'under_analysis');

  insert into public.deals (stage_id, created_by, status_detail)
  values ((select id from public.pipeline_stages where code = 'under_analysis'), cor, 'PENDENTE C/ RESTRIÇÃO')
  returning id into v_deal;
  insert into public.deals (stage_id, created_by, status_detail)
  values ((select id from public.pipeline_stages where code = 'under_analysis'), cor, 'PENDENTE C/ RESTRIÇÃO')
  returning id into v_deal2;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal2, cor, 'broker', 1) on conflict do nothing;

  perform pg_temp.ok(pg_temp.tenta(cor, v_deal, null, 'proposal') = '42501',
    'mover a etapa à mão continua na matriz de etapa');
  perform pg_temp.ok(pg_temp.tenta(cor, v_deal, 'OFF', 'lost') = '42501',
    'OFF continua só de quem marca OFF');
  perform pg_temp.ok(pg_temp.tenta(cor, v_deal, '18. QUEDA', 'lost') = 'ok',
    'corretor encerra por queda mesmo parado em Em Análise');
  perform pg_temp.ok((select outcome = 'lost' from public.deals where id = v_deal), 'o negócio fica perdido');
  perform pg_temp.ok(pg_temp.tenta(adm, v_deal2, 'OFF', 'lost') = 'ok', 'admin dá OFF em negócio parado em Em Análise');
  perform pg_temp.ok((select outcome = 'lost' and status_detail = 'OFF' from public.deals where id = v_deal2), 'OFF gravado');
end;
$$;

rollback;
