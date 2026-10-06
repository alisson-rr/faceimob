-- =============================================================================
-- 0184 — aviso mostra o nome do cliente no lugar do código do negócio.
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
  cor uuid := '00000000-0000-0000-0000-000001840001';
  v_deal uuid;
  v_sem  uuid;
  v_code text;
  v_code_sem text;
  n public.notifications;
begin
  insert into auth.users(id,email,raw_user_meta_data) values (cor,'cor@n184.test','{"full_name":"Corretor 184"}');
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.deals(stage_id,created_by,status_detail) values
    ((select id from public.pipeline_stages where is_initial limit 1),cor,'PROPOSTA') returning id, code into v_deal, v_code;
  insert into public.deal_clients(deal_id,full_name,ordinal) values (v_deal,'JOAO SILVA',1);
  insert into public.deals(stage_id,created_by,status_detail) values
    ((select id from public.pipeline_stages where is_initial limit 1),cor,'PROPOSTA') returning id, code into v_sem, v_code_sem;

  insert into public.notifications(profile_id,kind,title,body)
    values (cor,'teste','Documentos aprovados: ' || v_code, 'O negócio ' || v_code || ' seguiu para análise.')
    returning * into n;
  perform pg_temp.ok(n.title = 'Documentos aprovados: JOAO SILVA', 'título com o nome do cliente');
  perform pg_temp.ok(n.body = 'O negócio JOAO SILVA seguiu para análise.', 'texto com o nome do cliente');

  insert into public.notifications(profile_id,kind,title) values (cor,'teste','Novo negócio: ' || v_code_sem)
    returning * into n;
  perform pg_temp.ok(n.title = 'Novo negócio: ' || v_code_sem, 'sem cliente cadastrado o código fica');
end
$$;

rollback;
