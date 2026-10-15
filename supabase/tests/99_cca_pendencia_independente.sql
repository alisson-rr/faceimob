\set ON_ERROR_STOP on
begin;
create function pg_temp.ok282(value boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(value,false) then raise exception 'FALHOU: %',label; end if;
  raise notice 'ok: %',label;
end $$;

do $$
declare
  cca uuid := '00000000-0000-0000-0000-000000028201';
  cor uuid := '00000000-0000-0000-0000-000000028202';
  ger uuid := '00000000-0000-0000-0000-000000028203';
  dir uuid := '00000000-0000-0000-0000-000000028204';
  negocio uuid;
  caso uuid;
  destino uuid;
  contrato uuid;
  comercial text;
  etapa uuid;
  mes date;
  n_history integer;
  n_notifications integer;
  n_emails integer;
  resposta jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cca,'cca@pendencia282.test','{"full_name":"Analista 282"}'),
    (cor,'cor@pendencia282.test','{"full_name":"Corretor 282"}'),
    (ger,'ger@pendencia282.test','{"full_name":"Gerente 282"}'),
    (dir,'dir@pendencia282.test','{"full_name":"Diretor 282"}');
  insert into public.user_roles(profile_id,role) values
    (cca,'cca'),(cor,'broker'),(ger,'manager'),(dir,'director') on conflict do nothing;
  select id into destino from public.cca_stages where public.cca_stage_name_key(name)='RESOLVER P/ ASSINAR BANCO' and active limit 1;
  select id into contrato from public.cca_stages where public.cca_stage_name_key(name)='EM CONTRATO' and active limit 1;
  insert into public.deals(stage_id,status_detail,month_base,document_review_status)
    values ((select id from public.pipeline_stages where code='contract'), 'EM CONTRATO',public.current_season_month(),'approved') returning id into negocio;
  insert into public.deal_clients(deal_id,ordinal,full_name) values (negocio,1,'Cliente contrato 282');
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (negocio,cor,'broker',1),(negocio,ger,'manager',1),(negocio,dir,'director',1) on conflict do nothing;
  insert into public.cca_cases(deal_id,status,stage_id,decided_at)
    values (negocio,'approved',contrato,now()) returning id into caso;
  update public.deals set status_detail='EM CONTRATO' where id=negocio;
  select status_detail,stage_id,month_base into comercial,etapa,mes from public.deals where id=negocio;
  update public.automation_settings set cca_move_email=false;

  perform set_config('request.jwt.claims',json_build_object('sub',cca,'role','authenticated')::text,true);
  set local role authenticated;
  resposta := public.move_cca_case(caso,destino,'Conferir assinatura no banco');
  reset role;
  perform pg_temp.ok282(not coalesce((resposta->>'already_moved')::boolean,false),'primeiro movimento é novo');
  perform pg_temp.ok282((select stage_id=destino and status='approved' from public.cca_cases where id=caso),'caso muda para a coluna interna');
  perform pg_temp.ok282((select status_detail=comercial and stage_id=etapa and month_base=mes and document_review_status='approved' from public.deals where id=negocio),'comercial mantém status, etapa, mês e conferência');
  perform pg_temp.ok282((select count(*)=3 from public.notifications where kind='cca_status_changed' and profile_id in(cor,ger,dir)),'comercial recebe exatamente um aviso por responsável');
  perform pg_temp.ok282((select count(distinct profile_id)=3 from public.cca_move_emails where deal_id=negocio and profile_id in(cor,ger,dir)),'e-mail da pendência é enfileirado para o comercial');
  perform pg_temp.ok282((select bool_and(detalhes->>'status2'=comercial) from public.cca_move_emails where deal_id=negocio and source='cca' and stage_name='RESOLVER P/ ASSINAR BANCO'),'e-mail não apresenta a pendência como novo status comercial');

  select count(*) into n_history from public.deal_history where deal_id=negocio;
  select count(*) into n_notifications from public.notifications;
  select count(*) into n_emails from public.cca_move_emails where deal_id=negocio;
  set local role authenticated;
  resposta := public.move_cca_case(caso,destino,'Clique repetido');
  reset role;
  perform pg_temp.ok282((resposta->>'already_moved')::boolean,'segunda tentativa informa que já foi feito');
  perform pg_temp.ok282((select count(*)=n_history from public.deal_history where deal_id=negocio),'segunda tentativa não duplica histórico');
  perform pg_temp.ok282((select count(*)=n_notifications from public.notifications),'segunda tentativa não duplica sino');
  perform pg_temp.ok282((select count(*)=n_emails from public.cca_move_emails where deal_id=negocio),'segunda tentativa não duplica e-mail');

  -- Repetições antigas ficam no histórico, mas uma só demanda aparece na síntese do mês.
  insert into public.deal_history(deal_id,actor_id,kind,to_value)
    values (negocio,cca,'comment','STATUS: RESOLVER P/ ASSINAR BANCO — repetição antiga');
  perform pg_temp.ok282((select count(*)=1 from public.cca_monthly_synthesis(date_trunc('month',now() at time zone 'America/Sao_Paulo')::date) where deal_id=negocio),'síntese elimina repetições do mesmo negócio e pendência');

  -- A competência comercial fechada não é reaberta por uma pendência interna.
  insert into public.closed_months(period) values(mes) on conflict do nothing;
  perform public.move_cca_case(caso,(select id from public.cca_stages where public.cca_stage_name_key(name)='AGUARDANDO DEMANDA MINIMA' and active limit 1),'Aguardando banco');
  perform pg_temp.ok282((select status_detail=comercial and stage_id=etapa and month_base=mes from public.deals where id=negocio),'pendência interna preserva negócio de mês fechado');

  perform set_config('request.jwt.claims',json_build_object('sub',cor,'role','authenticated')::text,true);
  set local role authenticated;
  perform pg_temp.ok282(exists(select 1 from public.cca_cases c join public.cca_stages s on s.id=c.stage_id where c.deal_id=negocio and public.cca_stage_is_independent(s.name)),'corretor pode consultar o selo da própria pendência');
  begin
    perform public.move_cca_case(caso,contrato,'Tentativa sem permissão');
    raise exception 'Corretor conseguiu mover a CCA';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.ok282(not has_function_privilege('anon','public.move_cca_case(uuid,uuid,text)','execute'),'anônimo não move casos');
end $$;
rollback;
