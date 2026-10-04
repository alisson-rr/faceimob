-- =============================================================================
-- 0214 — Funil de Vendas: leads → docs → aprovadas → vendas por diretoria, a
-- régua da imobiliária, os parados há mais de 3 dias e quem pode ver o quê.
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

create function pg_temp.negocio(corretor uuid, status2 text, grupo text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.deals (stage_id, created_by, status_detail, status_group_id)
  values ((select id from public.pipeline_stages where is_initial limit 1), corretor, status2,
          (select id from public.deal_status_groups where code = grupo))
  returning id into v;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values (v, corretor, 'broker', 1) on conflict do nothing;
  insert into public.deal_clients (deal_id, full_name, ordinal) values (v, 'Cliente ' || status2, 1);
  return v;
end;
$$;

do $$
declare
  adm uuid := '00000000-0000-0000-0000-000002140001';
  dir uuid := '00000000-0000-0000-0000-000002140002';
  ger uuid := '00000000-0000-0000-0000-000002140003';
  cor uuid := '00000000-0000-0000-0000-000002140004';
  fora uuid := '00000000-0000-0000-0000-000002140005';
  v_team uuid;
  d_docs uuid; d_aprov uuid; d_venda uuid; d_fora uuid;
  mes date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
  v_msg text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (adm, 'adm@f214.test', '{"full_name":"Admin 214"}'),
    (dir, 'dir@f214.test', '{"full_name":"Diretora 214"}'),
    (ger, 'ger@f214.test', '{"full_name":"Gerente 214"}'),
    (cor, 'cor@f214.test', '{"full_name":"Corretor 214"}'),
    (fora, 'fora@f214.test', '{"full_name":"Fora 214"}');
  insert into public.user_roles (profile_id, role) values
    (adm, 'admin'), (dir, 'director'), (ger, 'manager'), (cor, 'broker'), (fora, 'broker')
  on conflict do nothing;
  insert into public.teams (name, slug, director_id, manager_id) values ('Equipe 214', 'equipe-214', dir, ger)
    returning id into v_team;
  insert into public.team_members (team_id, profile_id) values (v_team, cor);
  delete from public.closed_months where period = mes;

  -- 3 leads do corretor da diretoria, 2 de quem está fora dela.
  insert into public.leads (full_name, phone, status, assigned_to)
  select 'Lead 214 #' || i, '1195521400' || i, 'assigned', case when i <= 3 then cor else fora end
    from generate_series(1, 5) i;

  d_docs  := pg_temp.negocio(cor, '12. EM PROCESSAMENTO', 'PROPOSTA');
  d_aprov := pg_temp.negocio(cor, '09. APROV. TOTAL', 'PROPOSTA');
  d_venda := pg_temp.negocio(cor, '04. EM CONTRATO', 'VENDA');
  d_fora  := pg_temp.negocio(fora, '10. APROV. COND.', 'PROPOSTA');
  update public.deals set status_detail_changed_at = now() - interval '5 days' where id in (d_aprov, d_fora);

  -- 1. O gatilho marca quando o Status 2 muda.
  perform pg_temp.ok((select status_detail_changed_at > now() - interval '1 minute' from public.deals where id = d_docs),
    'negócio novo nasce com a data do Status 2');
  update public.deals set status_detail = '11. AG. RET. AGENCIA' where id = d_docs;
  perform pg_temp.ok((select status_detail_changed_at > now() - interval '1 minute' from public.deals where id = d_docs),
    'mudar o Status 2 atualiza a data');

  -- 2. A diretoria: 3 leads, 3 docs, 2 aprovadas (a aprovada e a venda), 1 venda.
  perform pg_temp.como(dir);
  set local role authenticated;
  r := public.funil_de_vendas(mes, dir);
  reset role;
  perform pg_temp.ok(r -> 'recorte' = '{"leads":3,"docs":3,"aprovadas":2,"vendas":1}'::jsonb,
    'diretoria: 3 leads, 3 docs, 2 aprovadas, 1 venda (' || (r ->> 'recorte') || ')');
  perform pg_temp.ok((r -> 'imob' ->> 'docs')::int >= 4 and (r -> 'imob' ->> 'leads')::int >= 5,
    'a régua da imobiliária conta também quem está fora da diretoria');
  perform pg_temp.ok(jsonb_path_exists(r -> 'parados', '$[*] ? (@.deal_id == $id)', jsonb_build_object('id', d_aprov)),
    'aprovada parada há 5 dias aparece no alerta');
  perform pg_temp.ok(not jsonb_path_exists(r -> 'parados', '$[*] ? (@.deal_id == $id)', jsonb_build_object('id', d_fora)),
    'o parado de fora da diretoria não aparece para ela');
  perform pg_temp.ok(not jsonb_path_exists(r -> 'parados', '$[*] ? (@.deal_id == $id)', jsonb_build_object('id', d_docs)),
    'quem ainda está em análise não entra no alerta');
  perform pg_temp.ok((r ->> 'pode_ver_imob')::boolean is false, 'diretora não abre a imobiliária inteira');

  -- 3. Alcance.
  perform pg_temp.como(ger);
  set local role authenticated;
  r := public.funil_de_vendas(mes, dir);
  reset role;
  perform pg_temp.ok((r -> 'recorte' ->> 'vendas')::int = 1, 'o gerente da equipe vê a diretoria dele');

  perform pg_temp.como(cor);
  set local role authenticated;
  begin
    perform public.funil_de_vendas(mes, dir);
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'negado';
  end;
  reset role;
  perform pg_temp.ok(v_msg = 'negado', 'corretor não abre o funil da diretoria');

  perform pg_temp.como(cor);
  set local role authenticated;
  begin
    perform public.funil_de_vendas(mes, null);
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'negado';
  end;
  reset role;
  perform pg_temp.ok(v_msg = 'negado', 'corretor sem diretoria não abre funil nenhum');

  perform pg_temp.como(dir);
  set local role authenticated;
  r := public.funil_de_vendas(mes, null);
  reset role;
  perform pg_temp.ok((r ->> 'diretor')::uuid = dir and (r -> 'recorte' ->> 'docs')::int = 3,
    'diretora sem escolher abre a própria diretoria, não a imobiliária');

  perform pg_temp.como(adm);
  set local role authenticated;
  r := public.funil_de_vendas(mes, null);
  reset role;
  perform pg_temp.ok(r -> 'recorte' = 'null'::jsonb and (r ->> 'pode_ver_imob')::boolean, 'admin vê a imobiliária');
  perform pg_temp.ok(jsonb_path_exists(r -> 'parados', '$[*] ? (@.deal_id == $id)', jsonb_build_object('id', d_fora)),
    'admin vê todos os parados');
  perform pg_temp.ok(jsonb_path_exists(r -> 'diretorias', '$[*] ? (@.id == $id)', jsonb_build_object('id', dir)),
    'admin escolhe entre as diretorias');
end;
$$;

-- 4. Sem sessão não há funil; anônimo nem chama.
do $$
declare v_msg text;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.funil_de_vendas(current_date, null);
    v_msg := 'passou';
  exception when insufficient_privilege then v_msg := 'negado';
  end;
  perform pg_temp.ok(v_msg = 'negado', 'sem sessão a função recusa');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.funil_de_vendas(date, uuid)', 'execute'),
    'anon não executa o funil');
end;
$$;

rollback;
