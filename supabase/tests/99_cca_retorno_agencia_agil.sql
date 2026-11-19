\set ON_ERROR_STOP on
begin;
create function pg_temp.ok283(value boolean,label text) returns void language plpgsql as $$
begin
  if not coalesce(value,false) then raise exception 'FALHOU: %',label; end if;
  raise notice 'ok: %',label;
end $$;
do $$
declare
  analista uuid := '00000000-0000-0000-0000-000000028301';
  corretor uuid := '00000000-0000-0000-0000-000000028302';
  negocio uuid; caso uuid; agencia uuid; agil uuid; mes date; etapa uuid;
  entrada timestamptz; n integer; resposta jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (analista,'cca@agil283.test','{"full_name":"Analista 283"}'),
    (corretor,'cor@agil283.test','{"full_name":"Corretor 283"}');
  insert into public.user_roles(profile_id,role) values (analista,'cca'),(corretor,'broker') on conflict do nothing;
  select id into agencia from public.cca_stages where active and status='sent_to_agency'
    and public.cca_stage_name_key(name)='AGUARDANDO RETORNO AGENCIA' limit 1;
  select id into agil from public.cca_stages where active and public.cca_stage_name_key(name)='ESTEIRA AGIL' limit 1;
  insert into public.deals(stage_id,status_detail,month_base,document_review_status)
    values((select id from public.pipeline_stages where code='proposal'),'11. AG. RET. AGENCIA',public.current_season_month(),'approved') returning id into negocio;
  insert into public.deal_clients(deal_id,ordinal,full_name) values(negocio,1,'Cliente retorno 283');
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values(negocio,corretor,'broker',1);
  insert into public.cca_cases(deal_id,status,stage_id,submitted_at)
    values(negocio,'sent_to_agency',agencia,now()-interval '1 day') returning id into caso;
  update public.deals set status_detail='11. AG. RET. AGENCIA' where id=negocio;
  select month_base,stage_id into mes,etapa from public.deals where id=negocio;
  select submitted_at into entrada from public.cca_cases where id=caso;
  perform set_config('request.jwt.claims',json_build_object('sub',analista,'role','authenticated')::text,true);
  set local role authenticated;
  resposta := public.move_cca_case(caso,agil,'Agência retornou; continuar análise');
  reset role;
  perform pg_temp.ok283((select status='under_review' and stage_id=agil and submitted_at=entrada from public.cca_cases where id=caso),'CCA retorna à Ágil sem simular novo envio');
  perform pg_temp.ok283((select status_detail='13. ESTEIRA AGIL' and month_base=mes and stage_id=etapa and document_review_status='approved' from public.deals where id=negocio),'comercial acompanha sem alterar competência, etapa ou conferência');
  perform pg_temp.ok283(exists(select 1 from public.notifications where profile_id=corretor and kind='cca_status_changed'),'comercial recebe aviso');
  select count(*) into n from public.deal_history where deal_id=negocio;
  set local role authenticated;
  resposta := public.move_cca_case(caso,agil,'Tentativa repetida');
  reset role;
  perform pg_temp.ok283((resposta->>'already_moved')::boolean and (select count(*)=n from public.deal_history where deal_id=negocio),'repetição não duplica histórico');

  -- De outra coluna não existe atalho para um status protegido.
  perform public.move_cca_case(caso,(select id from public.cca_stages where active and name='PENDENTE' limit 1),'Aguardando documentos');
  begin
    perform public.move_cca_case(caso,agil,'Atalho indevido');
    raise exception 'Atalho para Ágil foi aceito';
  exception when sqlstate 'P0001' then
    if sqlerrm='Atalho para Ágil foi aceito' then raise; end if;
  end;
  perform pg_temp.ok283((select status='pending_documents' from public.cca_cases where id=caso),'movimento recusado preserva o caso');
  perform public.move_cca_case(caso,agencia,'Enviado à agência');
  insert into public.closed_months(period) values(mes) on conflict do nothing;
  begin
    perform public.move_cca_case(caso,agil,'Não reabrir mês fechado');
    raise exception 'Mês fechado foi alterado';
  exception when sqlstate 'P0001' then
    if sqlerrm='Mês fechado foi alterado' then raise; end if;
  end;
  perform pg_temp.ok283((select status_detail='11. AG. RET. AGENCIA' from public.deals where id=negocio),'mês fechado mantém status e caso');
  perform set_config('request.jwt.claims',json_build_object('sub',corretor,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.move_cca_case(caso,agil,'Corretor não opera CCA');
    raise exception 'Corretor conseguiu mover';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
