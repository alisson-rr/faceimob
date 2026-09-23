\set ON_ERROR_STOP on
begin;

create function pg_temp.check_pipeline(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000001570001';
  cor uuid := '00000000-0000-0000-0000-000001570002';
  ger uuid := '00000000-0000-0000-0000-000001570003';
  dir uuid := '00000000-0000-0000-0000-000001570004';
  v_deal uuid;
  v_case uuid;
  v_team uuid;
  v_stage uuid;
  v_stage2 uuid;
  v_ids uuid[];
  v_time timestamptz;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'admin@pipeline157.test','{"full_name":"Admin 157"}'),
    (cor,'broker@pipeline157.test','{"full_name":"Corretor 157"}'),
    (ger,'manager@pipeline157.test','{"full_name":"Gerente 157"}'),
    (dir,'director@pipeline157.test','{"full_name":"Diretor 157"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'),(ger,'manager'),(dir,'director') on conflict do nothing;
  insert into public.teams(name,manager_id,director_id) values ('Equipe 157',ger,dir) returning id into v_team;
  insert into public.team_members(team_id,profile_id) values (v_team,cor),(v_team,ger);
  delete from public.closed_months where period = public.month_start(current_date);
  update public.automation_settings set pipeline_move_email = false;
  insert into public.deals(stage_id,created_by,status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor,'PROPOSTA') returning id into v_deal;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (v_deal,cor,'broker',1),(v_deal,ger,'manager',1),(v_deal,dir,'director',1)
    on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,ordinal) values (v_deal,'Cliente 157',1);

  -- O banco barra a edição mesmo que alguém ignore o botão desabilitado.
  update public.role_permissions set allowed=false where role='broker' and permission='deals.edit_status_detail';
  perform set_config('request.jwt.claims',json_build_object('sub',cor,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    update public.deals set status_detail='16. PENDENTE' where id=v_deal;
    raise exception 'FALHOU: corretor alterou Status 2 revogado';
  exception when insufficient_privilege then null;
  end;
  update public.deals set notes='Continua editando outros campos',status_detail='PROPOSTA' where id=v_deal;
  reset role;
  perform pg_temp.check_pipeline((select notes='Continua editando outros campos' from public.deals where id=v_deal), 'status igual não bloqueia salvar outros campos');
  update public.role_permissions set allowed=true where role='broker' and permission='deals.edit_status_detail';
  set local role authenticated;
  update public.deals set status_detail='16. PENDENTE' where id=v_deal;
  reset role;
  perform pg_temp.check_pipeline(not exists(select 1 from public.cca_move_emails where deal_id=v_deal), 'e-mail desligado não enfileira');

  update public.automation_settings set pipeline_move_email=true;
  update public.deals set status_detail='12. EM PROCESSAMENTO' where id=v_deal;
  perform pg_temp.check_pipeline((select count(*)=3 from public.cca_move_emails where deal_id=v_deal and source='pipeline'), 'corretor, gerente e diretor recebem uma vez');
  perform pg_temp.check_pipeline((select bool_and(message like '%PENDENTE%' and message like '%EM PROCESSAMENTO%') from public.cca_move_emails where deal_id=v_deal), 'e-mail contém antes e depois');
  update public.deals set notes='Sem movimentação',status_detail='12. EM PROCESSAMENTO' where id=v_deal;
  perform pg_temp.check_pipeline((select count(*)=3 from public.cca_move_emails where deal_id=v_deal), 'salvar mesmo status não duplica');
  update public.deals set status_group_id=(select id from public.deal_status_groups where id is distinct from deals.status_group_id limit 1) where id=v_deal;
  perform pg_temp.check_pipeline((select count(*)=6 from public.cca_move_emails where deal_id=v_deal), 'Status 1 manual também enfileira');

  -- A CCA conserva o próprio aviso, sem e-mail duplicado do Pipeline.
  perform set_config('faceimob.cca_move','on',true);
  update public.deals set status_detail='16. PENDENTE' where id=v_deal;
  perform set_config('faceimob.cca_move','',true);
  perform pg_temp.check_pipeline((select count(*)=6 from public.cca_move_emails where deal_id=v_deal), 'movimento da CCA não duplica fila do Pipeline');
  update public.automation_settings set pipeline_move_email=false;
  perform public.dispatch_pending_cca_emails();
  perform pg_temp.check_pipeline((select bool_and(status='expired') from public.cca_move_emails where deal_id=v_deal), 'desligar expira pendências');

  insert into public.cca_stages(name,position,status,notify_sales) values ('Entrada 157',9991,'under_review',false) returning id into v_stage;
  insert into public.cca_stages(name,position,status,notify_sales) values ('Conferência 157',9992,'under_review',false) returning id into v_stage2;
  insert into public.cca_cases(deal_id,stage_id,status,submitted_at) values (v_deal,v_stage,'under_review',now()-interval '2 days') returning id,stage_entered_at into v_case,v_time;
  perform pg_temp.check_pipeline(v_time=now()-interval '2 days', 'contador começa na chegada');
  update public.cca_cases set decision_notes='Nota',stage_entered_at=now() where id=v_case;
  perform pg_temp.check_pipeline((select stage_entered_at=v_time from public.cca_cases where id=v_case), 'notas e tentativa de adulteração não zeram contador');
  update public.cca_cases set stage_id=v_stage2 where id=v_case;
  perform pg_temp.check_pipeline((select stage_entered_at=now() from public.cca_cases where id=v_case), 'troca entre colunas do mesmo desfecho zera contador');

  select array_agg(id order by position desc,id) into v_ids from public.cca_stages where active;
  set local role authenticated;
  begin
    perform public.reorder_cca_stages(v_ids);
    raise exception 'FALHOU: corretor reordenou CCA';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',adm,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.reorder_cca_stages(v_ids);
  reset role;
  perform pg_temp.check_pipeline((select array_agg(id order by position)=v_ids from public.cca_stages where active), 'admin reordena todas as colunas');
  begin
    perform public.reorder_cca_stages(array[v_stage,v_stage]);
    raise exception 'FALHOU: ordem duplicada foi aceita';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALHOU:%' then raise; end if;
  end;
  perform pg_temp.check_pipeline((select array_agg(id order by position)=v_ids from public.cca_stages where active), 'lista inválida não grava parcialmente');
end;
$$;
rollback;
