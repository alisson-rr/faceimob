-- 0356 — CCA leva o aprovado para "Análise p/ virar negócio"; corretor não.
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
  cca uuid := '00000000-0000-0000-0000-000003560001';
  cor uuid := '00000000-0000-0000-0000-000003560002';
  v_destino text := (select value from public.deal_statuses
                      where public.status2_chave(value) = 'ANALISE P/ VIRAR NEGOCIO' order by active desc limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cca, 'cca@c356.test', '{"full_name":"CCA 356"}'),
    (cor, 'cor@c356.test', '{"full_name":"Corretor 356"}');
  insert into public.user_roles (profile_id, role) values (cca, 'cca'), (cor, 'broker') on conflict do nothing;
  perform pg_temp.ok(v_destino is not null, 'o catálogo tem Análise p/ virar negócio');

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_status_move_block('09. APROV. TOTAL', v_destino) is null, 'CCA: aprovado total → análise p/ virar');
  perform pg_temp.ok(public.deal_status_move_block('APROV. COND. RESTRIÇÃO', v_destino) is null, 'CCA: condicionado com restrição → análise p/ virar');

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform pg_temp.ok(public.deal_status_move_block('09. APROV. TOTAL', v_destino) is not null, 'corretor segue barrado');
end;
$$;

-- 0358 — a CCA envia de verdade: o negócio cai em "Análise p/ virar negócio"
-- na esteira, sem passar pela conferência do gerente.
do $$
declare
  cca uuid := '00000000-0000-0000-0000-000003580001';
  cor uuid := '00000000-0000-0000-0000-000003580002';
  ger uuid := '00000000-0000-0000-0000-000003580003';
  v_dev uuid;
  v_deal uuid;
  v_ok boolean;
  v_type public.document_types;
  v_stage uuid := (select id from public.pipeline_stages where is_initial limit 1);
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cca, 'cca@c358.test', '{"full_name":"CCA 358"}'),
    (cor, 'cor@c358.test', '{"full_name":"Corretor 358"}'),
    (ger, 'ger@c358.test', '{"full_name":"Gerente 358"}');
  insert into public.user_roles (profile_id, role) values (cca, 'cca'), (cor, 'broker'), (ger, 'manager') on conflict do nothing;
  insert into public.developers (name, slug, flow) values ('Construtora 358', 'construtora-358', 'internal') returning id into v_dev;
  update public.document_types set required_for_conversion = false;

  insert into public.deals (stage_id, created_by, document_review_status, developer_id)
    values (v_stage, cor, 'approved', v_dev) returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal, ger, 'manager', 1) on conflict do nothing;
  select * into v_type from public.document_types order by sort_order limit 1;
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_type.id, 'c358/' || v_deal || '/doc.pdf', 'doc.pdf', 'doc-cliente.pdf', cor);
  -- Aprovado dias antes, como na vida real: o reenvio só conta como entrada se
  -- `submitted_at` mudar, e `now()` é o mesmo instante dentro da transação.
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at)
    values (v_deal, 'approved', now() - interval '3 days', now() - interval '2 days');
  update public.deals set status_detail = '09. APROV. TOTAL' where id = v_deal;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  begin
    perform public.cca_enviar_para_virar_negocio(v_deal, 'Cliente aprovado, seguir');
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.ok(not v_ok, 'corretor não usa o envio direto da CCA');

  perform set_config('request.jwt.claims', json_build_object('sub', cca, 'role', 'authenticated')::text, true);
  perform public.cca_enviar_para_virar_negocio(v_deal, 'Cliente aprovado, seguir para virar');
  perform pg_temp.ok((select status_detail from public.deals where id = v_deal) = '15. ANÁLISE P/ VIRAR NEGÓCIO',
    'CCA: o negócio cai em Análise p/ virar negócio (está em '
    || coalesce((select status_detail from public.deals where id = v_deal), 'nulo') || ')');
  perform pg_temp.ok((select status from public.cca_cases where deal_id = v_deal) = 'under_review',
    'CCA: o caso volta para análise na esteira');
  perform pg_temp.ok((select document_review_status from public.deals where id = v_deal) = 'approved',
    'CCA: não fica esperando o gerente');
end;
$$;

rollback;
