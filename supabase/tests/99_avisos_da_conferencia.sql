-- =============================================================================
-- 0203 — avisos da conferência: push (sino) e e-mail a cada papel, sem repetir
-- o que a função de origem já avisa e sem avisar quem agiu. As contagens
-- olham só as pessoas deste arquivo: outros testes deixam administradores.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

create function pg_temp.como(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002030001';
  ger uuid := '00000000-0000-0000-0000-000002030002';
  dir uuid := '00000000-0000-0000-0000-000002030003';
  cor uuid := '00000000-0000-0000-0000-000002030004';
  cca uuid := '00000000-0000-0000-0000-000002030005';
  v_team uuid; v_dev uuid; v_lead uuid; v_type record;
  v_deal public.deals;
  n int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@a203.test', '{"full_name":"Admin 203"}'),
    (ger, 'ger@a203.test', '{"full_name":"Gerente 203"}'),
    (dir, 'dir@a203.test', '{"full_name":"Diretor 203"}'),
    (cor, 'cor@a203.test', '{"full_name":"Corretor 203"}'),
    (cca, 'cca@a203.test', '{"full_name":"CCA 203"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (dir, 'director'), (cor, 'broker'), (cca, 'cca')
  on conflict do nothing;
  insert into public.teams (name, manager_id, director_id) values ('Equipe 203', ger, dir) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);
  insert into public.developers (name, flow) values ('Construtora 203', 'internal') returning id into v_dev;
  delete from public.closed_months where period = public.month_start(current_date);
  update public.automation_settings set conferencia_email = true where id;
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 203', '11955203001', 'in_progress', cor) returning id into v_lead;

  perform pg_temp.como(cor);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '203', 300000);
  reset role;
  for v_type in select id, code from public.document_types where active and required_for_conversion loop
    insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal.id, v_type.id, 'a203/' || v_deal.id || '/' || v_type.code || '.pdf', v_type.code || '.pdf', v_type.code || '.pdf', cor);
  end loop;

  -- 1. Enviada para conferência.
  perform pg_temp.como(cor);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id, 'Dossiê completo');
  reset role;
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.ok((select count(*) from public.notifications where kind = 'document_review_requested' and profile_id = ger) = 1,
    'enviada: gerente recebe o push uma vez só');
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'document_review_requested' and profile_id = dir)
    and exists (select 1 from public.notifications where kind = 'document_review_requested' and profile_id = adm),
    'enviada: diretor e admin recebem push');
  perform pg_temp.ok(not exists (select 1 from public.notifications where kind = 'document_review_requested' and profile_id = cor),
    'enviada: quem enviou não recebe o próprio aviso');
  select count(*) into n from public.cca_move_emails where deal_id = v_deal.id and source = 'conferencia' and stage_name = 'Análise enviada para conferência'
     and profile_id in (ger, dir, adm, cor, cca);
  perform pg_temp.ok(n = 3, 'enviada: e-mail ao gerente, diretor e admin (' || n || ')');
  perform pg_temp.ok((select message from public.cca_move_emails where deal_id = v_deal.id and profile_id = ger and source = 'conferencia' limit 1)
    like '%Dossiê completo%', 'o e-mail leva a mensagem do envio');

  -- 2. Aprovada pelo gerente → CCA.
  perform pg_temp.como(ger);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;
  set constraints all immediate;
  set constraints all deferred;

  perform pg_temp.ok((select count(*) from public.notifications where kind = 'document_review_approved' and profile_id = cor) = 1,
    'aprovada: corretor recebe o push uma vez só');
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'document_review_approved' and profile_id = dir)
    and exists (select 1 from public.notifications where kind = 'document_review_approved' and profile_id = adm)
    and not exists (select 1 from public.notifications where kind = 'document_review_approved' and profile_id = ger),
    'aprovada: diretor e admin recebem push; o gerente que aprovou não');
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'cca_pending' and profile_id = cca),
    'aprovada: o CCA recebe o push de dossiê novo');
  select count(*) into n from public.cca_move_emails where deal_id = v_deal.id and source = 'conferencia' and stage_name = 'Análise aprovada e enviada ao CCA'
     and profile_id in (ger, dir, adm, cor, cca);
  perform pg_temp.ok(n = 4, 'aprovada: e-mail ao corretor, diretor, admin e CCA (' || n || ')');

  -- 3. Devolvida: outro negócio do mesmo corretor.
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 203b', '11955203002', 'in_progress', cor) returning id into v_lead;
  perform pg_temp.como(cor);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '203b', 250000);
  reset role;
  for v_type in select id, code from public.document_types where active and required_for_conversion loop
    insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal.id, v_type.id, 'a203b/' || v_deal.id || '/' || v_type.code || '.pdf', v_type.code || '.pdf', v_type.code || '.pdf', cor);
  end loop;
  perform pg_temp.como(cor);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id, 'Segue');
  reset role;
  perform pg_temp.como(ger);
  set local role authenticated;
  perform public.review_deal_documents(v_deal.id, false, 'Falta o comprovante de renda');
  reset role;
  set constraints all immediate;
  set constraints all deferred;
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'document_review_returned' and profile_id = dir),
    'devolvida: diretor recebe push');
  perform pg_temp.ok(exists (select 1 from public.cca_move_emails where deal_id = v_deal.id and profile_id = cor
                              and stage_name = 'Análise devolvida para ajustes' and message = 'Falta o comprovante de renda'),
    'devolvida: corretor recebe e-mail com o motivo');
end;
$$;

rollback;
