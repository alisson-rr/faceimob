-- =============================================================================
-- 0230 — CCA encerra por DISTRATO (não por OFF) e a coluna PENDENTE está ativa.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002300001';
  cca uuid := '00000000-0000-0000-0000-000002300002';
  v_deal  uuid;
  v_lost  uuid := (select id from public.pipeline_stages where code = 'lost' limit 1);
  v_ok    boolean;
begin
  if not exists (select 1 from public.cca_stages
                  where active and public.cca_stage_name_key(name) = 'PENDENTE') then
    raise exception 'FALHOU: a coluna PENDENTE devia estar ativa no quadro da CCA';
  end if;
  raise notice '  ok  coluna PENDENTE ativa';

  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c230.test', '{"full_name":"Corretor 230"}'),
    (cca, 'cca@c230.test', '{"full_name":"CCA 230"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (cca, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'PROPOSTA')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;

  -- CCA: OFF continua recusado.
  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.deals set stage_id = v_lost, status_detail = 'OFF', lost_reason = 'OFF' where id = v_deal;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALHOU: a CCA não devia marcar OFF';
  end if;
  raise notice '  ok  CCA não marca OFF';

  update public.deals set stage_id = v_lost, status_detail = '17. DISTRATO', lost_reason = '17. DISTRATO — teste'
   where id = v_deal;
  execute 'reset role';
  if (select public.deal_status_bare(status_detail) from public.deals where id = v_deal) <> 'DISTRATO' then
    raise exception 'FALHOU: a CCA devia encerrar por distrato';
  end if;
  raise notice '  ok  CCA encerra por distrato';

  -- Corretor segue sem distrato.
  update public.deals set stage_id = (select id from public.pipeline_stages where is_initial limit 1),
         status_detail = 'PROPOSTA', lost_reason = null where id = v_deal;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.deals set stage_id = v_lost, status_detail = '17. DISTRATO', lost_reason = '17. DISTRATO' where id = v_deal;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then
    raise exception 'FALHOU: o corretor não devia marcar distrato';
  end if;
  raise notice '  ok  corretor segue sem distrato';
end;
$$;

rollback;
