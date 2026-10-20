-- =============================================================================
-- 0286 — CCA dá baixa na pendência do contrato, inclusive em mês fechado;
-- 0296 — com comentário obrigatório.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000002860001';
  ana    uuid := '00000000-0000-0000-0000-000002860002';
  v_deal uuid;
  v_mes  date := date '2020-01-01';
  v_ok   boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c286.test', '{"full_name":"Corretor 286"}'),
    (ana, 'ana@c286.test', '{"full_name":"Analista 286"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ana, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail, month_base)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'EM CONTRATO', v_mes)
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;
  update public.deals set contract_has_pending_issue = true where id = v_deal;
  insert into public.closed_months (period) values (v_mes) on conflict do nothing;

  -- Corretor não dá baixa.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.baixar_pendencia_contrato(v_deal, null);
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then raise exception 'FALHOU: corretor não pode dar baixa na pendência'; end if;
  raise notice '  ok  corretor não dá baixa';

  -- 0296: sem dizer o que foi sanado, nem o CCA dá baixa.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.baixar_pendencia_contrato(v_deal, '   ');
    v_ok := true;
  exception when sqlstate 'P0001' then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then raise exception 'FALHOU: baixa sem comentário deveria ser recusada'; end if;
  raise notice '  ok  baixa exige o comentário do que foi sanado';

  -- CCA dá baixa mesmo com o mês fechado.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.baixar_pendencia_contrato(v_deal, 'Assinatura recolhida');
  execute 'reset role';
  if (select contract_has_pending_issue from public.deals where id = v_deal) then
    raise exception 'FALHOU: o selo deveria sair';
  end if;
  if not exists (select 1 from public.deal_history
                  where deal_id = v_deal and kind = 'contract_pending_cleared' and actor_id = ana) then
    raise exception 'FALHOU: a baixa deveria ficar no histórico';
  end if;
  if not exists (select 1 from public.notifications
                  where profile_id = cor and kind = 'cca_contract_pending_cleared') then
    raise exception 'FALHOU: o corretor deveria ser avisado';
  end if;
  raise notice '  ok  CCA dá baixa em mês fechado, registra e avisa';

  -- A exceção do mês fechado não abre outras mudanças. Sem `set role`: a RLS
  -- fica de fora e quem decide é só a trava do mês.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  perform set_config('faceimob.baixa_pendencia', v_deal::text, true);
  begin
    update public.deals set notes = 'mexendo no mês fechado' where id = v_deal;
    v_ok := true;
  exception when sqlstate 'P0001' then
    v_ok := false;
  end;
  if v_ok then raise exception 'FALHOU: mês fechado deveria continuar travado para outras colunas'; end if;
  raise notice '  ok  mês fechado segue travado';
end;
$$;

rollback;
