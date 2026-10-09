-- =============================================================================
-- 0255 — aviso de negócio: cliente no lugar do código, corretor e Status 2 no
-- corpo, link que abre o card (inclusive o de conferência, que tem parâmetro).
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor uuid := '00000000-0000-0000-0000-000002550001';
  ger uuid := '00000000-0000-0000-0000-000002550002';
  cca uuid := '00000000-0000-0000-0000-000002550003';
  dir uuid := '00000000-0000-0000-0000-000002550004';
  v_deal uuid;
  v_dev uuid;
  v_aviso public.notifications;
begin
  insert into public.developers (name, slug) values ('Construtora 255', 'construtora-255') returning id into v_dev;
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c255.test', '{"full_name":"Daiane Corretora"}'),
    (ger, 'ger@c255.test', '{"full_name":"Gerente 255"}'),
    (cca, 'cca@c255.test', '{"full_name":"Analista 255"}'),
    (dir, 'dir@c255.test', '{"full_name":"Diretor 255"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ger, 'manager'), (cca, 'cca'), (dir, 'director')
    on conflict do nothing;
  insert into public.deals (stage_id, created_by, code, developer_id)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor,
            'BUB-1790717604419x628', v_dev)
    returning id into v_deal;
  insert into public.deal_clients (deal_id, ordinal, full_name) values (v_deal, 1, 'Anderson Torres');
  insert into public.deal_participants (deal_id, profile_id, role, ordinal) values
    (v_deal, cor, 'broker', 1), (v_deal, ger, 'manager', 1),
    (v_deal, dir, 'director', 1) on conflict do nothing;
  update public.deals set status_detail = '13. ESTEIRA AGIL' where id = v_deal;
  update public.document_types set required_for_conversion = false;

  -- Conferência pedida: título com o código do Bubble, link com parâmetro.
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  perform public.submit_deal_for_manager_review(v_deal, 'Segue para análise', 'agil');
  perform set_config('request.jwt.claims', '', true);

  select * into v_aviso from public.notifications
   where profile_id = ger and kind = 'document_review_requested' and title like 'Documentos para conferir%';
  if v_aviso.title <> 'Documentos para conferir: Anderson Torres' then
    raise exception 'FALHOU: código BUB devia virar o nome do cliente (veio "%")', v_aviso.title;
  end if;
  raise notice '  ok  código BUB-… vira o nome do cliente';

  if v_aviso.body not like 'Corretor Daiane Corretora · Status ESTEIRA AGIL%' then
    raise exception 'FALHOU: corpo devia abrir com corretor e Status 2 (veio "%")', v_aviso.body;
  end if;
  raise notice '  ok  corpo abre com corretor e Status 2';

  -- Link com parâmetro (o de conferência) também ganha o negócio: a transação
  -- já tocou o negócio acima.
  insert into public.notifications (profile_id, kind, title, body, link)
    values (dir, 'document_review_requested', 'Conferência', 'teste', '/pipeline?conferencia=pendente')
    returning * into v_aviso;
  if v_aviso.link <> '/pipeline?conferencia=pendente&negocio=' || v_deal then
    raise exception 'FALHOU: link com parâmetro devia levar o negócio (veio "%")', v_aviso.link;
  end if;
  select * into v_aviso from public.notifications
   where profile_id = ger and kind = 'document_review_requested' and title like 'Documentos para conferir%';
  if v_aviso.link <> '/pipeline?negocio=' || v_deal then
    raise exception 'FALHOU: link do gerente devia abrir o card (veio "%")', v_aviso.link;
  end if;
  raise notice '  ok  links de /pipeline, com ou sem parâmetro, abrem o card';

  -- Dossiê novo para a CCA.
  insert into public.cca_cases (deal_id, status, submitted_at) values (v_deal, 'under_review', now());
  select * into v_aviso from public.notifications where profile_id = cca and kind = 'cca_pending';
  if v_aviso.title <> 'Dossiê novo na esteira: Anderson Torres'
     or v_aviso.link <> '/cca?negocio=' || v_deal
     or v_aviso.body not like 'Corretor Daiane Corretora%' then
    raise exception 'FALHOU: aviso da CCA devia ter cliente, corretor e link do card (% | % | %)',
      v_aviso.title, v_aviso.body, v_aviso.link;
  end if;
  raise notice '  ok  dossiê novo chega à CCA com cliente, corretor e link do card';

  -- Aviso fora de negócio continua intacto.
  insert into public.notifications (profile_id, kind, title, body, link)
    values (cor, 'lead_new_admin', 'Novo lead: Fulano', 'meta · está na fila da roleta', '/leads?lead=' || gen_random_uuid());
  if exists (select 1 from public.notifications where profile_id = cor and kind = 'lead_new_admin'
              and body <> 'meta · está na fila da roleta') then
    raise exception 'FALHOU: aviso de lead não devia ganhar contexto de negócio';
  end if;
  raise notice '  ok  aviso de lead não muda';
end;
$$;

rollback;
