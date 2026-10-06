-- =============================================================================
-- 0231 — aviso de negócio leva ao negócio; REPROVADO → OFF por quem edita.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002310001';
  v_deal  uuid;
  v_outro uuid;
  v_link  text;
  v_lost  uuid := (select id from public.pipeline_stages where code = 'lost' limit 1);
  v_ini   uuid := (select id from public.pipeline_stages where is_initial limit 1);
  v_ok    boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c231.test', '{"full_name":"Corretor 231"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail) values (v_ini, cor, 'PROPOSTA') returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, cor, 'broker', 1) on conflict do nothing;

  -- 1. Um negócio na transação: o aviso aponta para ele.
  perform set_config('faceimob.negocio_da_transacao', '', true);
  update public.deals set notes = 'x' where id = v_deal;
  insert into public.notifications (profile_id, kind, title, link) values (cor, 'teste', 'Aviso', '/pipeline')
    returning link into v_link;
  if v_link <> '/pipeline?negocio=' || v_deal then
    raise exception 'FALHOU: aviso devia apontar para o negócio (%)', v_link;
  end if;
  raise notice '  ok  aviso de /pipeline ganha ?negocio=<id>';

  -- Dois negócios na mesma transação: sem id.
  insert into public.deals (stage_id, created_by, status_detail) values (v_ini, cor, 'PROPOSTA') returning id into v_outro;
  insert into public.notifications (profile_id, kind, title, link) values (cor, 'teste', 'Aviso', '/cca')
    returning link into v_link;
  if v_link <> '/cca' then
    raise exception 'FALHOU: com dois negócios o aviso não pode escolher um (%)', v_link;
  end if;
  raise notice '  ok  dois negócios na transação: aviso sem id';

  -- 2. OFF: de PROPOSTA o corretor não marca; de REPROVADO marca.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.deals set stage_id = v_lost, status_detail = 'OFF', lost_reason = 'OFF' where id = v_deal;
    v_ok := true;
  exception when insufficient_privilege or raise_exception then
    v_ok := false;
  end;
  execute 'reset role';
  if v_ok then
    raise exception 'FALHOU: corretor não marca OFF fora do REPROVADO';
  end if;
  raise notice '  ok  OFF continua travado fora do REPROVADO';

  update public.deals set status_detail = '19. REPROVADO', lost_reason = '19. REPROVADO', stage_id = v_lost where id = v_deal;
  execute 'set local role authenticated';
  update public.deals set status_detail = 'OFF', lost_reason = 'OFF — reprovado arquivado' where id = v_deal;
  execute 'reset role';
  if (select public.deal_status_bare(status_detail) from public.deals where id = v_deal) <> 'OFF' then
    raise exception 'FALHOU: REPROVADO devia virar OFF pelo corretor';
  end if;
  raise notice '  ok  corretor arquiva REPROVADO como OFF';
end;
$$;

rollback;
