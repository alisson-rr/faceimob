-- =============================================================================
-- 0179 — batida de CPF: ativo trava, encerrado é assumido, nunca duplica.
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
  cor_a uuid := '00000000-0000-0000-0000-000001790001';
  ger_a uuid := '00000000-0000-0000-0000-000001790002';
  cor_b uuid := '00000000-0000-0000-0000-000001790003';
  ger_b uuid := '00000000-0000-0000-0000-000001790004';
  v_time_b uuid;
  v_ativo uuid;
  v_queda uuid;
  v_novo uuid;
  r record;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (cor_a,'cor_a@cpf179.test','{"full_name":"Corretor A 179"}'),
    (ger_a,'ger_a@cpf179.test','{"full_name":"Gerente A 179"}'),
    (cor_b,'cor_b@cpf179.test','{"full_name":"Corretor B 179"}'),
    (ger_b,'ger_b@cpf179.test','{"full_name":"Gerente B 179"}');
  insert into public.user_roles(profile_id,role) values (ger_a,'manager'),(ger_b,'manager') on conflict do nothing;
  insert into public.teams(name, manager_id) values ('Equipe B 179', ger_b) returning id into v_time_b;
  insert into public.team_members(team_id, profile_id) values (v_time_b, cor_b);
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor_a,'06. ENVIO DE RP','X') returning id into v_ativo;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (v_ativo,cor_a,'broker',1),(v_ativo,ger_a,'manager',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_ativo,'JOAO ATIVO','111.444.777-35',1);

  insert into public.deals(stage_id,created_by,status_detail,lost_reason,project_name)
    values ((select id from public.pipeline_stages where code='lost'),cor_a,'18. QUEDA','18. QUEDA','Y') returning id into v_queda;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values
    (v_queda,cor_a,'broker',1),(v_queda,ger_a,'manager',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_queda,'MARIA QUEDA','52998224725',1);

  perform set_config('request.jwt.claims',json_build_object('sub',cor_b,'role','authenticated')::text,true);
  set local role authenticated;

  select * into r from public.negocio_do_cpf('11144477735');
  perform pg_temp.ok(r.situacao = 'ativo' and r.corretor = 'Corretor A 179' and r.gerente = 'Gerente A 179',
    'CPF ativo de outra equipe: mostra corretor e gerente');

  select * into r from public.negocio_do_cpf('529.982.247-25');
  perform pg_temp.ok(r.situacao = 'encerrado' and r.deal_id = v_queda, 'CPF em QUEDA aparece como encerrado');

  perform pg_temp.ok(not exists (select 1 from public.negocio_do_cpf('00000000191')), 'CPF sem negócio não devolve nada');

  begin
    perform public.assumir_negocio_do_cpf(v_ativo, 'quero assumir');
    raise exception 'FALHOU: assumiu negócio ativo';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  negócio ativo não é assumido';
  end;

  begin
    perform public.assumir_negocio_do_cpf(v_queda, '  ');
    raise exception 'FALHOU: assumiu sem comentário';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  assumir exige comentário';
  end;

  perform public.assumir_negocio_do_cpf(v_queda, 'Cliente voltou pelo site');
  reset role;

  perform pg_temp.ok(
    (select array_agg(profile_id order by role) from public.deal_participants where deal_id = v_queda)
      = array[cor_b, ger_b],
    'quem assume vira o corretor, com o gerente da equipe dele');
  perform pg_temp.ok(
    (select outcome = 'open' and public.deal_status_bare(status_detail) = 'PROPOSTA'
       and month_base = public.month_start(current_date) from public.deals where id = v_queda),
    'negócio reaberto em PROPOSTA no mês corrente');
  perform pg_temp.ok(
    exists (select 1 from public.deal_history where deal_id = v_queda and kind = 'comment'
              and to_value like '%Cliente voltou pelo site%'),
    'comentário no histórico');
  perform pg_temp.ok(
    (select count(*) from public.deal_clients where deal_id = v_queda) = 1,
    'dados do cliente continuam no negócio');

  -- Nunca outro negócio com o mesmo CPF.
  perform set_config('request.jwt.claims',json_build_object('sub',cor_b,'role','authenticated')::text,true);
  set local role authenticated;
  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor_b,'PROPOSTA','Z') returning id into v_novo;
  begin
    insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_novo,'JOAO DE NOVO','11144477735',1);
    raise exception 'FALHOU: gravou CPF repetido';
  exception when others then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice '  ok  CPF repetido recusado no banco (%)', sqlerrm;
  end;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_novo,'ANA NOVA','390.533.447-05',1);
  update public.deal_clients set full_name = 'ANA NOVA SILVA' where deal_id = v_novo;
  reset role;
  perform pg_temp.ok(true, 'CPF novo grava e edita normalmente');

  -- Repetido antigo (anterior à 0179) continua salvando pelo upsert da ficha.
  insert into public.deals(stage_id,created_by,status_detail,project_name)
    values ((select id from public.pipeline_stages where is_initial limit 1),cor_a,'PROPOSTA','W') returning id into v_novo;
  insert into public.deal_participants(deal_id,profile_id,role,ordinal) values (v_novo,cor_a,'broker',1) on conflict do nothing;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_novo,'JOAO LEGADO','11144477735',1);
  perform set_config('request.jwt.claims',json_build_object('sub',cor_a,'role','authenticated')::text,true);
  set local role authenticated;
  insert into public.deal_clients(deal_id,full_name,cpf,ordinal) values (v_novo,'JOAO LEGADO 2','111.444.777-35',1)
    on conflict (deal_id, ordinal) do update set full_name = excluded.full_name, cpf = excluded.cpf;
  reset role;
  perform pg_temp.ok((select full_name from public.deal_clients where deal_id = v_novo) = 'JOAO LEGADO 2',
    'repetido antigo continua salvando pela ficha');
end
$$;

rollback;
