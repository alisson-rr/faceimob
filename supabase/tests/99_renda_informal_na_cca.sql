-- 0332 — renda informal trava para o comercial com o negócio em análise na
-- CCA (pendência libera); CCA/admin corrige o nome do proponente com histórico.
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
  adm uuid := '00000000-0000-0000-0000-000003320001';
  cor uuid := '00000000-0000-0000-0000-000003320002';
  v_deal uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c332.test', '{"full_name":"Admin 332"}'),
    (cor, 'cor@c332.test', '{"full_name":"Corretor 332"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);

  insert into public.deals (stage_id, created_by, status_detail)
  values ((select id from public.pipeline_stages where is_initial limit 1), cor, '04. EM ANÁLISE')
  returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1)
  on conflict do nothing;
  insert into public.deal_clients (deal_id, full_name, ordinal, has_informal_income, monthly_income)
  values (v_deal, 'JOAO DA SILV', 1, true, 3000);
  set local session_replication_role = replica;
  insert into public.cca_cases (deal_id, status) values (v_deal, 'under_review');
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_com_cca(v_deal), 'negócio em análise está com o CCA');
  begin
    update public.deal_clients set monthly_income = 9000 where deal_id = v_deal;
    raise exception 'FALHOU: corretor alterou a renda informal em análise';
  exception when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    raise notice '  ok  comercial não altera a renda informal em análise (%)', sqlerrm;
  end;
  update public.deal_clients set phone = '51999990332' where deal_id = v_deal;
  perform pg_temp.ok((select phone = '51999990332' from public.deal_clients where deal_id = v_deal),
    'o resto do cadastro segue editável');
  begin
    perform public.cca_corrigir_nome_proponente(v_deal, 1, 'JOAO DA SILVA');
    raise exception 'FALHOU: corretor usou a correção do CCA';
  exception when insufficient_privilege then
    raise notice '  ok  corretor não usa a correção de nome do CCA';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.cca_corrigir_nome_proponente(v_deal, 1, '  JOAO   DA SILVA ');
  perform pg_temp.ok((select full_name = 'JOAO DA SILVA' from public.deal_clients where deal_id = v_deal),
    'nome corrigido e normalizado');
  perform pg_temp.ok(exists (select 1 from public.deal_history where deal_id = v_deal
    and to_value = 'NOME DO 1º PROPONENTE CORRIGIDO PELO CCA: JOAO DA SILV → JOAO DA SILVA'), 'a correção fica no histórico');

  set local session_replication_role = replica;
  update public.deals set status_detail = 'PENDENTE DOCUMENTO' where id = v_deal;
  set local session_replication_role = origin;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(not public.deal_com_cca(v_deal), 'devolvido em pendência não está com o CCA');
  update public.deal_clients set monthly_income = 9000 where deal_id = v_deal;
  perform pg_temp.ok((select monthly_income = 9000 from public.deal_clients where deal_id = v_deal),
    'em pendência o comercial corrige a renda');
end;
$$;

rollback;
