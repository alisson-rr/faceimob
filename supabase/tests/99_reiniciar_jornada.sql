-- =============================================================================
-- 0320 — reiniciar a jornada: qualquer Status 2 menos a venda.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.status2(p_bare text) returns text language sql as $$
  select value from public.deal_statuses where active and public.deal_status_bare(value) = p_bare order by position, id limit 1
$$;

do $$
declare
  cor   uuid := '00000000-0000-0000-0000-000003200001';
  v_stage uuid;
  v_reprovado uuid;
  v_contrato uuid;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (cor, 'cor@c3200.test', '{"full_name":"Corretor 3200"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  select id into v_stage from public.pipeline_stages where is_initial limit 1;

  insert into public.deals (stage_id, created_by, status_detail)
    values (v_stage, cor, pg_temp.status2('REPROVADO')) returning id into v_reprovado;
  insert into public.deals (stage_id, created_by, status_detail)
    values (v_stage, cor, pg_temp.status2('EM CONTRATO')) returning id into v_contrato;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    select d, cor, 'broker', 1 from unnest(array[v_reprovado, v_contrato]) d on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reativar_negocio(v_reprovado, 'Reprovado na Caixa, vamos reavaliar', cor);
  begin perform public.reativar_negocio(v_contrato, 'Tentando reiniciar a venda', cor); v_msg := 'passou';
  exception when others then v_msg := sqlerrm; end;
  reset role;

  perform pg_temp.ok((select public.deal_status_bare(status_detail) = 'INCOMPLETO' and outcome = 'open'
                        from public.deals where id = v_reprovado),
    'REPROVADO reinicia direto para INCOMPLETO, sem passar por OFF');
  perform pg_temp.ok(v_msg like 'Negócio vendido não reinicia%',
    'negócio em contrato (venda) não reinicia: ' || coalesce(v_msg, '∅'));
end;
$$;

rollback;
