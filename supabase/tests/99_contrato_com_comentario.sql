-- =============================================================================
-- Aba Negócio (14/10/2026): admin coloca em contrato e confirma assinado pela
-- RPC de mover Status 2, e o comentário de cada passo vai para o histórico.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000000027901';
  cor uuid := '00000000-0000-0000-0000-000000027902';
  v_deal uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c279.test', '{"full_name":"Admin 279"}'),
    (cor, 'cor@c279.test', '{"full_name":"Corretor 279"}');
  insert into public.user_roles (profile_id, role) values (adm, 'admin'), (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'VIROU NEGÓCIO')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  perform public.move_deal_status(v_deal, 'EM CONTRATO', 'Contrato emitido, VGV conferido');
  if public.deal_status_bare((select status_detail from public.deals where id = v_deal)) <> 'EM CONTRATO' then
    raise exception 'FALHOU: admin devia colocar o negócio em contrato';
  end if;
  if not exists (select 1 from public.deal_history where deal_id = v_deal and kind = 'comment'
                  and to_value like '%Contrato emitido, VGV conferido') then
    raise exception 'FALHOU: o comentário do contrato devia ir para o histórico';
  end if;
  raise notice '  ok  VIROU NEGÓCIO -> EM CONTRATO com comentário no histórico';

  perform public.move_deal_status(v_deal, 'ASSINADO', 'Assinado em cartório');
  if public.deal_status_bare((select status_detail from public.deals where id = v_deal)) <> 'ASSINADO'
     or not exists (select 1 from public.deal_history where deal_id = v_deal and kind = 'comment'
                     and to_value like '%Assinado em cartório') then
    raise exception 'FALHOU: admin devia confirmar o assinado com comentário';
  end if;
  raise notice '  ok  EM CONTRATO -> ASSINADO com comentário no histórico';
end;
$$;

rollback;
