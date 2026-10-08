-- 0247 — CCA recebe toda movimentação; lista de ligação não depende da RLS.
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
  ator uuid := '00000000-0000-0000-0000-000002470001';
  cca2 uuid := '00000000-0000-0000-0000-000002470002';
  broker uuid := '00000000-0000-0000-0000-000002470003';
  gerente uuid := '00000000-0000-0000-0000-000002470004';
  v_deal uuid;
  v_case uuid;
  origem uuid;
  destino uuid;
  n int;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (ator,'ator.cca@teste.local','{"full_name":"CCA Atora"}'),
    (cca2,'outra.cca@teste.local','{"full_name":"CCA Colega"}'),
    (broker,'broker.247@teste.local','{"full_name":"Broker 247"}'),
    (gerente,'gerente.247@teste.local','{"full_name":"Gerente 247"}');
  insert into public.user_roles(profile_id,role) values
    (ator,'cca'),(cca2,'cca'),(broker,'broker'),(gerente,'manager') on conflict do nothing;
  insert into public.role_permissions(role,permission,allowed) values ('cca','cca.review',true)
    on conflict (role,permission) do update set allowed=true;
  update public.automation_settings set cca_move_email=true;

  select id into origem from public.cca_stages where active order by position limit 1;
  insert into public.cca_stages(name,position,status,notify_sales)
    values ('Sem aviso comercial 247',24700,'under_review',false) returning id into destino;
  insert into public.deals(stage_id,created_by)
    values ((select id from public.pipeline_stages where is_initial limit 1),broker) returning id into v_deal;
  insert into public.deal_clients(deal_id,full_name,ordinal) values (v_deal,'Cliente 247',1);
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (v_deal,broker,'broker',1),(v_deal,gerente,'manager',1) on conflict do nothing;
  insert into public.cca_cases(deal_id,stage_id,status)
    values (v_deal,origem,'under_review') returning id into v_case;

  perform set_config('request.jwt.claims',json_build_object('sub',ator,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.move_cca_case(v_case,destino,'Movimento interno sem aviso comercial');
  reset role;

  select count(*) into n from public.cca_move_emails e
   where e.deal_id=v_deal and e.source='cca' and e.profile_id in (ator,cca2);
  perform pg_temp.ok(n=2,'ator e toda equipe CCA recebem mesmo com notify_sales desligado');
  select count(*) into n from public.cca_move_emails e
   where e.deal_id=v_deal and e.source='cca' and e.profile_id in (broker,gerente);
  perform pg_temp.ok(n=2,'corretor e gerente relacionados também recebem e-mail');

  perform pg_temp.ok(not exists(
    select 1 from public.notifications n
     where n.kind='cca_status_changed' and n.profile_id in (broker,gerente)
  ),'notify_sales desligado continua bloqueando apenas o sino interno');
end;
$$;

rollback;
