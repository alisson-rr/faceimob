-- =============================================================================
-- 0302 — o CCA move para ASSINADO BANCO e o Status 2 vira ASS. BANCO, mesmo com
-- a venda num mês já fechado; a venda continua no mês dela.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000003020001';
  ana    uuid := '00000000-0000-0000-0000-000003020002';
  v_mes  date := date '2020-02-01';
  v_deal uuid;
  v_case uuid;
  v_stage uuid;
  v_ok   boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c302.test', '{"full_name":"Corretor 302"}'),
    (ana, 'ana@c302.test', '{"full_name":"Analista 302"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ana, 'cca') on conflict do nothing;

  select id into v_stage from public.cca_stages where public.cca_stage_name_key(name) = 'ASSINADO BANCO' limit 1;
  if v_stage is null then raise exception 'FALHOU: a coluna ASSINADO BANCO deveria existir'; end if;
  if not exists (select 1 from public.cca_stages s join public.deal_statuses ds on ds.id = s.deal_status_id
                  where s.id = v_stage and public.deal_status_bare(ds.value) = 'ASS. BANCO') then
    raise exception 'FALHOU: a coluna ASSINADO BANCO deveria apontar para o Status 2 ASS. BANCO';
  end if;

  insert into public.deals (stage_id, created_by, status_detail, month_base)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, '04. EM CONTRATO', v_mes)
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;
  insert into public.cca_cases (deal_id, status) values (v_deal, 'approved') returning id into v_case;
  update public.deals set status_detail = '04. EM CONTRATO' where id = v_deal;
  insert into public.closed_months (period) values (v_mes) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.move_cca_case(v_case, v_stage, 'Contrato assinado no banco');
  execute 'reset role';

  if public.deal_status_bare((select status_detail from public.deals where id = v_deal)) <> 'ASS. BANCO' then
    raise exception 'FALHOU: o Status 2 deveria ser ASS. BANCO (veio %)', (select status_detail from public.deals where id = v_deal);
  end if;
  if (select month_base from public.deals where id = v_deal) <> v_mes then
    raise exception 'FALHOU: a venda deveria continuar no mês dela';
  end if;
  raise notice '  ok  ASSINADO BANCO pelo CCA vira ASS. BANCO no mês fechado';

  -- A exceção não abre o mês fechado para outras mudanças.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  perform set_config('faceimob.cca_contrato', v_deal::text, true);
  begin
    update public.deals set status_detail = '01. RC EMITIDA', notes = 'outra coisa' where id = v_deal;
    v_ok := true;
  exception when sqlstate 'P0001' then
    v_ok := false;
  end;
  if v_ok then raise exception 'FALHOU: mês fechado deveria travar mudança além do Status 2'; end if;
  raise notice '  ok  mês fechado segue travado para o resto';
end;
$$;

rollback;
