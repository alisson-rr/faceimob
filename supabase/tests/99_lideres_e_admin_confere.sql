-- =============================================================================
-- 0199 — o corretor vê gerente e diretor para o negócio; negócio sem gerente
-- vai à conferência do admin.
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
  adm  uuid := '00000000-0000-0000-0000-000001990001';
  ger  uuid := '00000000-0000-0000-0000-000001990002';
  dir  uuid := '00000000-0000-0000-0000-000001990003';
  cor  uuid := '00000000-0000-0000-0000-000001990004';
  solo uuid := '00000000-0000-0000-0000-000001990005';
  v_team uuid;
  v_dev uuid;
  v_lead uuid;
  v_deal public.deals;
  v_type record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm,  'adm@l199.test',  '{"full_name":"Admin 199"}'),
    (ger,  'ger@l199.test',  '{"full_name":"Gerente 199"}'),
    (dir,  'dir@l199.test',  '{"full_name":"Diretor 199"}'),
    (cor,  'cor@l199.test',  '{"full_name":"Corretor 199"}'),
    (solo, 'solo@l199.test', '{"full_name":"Corretor Sem Equipe 199"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (ger, 'manager'), (dir, 'director'), (cor, 'broker'), (solo, 'broker')
  on conflict do nothing;
  insert into public.teams (name, manager_id, director_id) values ('Equipe 199', ger, dir) returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);

  -- 1. O corretor enxerga gerente e diretor e a liderança da própria equipe.
  perform pg_temp.como(cor);
  set local role authenticated;
  perform pg_temp.ok((select count(*) from public.selectable_leaders() where id in (ger, dir)) = 2,
    'corretor vê o gerente e o diretor na lista do negócio');
  perform pg_temp.ok((select is_manager and not is_director from public.selectable_leaders() where id = ger)
    and (select is_director from public.selectable_leaders() where id = dir), 'cada um com o seu papel');
  perform pg_temp.ok(exists (select 1 from public.lideranca_dos_corretores()
                              where broker_id = cor and manager_id = ger and director_id = dir),
    'a equipe do corretor sugere o gerente e o diretor dela');
  reset role;

  -- 2. Negócio de corretor sem equipe: sem gerente, o envio vai ao admin.
  insert into public.developers (name, flow) values ('Construtora 199', 'internal') returning id into v_dev;
  delete from public.closed_months where period = public.month_start(current_date);
  insert into public.leads (full_name, phone, status, assigned_to)
  values ('Cliente 199', '11955199001', 'in_progress', solo) returning id into v_lead;

  perform pg_temp.como(solo);
  set local role authenticated;
  v_deal := public.convert_lead_to_deal(v_lead, v_dev, null, '199', 300000);
  reset role;
  perform pg_temp.ok(not exists (select 1 from public.deal_participants where deal_id = v_deal.id and role = 'manager'),
    'negócio nasce sem gerente (corretor sem equipe)');

  for v_type in select id, code from public.document_types where active and required_for_conversion loop
    insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal.id, v_type.id, 'l199/' || v_deal.id || '/' || v_type.code || '.pdf', v_type.code || '.pdf', v_type.code || '.pdf', solo);
  end loop;

  perform pg_temp.como(solo);
  set local role authenticated;
  perform public.submit_deal_for_manager_review(v_deal.id, 'Dossiê sem gerente na equipe');
  reset role;
  perform pg_temp.ok((select document_review_status = 'pending' from public.deals where id = v_deal.id),
    'envio sem gerente é aceito');
  perform pg_temp.ok(exists (select 1 from public.notifications where profile_id = adm and kind = 'document_review_requested'),
    'o admin recebe o aviso para conferir');

  perform pg_temp.como(adm);
  set local role authenticated;
  perform pg_temp.ok(public.minhas_conferencias_pendentes() >= 1, 'o popup do admin conta o negócio sem gerente');
  perform public.review_deal_documents(v_deal.id, true, null);
  reset role;
  perform pg_temp.ok((select document_review_status = 'approved' from public.deals where id = v_deal.id),
    'o admin aprova na falta do gerente');

  perform pg_temp.como(ger);
  set local role authenticated;
  perform pg_temp.ok(public.minhas_conferencias_pendentes() = 0, 'gerente não conta negócio que não é dele');
  reset role;
end;
$$;

select pg_temp.ok(not has_function_privilege('anon', 'public.selectable_leaders()', 'execute')
  and not has_function_privilege('anon', 'public.lideranca_dos_corretores()', 'execute'), 'anon não lista líderes');

rollback;
