-- =============================================================================
-- 0285 — nomes no histórico do negócio e documentos aprovados x complementares.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  cor    uuid := '00000000-0000-0000-0000-000002840001';
  ana    uuid := '00000000-0000-0000-0000-000002840002';
  v_deal uuid;
  v_tipo uuid := (select id from public.document_types where active order by sort_order limit 1);
  v_aprovado uuid;
  v_compl    uuid;
  v_pend     uuid;
  v_n    int;
  v_nome text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (cor, 'cor@c284.test', '{"full_name":"Corretor 284"}'),
    (ana, 'ana@c284.test', '{"full_name":"Analista 284"}');
  insert into public.user_roles (profile_id, role) values (cor, 'broker'), (ana, 'cca') on conflict do nothing;
  insert into public.deals (stage_id, created_by, status_detail)
    values ((select id from public.pipeline_stages where is_initial limit 1), cor, 'INCOMPLETO')
    returning id into v_deal;
  insert into public.deal_participants (deal_id, profile_id, role, ordinal)
    values (v_deal, cor, 'broker', 1) on conflict do nothing;
  insert into public.deal_history (deal_id, actor_id, kind, to_value) values (v_deal, cor, 'comment', 'teste 284');

  -- 1. O CCA lê o nome de quem fez, mesmo fora da visibilidade de `profiles`.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select n.full_name into v_nome from public.deal_history_names(v_deal) n where n.id = cor;
  execute 'reset role';
  if v_nome is distinct from 'Corretor 284' then
    raise exception 'FALHOU: histórico deveria mostrar "Corretor 284" ao CCA, veio %', v_nome;
  end if;
  raise notice '  ok  CCA vê o nome de quem fez no histórico';

  -- 2. Aprovação trava o que estava no dossiê.
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/284-aprovado.pdf', 'a.pdf', '284-aprovado.pdf', cor)
    returning id into v_aprovado;
  update public.deals set status_detail = 'APROVADO TOTAL', document_review_status = 'approved' where id = v_deal;
  insert into public.cca_cases (deal_id, status, submitted_at, decided_at) values (v_deal, 'approved', now(), now());
  if (select locked_at from public.deal_documents where id = v_aprovado) is null then
    raise exception 'FALHOU: documento aprovado deveria travar';
  end if;
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/284-compl.pdf', 'c.pdf', '284-compl.pdf', cor)
    returning id into v_compl;

  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.deal_documents where id = v_aprovado;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FALHOU: corretor não exclui o documento aprovado'; end if;
  delete from public.deal_documents where id = v_compl;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FALHOU: corretor exclui o complementar depois da aprovação'; end if;
  execute 'reset role';
  raise notice '  ok  aprovado travado, complementar excluível';

  -- 3. VIROU NEGÓCIO COM PENDÊNCIAS: anexa, avisa o CCA e tira o que anexou.
  update public.deals set status_detail = 'VIROU NEGÓCIO COM PENDÊNCIAS' where id = v_deal;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/284-pend.pdf', 'p.pdf', '284-pend.pdf', cor)
    returning id into v_pend;
  execute 'reset role';
  if not exists (select 1 from public.notifications
                  where profile_id = ana and kind = 'pending_document_attached') then
    raise exception 'FALHOU: CCA deveria ser avisado do anexo na pendência';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.deal_documents where id = v_pend;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FALHOU: corretor tira o anexo errado da pendência'; end if;
  raise notice '  ok  pendência de VIROU NEGÓCIO anexa, avisa e corrige';

  -- 4. VIROU NEGÓCIO trava tudo.
  insert into public.deal_documents (deal_id, document_type_id, storage_path, original_name, stored_name, uploaded_by)
    values (v_deal, v_tipo, v_deal || '/284-pend2.pdf', 'p2.pdf', '284-pend2.pdf', cor)
    returning id into v_pend;
  update public.deals set status_detail = 'VIROU NEGÓCIO' where id = v_deal;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.deal_documents where id = v_pend;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FALHOU: VIROU NEGÓCIO deveria travar os documentos'; end if;
  raise notice '  ok  VIROU NEGÓCIO trava';

  -- 5. Voltar ao INCOMPLETO destrava para todos.
  update public.deals set status_detail = 'INCOMPLETO' where id = v_deal;
  perform set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.deal_documents where id = v_aprovado;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FALHOU: no INCOMPLETO o corretor exclui qualquer anexo'; end if;
  raise notice '  ok  INCOMPLETO destrava';
end;
$$;

rollback;
