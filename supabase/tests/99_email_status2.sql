-- =============================================================================
-- 0177 — e-mail de movimentação leva os dados do negócio e a observação.
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
  adm uuid := '00000000-0000-0000-0000-000001770001';
  cor uuid := '00000000-0000-0000-0000-000001770002';
  ger uuid := '00000000-0000-0000-0000-000001770003';
  v_deal uuid;
  v_det jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (adm,'admin@email177.test','{"full_name":"Admin 177"}'),
    (cor,'broker@email177.test','{"full_name":"Tabhata 177"}'),
    (ger,'manager@email177.test','{"full_name":"Archimedes 177"}');
  insert into public.user_roles(profile_id,role) values (adm,'admin'),(ger,'manager') on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);
  update public.automation_settings set pipeline_move_email = true;
  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor,'06. ENVIO DE RP','ACQUA DANUBIO')
    returning id into v_deal;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (v_deal,cor,'broker',1),(v_deal,ger,'manager',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_deal,'JULYA 177','04367223051',1);

  perform set_config('request.jwt.claims',json_build_object('sub',adm,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.move_deal_status(v_deal, '12. EM PROCESSAMENTO', 'favor reanalizar');
  reset role;

  select detalhes into v_det from public.cca_move_emails
   where deal_id = v_deal and source = 'pipeline' limit 1;
  perform pg_temp.ok(v_det is not null, 'e-mail do Pipeline guarda os dados do negócio');
  perform pg_temp.ok(v_det->>'cliente' = 'JULYA 177' and v_det->>'cpf' = '04367223051', 'cliente e CPF completo');
  perform pg_temp.ok(v_det->>'empreendimento' = 'ACQUA DANUBIO', 'empreendimento');
  perform pg_temp.ok(v_det->>'corretor1' = 'Tabhata 177' and v_det->>'gerente1' = 'Archimedes 177', 'corretor 1 e gerente 1');
  perform pg_temp.ok(v_det->>'status2_antes' like '%ENVIO DE RP%', 'Status 2 anterior');
  perform pg_temp.ok(v_det->>'observacao' = 'favor reanalizar', 'observação da troca vai para o e-mail');
  perform pg_temp.ok(v_det->>'status2' like '%EM PROCESSAMENTO%', 'Status 2 novo');

  perform pg_temp.ok(
    (public.email_detalhes_do_negocio(v_deal)->>'corretor1') = 'Tabhata 177',
    'a edge monta os mesmos dados para o e-mail da CCA');
end
$$;

do $$
begin
  set local role authenticated;
  perform public.email_detalhes_do_negocio(gen_random_uuid());
  raise exception 'FALHOU: usuário logado leu dados de e-mail';
exception when insufficient_privilege then
  raise notice '  ok  dados do e-mail só para o servidor';
end
$$;

rollback;
