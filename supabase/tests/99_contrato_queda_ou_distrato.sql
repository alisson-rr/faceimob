-- 0341 — contrato não vai para OFF; a equipe encerra por Queda (mês vigente)
-- ou Distrato (mês anterior), e quem escolhe é o mês do negócio.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000003410001';
  v_mes date := public.month_start(coalesce(public.current_season_month(), current_date));
  v_contrato text := (select value from public.deal_statuses where public.deal_status_bare(value) = 'EM CONTRATO' limit 1);
  d_atual uuid; d_antigo uuid;
  v_msg text; v_res1 text; v_res2 text;
begin
  perform pg_temp.ok(v_contrato is not null, 'catálogo tem EM CONTRATO');
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@a341.test', '{"full_name":"Corretor 341"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, month_base)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, v_mes) returning id into d_atual;
  insert into public.deals (stage_id, created_by, month_base)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, (v_mes - interval '1 month')::date) returning id into d_antigo;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (d_atual, cor, 'broker', 1), (d_antigo, cor, 'broker', 1)
    on conflict do nothing;
  set local session_replication_role = replica;
  update public.deals set status_detail = v_contrato where id in (d_atual, d_antigo);
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.marcar_off(d_atual, 'cliente desistiu da compra');
    v_msg := 'passou';
  exception when others then v_msg := sqlerrm;
  end;
  v_res1 := public.encerrar_contrato(d_atual, 'banco reprovou o financiamento');
  v_res2 := public.encerrar_contrato(d_antigo, 'cliente desistiu depois de assinar');
  reset role;

  perform pg_temp.ok(v_msg like 'Negócio em contrato não vai para OFF%', 'contrato não vai para OFF');
  perform pg_temp.ok(v_res1 = 'QUEDA'
    and (select public.deal_status_bare(status_detail) = 'QUEDA' from public.deals where id = d_atual),
    'contrato do mês vigente vira Queda');
  perform pg_temp.ok(v_res2 = 'DISTRATO'
    and (select public.deal_status_bare(status_detail) = 'DISTRATO' from public.deals where id = d_antigo),
    'contrato de mês anterior vira Distrato');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = d_atual and kind = 'comment'
    and to_value = 'Equipe — QUEDA: banco reprovou o financiamento'), 'o motivo fica no histórico');
end;
$$;

select pg_temp.ok(not has_function_privilege('authenticated', 'public.encerrar_contrato_aplicar(uuid,text,text,text)', 'execute'),
  'o corpo interno não é chamável pelo logado');

rollback;
