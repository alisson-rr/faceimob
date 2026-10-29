-- 0278: aprovação e envio ao CCA por diretor vinculado e pela hierarquia.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok278(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice 'ok: %', label;
end;
$$;
do $$
declare
  cor uuid := '00000000-0000-0000-0000-000000f27801';
  ger uuid := '00000000-0000-0000-0000-000000f27802';
  dir uuid := '00000000-0000-0000-0000-000000f27803';
  fora uuid := '00000000-0000-0000-0000-000000f27804';
  equipe uuid; dev uuid; negocio uuid; ator uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor,'cor@a278.test','{"full_name":"Corretor 278"}'),
    (ger,'ger@a278.test','{"full_name":"Gerente 278"}'),
    (dir,'dir@a278.test','{"full_name":"Diretor 278"}'),
    (fora,'fora@a278.test','{"full_name":"Diretor fora 278"}');
  delete from public.user_roles where profile_id in (cor,ger,dir,fora);
  insert into public.user_roles(profile_id,role) values
    (cor,'broker'),(ger,'manager'),(dir,'director'),(fora,'director');
  insert into public.teams(name,manager_id) values ('Equipe 278',ger) returning id into equipe;
  insert into public.team_members(team_id,profile_id) values (equipe,cor);
  insert into public.developers(name,flow) values ('Construtora 278','internal') returning id into dev;
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.deals(stage_id,developer_id,created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1),dev,cor) returning id into negocio;
  insert into public.deal_participants(deal_id,profile_id,role) values
    (negocio,cor,'broker'),(negocio,ger,'manager'),(negocio,dir,'director') on conflict do nothing;
  insert into public.deal_documents(deal_id,document_type_id,storage_path,original_name,stored_name,uploaded_by)
    select negocio,id,'278/'||negocio||'/'||code||'.pdf',code||'.pdf',code||'.pdf',cor
      from public.document_types where active and required_for_conversion;
  perform set_config('request.jwt.claims',json_build_object('sub',cor,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(negocio,'Dossiê para conferência');
  reset role;
  foreach ator in array array[cor,fora] loop
    perform set_config('request.jwt.claims',json_build_object('sub',ator,'role','authenticated')::text,true);
    set local role authenticated;
    begin
      perform public.review_deal_documents(negocio,true,null);
      raise exception 'FALHOU: pessoa sem autorização aprovou';
    exception when insufficient_privilege then raise notice 'ok: aprovação sem autorização bloqueada'; end;
    begin
      perform public.submit_deal_for_analysis(negocio);
      raise exception 'FALHOU: pessoa sem autorização enviou ao CCA';
    exception when insufficient_privilege then raise notice 'ok: envio direto sem autorização bloqueado'; end;
    reset role;
  end loop;
  -- Primeiro diretor participante, depois somente diretor da equipe e gerente.
  foreach ator in array array[dir,dir,ger] loop
    perform set_config('request.jwt.claims',json_build_object('sub',ator,'role','authenticated')::text,true);
    set local role authenticated;
    perform public.review_deal_documents(negocio,true,'Conferência 278');
    reset role;
    perform pg_temp.ok278(
      (select document_review_status='approved' and document_reviewed_by=ator from public.deals where id=negocio)
      and exists(select 1 from public.cca_cases where deal_id=negocio and status='under_review')
      and exists(select 1 from public.deal_history where deal_id=negocio and kind='document_review_approved' and actor_id=ator),
      'aprovação, envio ao CCA e auditoria pela liderança');
    update public.teams set director_id=dir where id=equipe;
    delete from public.deal_participants where deal_id=negocio and role='director';
    update public.cca_cases set status='pending_documents' where deal_id=negocio;
    perform set_config('request.jwt.claims',json_build_object('sub',cor,'role','authenticated')::text,true);
    set local role authenticated;
    perform public.submit_deal_for_manager_review(negocio,'Reenvio para conferência');
    reset role;
  end loop;
end;
$$;
rollback;
