-- =============================================================================
-- 0178 — administrador sobe o negócio sem a conferência; etapa escolhida junto
-- com o Status 2 conta como etapa do Status 2.
-- =============================================================================
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
  adm uuid := '00000000-0000-0000-0000-000001780001';
  ger uuid := '00000000-0000-0000-0000-000001780002';
  v_contrato uuid := (select id from public.pipeline_stages where code = 'contract');
  v_deal uuid;
  v_deal2 uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'adm@r178.test','{"full_name":"Adm 178"}'),
    (ger,'ger@r178.test','{"full_name":"Ger 178"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'),(ger,'manager') on conflict do nothing;
  update public.deal_statuses set stage_id = v_contrato where value = '04. EM CONTRATO';
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),adm,'PROPOSTA','X') returning id into v_deal;
  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),ger,'PROPOSTA','Y') returning id into v_deal2;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values (v_deal2,ger,'manager',1)
    on conflict do nothing;

  -- O caso do cliente: Etapa "Contrato" + Status 2 "EM CONTRATO" na mesma gravação.
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'role','authenticated')::text,true);
  set local role authenticated;
  update public.deals set stage_id = v_contrato, status_detail = '04. EM CONTRATO',
         status_group_id = (select id from public.deal_status_groups where code = 'VENDA')
   where id = v_deal;
  reset role;
  perform pg_temp.ok((select stage_id from public.deals where id = v_deal) = v_contrato,
    'admin sobe para Contrato com etapa e Status 2 juntos');

  -- Etapa à mão, sem Status 2: o admin passa, o gerente continua cobrado.
  update public.deals set stage_id = (select id from public.pipeline_stages where is_initial limit 1),
         status_detail = 'PROPOSTA' where id = v_deal;
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'role','authenticated')::text,true);
  set local role authenticated;
  update public.deals set stage_id = v_contrato where id = v_deal;
  reset role;
  perform pg_temp.ok((select stage_id from public.deals where id = v_deal) = v_contrato,
    'admin move a etapa sem a conferência');

  perform set_config('request.jwt.claims',json_build_object('sub',ger,'role','authenticated')::text,true);
  begin
    set local role authenticated;
    update public.deals set stage_id = v_contrato where id = v_deal2;
    raise exception 'FALHOU: gerente moveu para Contrato sem conferência';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  gerente continua sem mover a etapa à mão sem conferência (%)', sqlerrm;
  end;
  reset role;
end
$$;

rollback;
