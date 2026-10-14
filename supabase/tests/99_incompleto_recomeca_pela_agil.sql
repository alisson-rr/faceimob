-- =============================================================================
-- 0278 — negócio que volta ao INCOMPLETO recomeça pela Esteira Ágil.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002780001';
  ger uuid := '00000000-0000-0000-0000-000002780002';
  v_deal uuid;
  v_legado uuid;
  v_ok boolean;
  v_dev uuid;
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
begin
  insert into public.developers (name, slug) values ('Construtora 278', 'construtora-278') returning id into v_dev;
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c278.test', '{"full_name":"Corretor 278"}'),
    (ger, 'ger@c278.test', '{"full_name":"Gerente 278"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ger, 'manager') on conflict do nothing;
  update public.document_types set required_for_conversion = false;

  -- 1. Volta ao INCOMPLETO: o caso aprovado é encerrado pelo gatilho.
  insert into public.deals (stage_id, created_by, document_review_status, developer_id)
    values (v_stage, cor, 'approved', v_dev) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal, ger, 'manager', 1) on conflict do nothing;
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at) values (v_deal, 'approved', now(), now());
  update public.deals set status_detail = 'INCOMPLETO' where id = v_deal;
  if (select status from public.cca_cases where deal_id = v_deal) <> 'cancelled' then
    raise exception 'FALHOU: voltar ao INCOMPLETO devia encerrar o caso aprovado';
  end if;
  raise notice '  ok  INCOMPLETO encerra o caso aprovado';

  -- 2. Caso reprovado também.
  update public.cca_cases set status = 'rejected', decided_at = now() where deal_id = v_deal;
  update public.deals set status_detail = 'ANÁLISE EXTERNA' where id = v_deal;
  update public.cca_cases set status = 'rejected', decided_at = now() where deal_id = v_deal;
  update public.deals set status_detail = 'INCOMPLETO' where id = v_deal;
  if (select status from public.cca_cases where deal_id = v_deal) <> 'cancelled' then
    raise exception 'FALHOU: INCOMPLETO devia encerrar o caso reprovado';
  end if;
  raise notice '  ok  INCOMPLETO encerra o caso reprovado';

  -- 3. Negócio que JÁ está em INCOMPLETO com caso aprovado (legado de hoje).
  insert into public.deals (stage_id, created_by, document_review_status, developer_id)
    values (v_stage, cor, 'approved', v_dev) returning id into v_legado;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_legado, cor, 'broker', 1), (v_legado, ger, 'manager', 1) on conflict do nothing;
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at) values (v_legado, 'approved', now(), now());
  alter table public.deals disable trigger deals_incompleto_encerra_casos;
  update public.deals set status_detail = 'INCOMPLETO' where id = v_legado;
  alter table public.deals enable trigger deals_incompleto_encerra_casos;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.submit_deal_for_manager_review(v_legado, 'tentando virar', 'virar');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then raise exception 'FALHOU: em INCOMPLETO o 2º envio (virar) devia estar fechado'; end if;
  raise notice '  ok  em INCOMPLETO o 2º envio fica fechado, mesmo com caso aprovado';

  perform public.submit_deal_for_manager_review(v_legado, 'Recomeço pela Ágil', 'agil');
  if (select status from public.cca_cases where deal_id = v_legado) <> 'cancelled'
     or (select review_esteira from public.deals where id = v_legado) <> 'agil'
     or (select document_review_status from public.deals where id = v_legado) <> 'pending' then
    raise exception 'FALHOU: Ágil a partir de INCOMPLETO devia encerrar o caso aprovado e ir ao gerente';
  end if;
  raise notice '  ok  Ágil a partir de INCOMPLETO encerra o caso aprovado e vai ao gerente';

  -- 4. Fora de INCOMPLETO nada muda: aprovado segue aprovado.
  perform set_config('request.jwt.claims', '', true);
  update public.deals set status_detail = 'ANÁLISE EXTERNA' where id = v_deal;
  update public.cca_cases set status = 'approved', decided_at = now() where deal_id = v_deal;
  update public.deals set status_detail = 'ANÁLISE EXTERNA', document_review_status = 'approved' where id = v_deal;
  if (select status from public.cca_cases where deal_id = v_deal) <> 'approved' then
    raise exception 'FALHOU: fora de INCOMPLETO o caso aprovado devia ficar';
  end if;
  raise notice '  ok  fora de INCOMPLETO o caso aprovado fica';
end;
$$;

rollback;
