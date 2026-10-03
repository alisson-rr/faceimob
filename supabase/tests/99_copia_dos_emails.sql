-- =============================================================================
-- 0206 — cópia dos e-mails de movimento: o admin recebe tudo; o sócio só venda,
-- distrato e queda de venda; ninguém recebe duas vezes nem a cópia da própria
-- ação. As contagens olham só as pessoas deste arquivo.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.copias(p_deal uuid, p_quem uuid, p_stage text) returns int language sql as $$
  select count(*)::int from public.cca_move_emails
   where deal_id = p_deal and profile_id = p_quem and stage_name like p_stage;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002060001';
  soc uuid := '00000000-0000-0000-0000-000002060002';
  ger uuid := '00000000-0000-0000-0000-000002060003';
  cor uuid := '00000000-0000-0000-0000-000002060004';
  v_deal uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@c206.test', '{"full_name":"Admin 206"}'),
    (soc, 'socio@c206.test', '{"full_name":"Sócio 206"}'),
    (ger, 'ger@c206.test', '{"full_name":"Gerente 206"}'),
    (cor, 'cor@c206.test', '{"full_name":"Corretor 206"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (soc, 'partner'), (ger, 'manager'), (cor, 'broker')
  on conflict do nothing;
  delete from public.closed_months where period = public.month_start(current_date);
  update public.automation_settings set pipeline_move_email = true where id;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'PROPOSTA') returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal, ger, 'manager', 1) on conflict do nothing;
  insert into public.deal_clients (deal_id, full_name, ordinal) values (v_deal, 'Cliente 206', 1);
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);

  -- 1. Proposta: admin copiado, sócio não.
  update public.deals set status_detail = '06. ENVIO DE RP' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, '%ENVIO DE RP%') = 1, 'proposta: admin recebe a cópia');
  perform pg_temp.ok(pg_temp.copias(v_deal, soc, '%ENVIO DE RP%') = 0, 'proposta: sócio não recebe');
  perform pg_temp.ok(pg_temp.copias(v_deal, cor, '%ENVIO DE RP%') = 1 and pg_temp.copias(v_deal, ger, '%ENVIO DE RP%') = 1,
    'participantes seguem recebendo o aviso');
  perform pg_temp.ok((select bool_and(copia) from public.cca_move_emails where deal_id = v_deal and profile_id = adm)
    and (select bool_and(not copia) from public.cca_move_emails where deal_id = v_deal and profile_id = cor),
    'a cópia é marcada como cópia');

  -- 2. Virou venda: os dois copiados, uma vez cada.
  update public.deals set status_group_id = (select id from public.deal_status_groups where code = 'VENDA'),
                          status_detail = '01. RC EMITIDA' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, '%RC EMITIDA%') = 1 and pg_temp.copias(v_deal, soc, '%RC EMITIDA%') = 1,
    'venda: admin e sócio recebem uma cópia cada');

  -- 3. Caiu a venda: o sócio também vê a queda.
  update public.deals set status_group_id = (select id from public.deal_status_groups where code = 'OFF'),
                          status_detail = '18. QUEDA' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, soc, '%QUEDA%') = 1, 'queda de venda: sócio recebe');

  -- 4. Depois da queda, de volta à proposta: o sócio não recebe mais.
  update public.deals set status_group_id = (select id from public.deal_status_groups where code = 'PROPOSTA'),
                          status_detail = '12. EM PROCESSAMENTO' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, soc, '%EM PROCESSAMENTO%') = 0, 'fora da venda: sócio não recebe');
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, '%EM PROCESSAMENTO%') = 1, 'fora da venda: admin recebe');

  -- 5. O admin que move não recebe a cópia da própria ação.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update public.deals set status_detail = '16. PENDENTE' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, '%PENDENTE%') = 0, 'quem agiu não recebe a cópia');

  -- 6. Admin que já é participante não recebe em dobro.
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v_deal, adm, 'director', 1)
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  update public.deals set status_detail = '11. AG. RET. AGENCIA' where id = v_deal;
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, '%AG. RET. AGENCIA%') = 1, 'participante e admin: um e-mail só');

  -- 7. Outras origens (CCA, conferência) também são copiadas ao admin.
  insert into public.cca_move_emails (deal_id, profile_id, to_email, deal_code, stage_name, actor_name, message, source)
  values (v_deal, cor, 'cor@c206.test', 'C206', 'Análise devolvida para ajustes', 'Gerente 206', 'Falta renda', 'conferencia');
  perform pg_temp.ok(pg_temp.copias(v_deal, adm, 'Análise devolvida para ajustes') = 1
    and pg_temp.copias(v_deal, soc, 'Análise devolvida para ajustes') = 0,
    'conferência devolvida: admin copiado, sócio não');
end;
$$;

rollback;
