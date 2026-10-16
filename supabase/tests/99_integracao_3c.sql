\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond,false) then raise exception 'FALHOU: %',label; end if;
  raise notice '  ok  %',label;
end;
$$;

do $$
declare
  v_admin uuid := '00000000-0000-0000-0000-000002830001';
  v_broker uuid := '00000000-0000-0000-0000-000002830002';
  v_outsider uuid := '00000000-0000-0000-0000-000002830003';
  v_configurer uuid := '00000000-0000-0000-0000-000002830004';
  v_group uuid;
  v_other_group uuid;
  v_actor uuid;
  v_config jsonb;
  v_options jsonb;
  v_before jsonb;
  v_result jsonb;
  v_again jsonb;
  v_body jsonb;
  v_lead uuid;
  v_other uuid;
  v_duplicate uuid;
  v_event uuid;
  v_count int;
begin
  -- O rollback restaura eventual configuração preexistente do banco de teste.
  delete from private.integration_credentials where provider = '3c' and label = 'api_token';
  insert into auth.users (id,email,raw_user_meta_data) values
    (v_admin,'admin@teste-283.invalid','{"full_name":"Admin 283"}'),
    (v_broker,'broker@teste-283.invalid','{"full_name":"Corretor 283"}'),
    (v_outsider,'outsider@teste-283.invalid','{"full_name":"Fora do escopo 283"}'),
    (v_configurer,'integracoes@teste-283.invalid','{"full_name":"Configuração 283"}');
  insert into public.user_roles (profile_id,role) values (v_admin,'admin');
  insert into public.distribution_groups (name,slug) values ('3C teste','3c-teste-283') returning id into v_group;
  insert into public.distribution_groups (name,slug) values ('Outro teste','outro-teste-283') returning id into v_other_group;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v_options := public.integracao_3c_options();
  perform pg_temp.ok(v_options->'groups' @> jsonb_build_array(jsonb_build_object('id',v_group,'name','3C teste'))
    and v_options->'brokers' @> jsonb_build_array(jsonb_build_object('id',v_broker,'name','Corretor 283')), 'admin recebe catálogo de grupos e agendas');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements((v_options->'groups') || (v_options->'brokers')) o
    where o - 'id' - 'name' <> '{}'), 'catálogo contém somente ID e nome');
  delete from public.user_roles where profile_id = v_configurer;
  insert into public.user_roles (profile_id,role) values (v_configurer,'marketing');
  insert into public.permissions (code,label,category) values
    ('settings.integrations','Integrações','settings'),('leads.reassign','Repasse','leads') on conflict do nothing;
  insert into public.role_permissions (role,permission,allowed) values
    ('marketing','settings.integrations',true),('marketing','leads.reassign',false)
    on conflict (role,permission) do update set allowed = excluded.allowed;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_configurer,'role','authenticated')::text,true);
  perform pg_temp.ok(public.has_permission('settings.integrations') and not public.has_permission('leads.reassign')
    and not public.has_role('broker'), 'configurador autorizado não depende de papel de corretor nem repasse');
  set local role authenticated;
  v_options := public.integracao_3c_options();
  reset role;
  perform pg_temp.ok(v_options->'brokers' @> jsonb_build_array(jsonb_build_object('id',v_broker,'name','Corretor 283')),
    'não corretor com permissão de integração recebe agendas');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  update public.profiles set status = 'suspended' where id = v_outsider;
  update public.distribution_groups set active = false where id = v_other_group;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_configurer,'role','authenticated')::text,true);
  v_options := public.integracao_3c_options();
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(v_options->'brokers') o where o->>'id' = v_outsider::text)
    and not exists (select 1 from jsonb_array_elements(v_options->'groups') o where o->>'id' = v_other_group::text),
    'catálogo exclui corretores suspensos e grupos inativos');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  update public.profiles set status = 'active' where id = v_outsider;
  update public.distribution_groups set active = true where id = v_other_group;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);

  v_config := public.configure_integracao_3c('{}');
  v_actor := (v_config->>'integration_user_id')::uuid;
  perform pg_temp.ok(v_config->>'enabled' = 'false'
    and v_config - array['enabled','integration_user_id','allowed_group_ids','default_group_id','agenda_ids','outcomes'] = '{}',
    'nasce desabilitada somente com configuração de acesso');
  perform pg_temp.ok(not exists (select 1 from public.user_roles where profile_id = v_actor), 'identidade técnica não recebe papel');
  perform pg_temp.ok(not exists (select 1 from public.team_members where profile_id = v_actor), 'identidade técnica não recebe equipe');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  begin
    perform public.integracao_3c_options();
    raise exception 'FALHOU: catálogo aceitou usuário sem permissão';
  exception when insufficient_privilege then null; end;
  perform pg_temp.ok(not has_function_privilege('anon','public.integracao_3c_options()','EXECUTE'), 'catálogo não fica disponível para anônimo');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  perform pg_temp.ok((select email = id::text || '@integracao.faceimob.invalid' and coalesce(to_jsonb(u)->>'encrypted_password','') = ''
    from auth.users u where id = v_actor), 'identidade técnica sem senha e sem identidade pessoal');
  begin
    perform public.configure_integracao_3c(jsonb_build_object('integration_user_id',v_broker));
    raise exception 'FALHOU: permitiu trocar identidade técnica';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.configure_integracao_3c('{"enabled":true}');
    raise exception 'FALHOU: habilitou sem escopo de acesso';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.configure_integracao_3c(jsonb_build_object('agenda_ids',jsonb_build_array(v_actor)));
    raise exception 'FALHOU: aceitou usuário técnico como corretor';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.configure_integracao_3c('{"duration_min":30}');
    raise exception 'FALHOU: aceitou campo operacional desconhecido';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_integration_secret('3c','api_token','curto');
    raise exception 'FALHOU: aceitou chave curta';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_integration_secret('3c','api_token','0123456789abcdef 0123456789abcdef');
    raise exception 'FALHOU: aceitou chave com espaços';
  exception when invalid_parameter_value then null; end;
  perform public.set_integration_secret('3c','api_token','token-283-antigo-0123456789abcdef0123456789abcdef');
  v_config := public.configure_integracao_3c(jsonb_build_object(
    'enabled',true,'allowed_group_ids',jsonb_build_array(v_group),'default_group_id',v_group,
    'agenda_ids',jsonb_build_array(v_broker)));
  perform pg_temp.ok(v_config->>'enabled' = 'true'
    and v_config - array['enabled','integration_user_id','allowed_group_ids','default_group_id','agenda_ids','outcomes'] = '{}',
    'habilita sem duração, antecedência, expediente ou horizonte locais');
  perform pg_temp.ok(v_config->>'integration_user_id' = v_actor::text, 'configuração preserva ator técnico');
  v_before := v_config;
  perform public.set_integration_secret('3c','api_token','token-283-novo-0123456789abcdef0123456789abcdef','{"enabled":false,"integration_user_id":"00000000-0000-0000-0000-000000000000"}');
  perform pg_temp.ok((select config = v_before from private.integration_credentials where provider = '3c' and label = 'api_token'), 'rotação ignora metadata e preserva configuração');
  perform pg_temp.ok(not has_function_privilege('anon','public.integracao_3c_request(text,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.integracao_3c_request(text,text,jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.integracao_3c_request(text,text,jsonb)','EXECUTE'), 'RPC exclusiva da service role');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','etapas');
  perform pg_temp.ok(v_result->>'status' = '403', 'checagem auth.role além do grant');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform pg_temp.ok(public.integracao_3c_request('token-283-antigo-0123456789abcdef0123456789abcdef','etapas')->>'status' = '401', 'token antigo revogado imediatamente');
  perform pg_temp.ok(public.integracao_3c_request('invalido','etapas')->>'status' = '401', 'token inválido não revela informação');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','etapas');
  perform pg_temp.ok(v_result->>'status' = '200'
    and jsonb_array_length(v_result#>'{body,etapas}') = cardinality(enum_range(null::public.lead_funnel_stage)), 'catálogo de etapas usa enum real');

  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead',
    '{"nome":"Lead 3C","telefone":"(11) 92830-0001","email":"lead283@teste.invalid","etapa_id":"novo","observacao":"Original","dados_adicionais":{"renda":2000}}');
  perform pg_temp.ok(v_result->>'status' = '201' and v_result#>>'{body,criado}' = 'true', 'criação responde 201');
  v_lead := (v_result#>>'{body,id}')::uuid;
  perform pg_temp.ok((select phone = '5511928300001' and phone_raw = '(11) 92830-0001' and status = 'queued'
    and assigned_to is null and distribution_group_id = v_group and funnel_stage = 'new' from public.leads where id = v_lead), 'novo lead normalizado aguarda roleta autorizada');
  perform pg_temp.ok((select s.code = 'agente_ia_3c' from public.leads l join public.lead_sources s on s.id = l.source_id where l.id = v_lead), 'origem 3C aditiva');
  update public.leads set assigned_to = v_broker,status = 'assigned',
    campaign_name = 'Campanha preservada', raw_payload = raw_payload || '{"fields":{"meta":"preservada"},"outro_canal":{"id":123}}' where id = v_lead;
  select to_jsonb(l) into v_before from public.leads l where id = v_lead;
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead',
    '{"nome":"Não substituir","telefone":"+55 11 92830-0001","etapa_id":"hot","observacao":"Não substituir","dados_adicionais":{"renda":9999}}');
  perform pg_temp.ok(v_result->>'status' = '200' and v_result#>>'{body,id}' = v_lead::text and v_result#>>'{body,criado}' = 'false', 'telefone normalizado deduplica');
  perform pg_temp.ok((select to_jsonb(l) = v_before from public.leads l where id = v_lead), 'POST existente preserva registro inteiro');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead','{"telefone":"11928300001"}');
  perform pg_temp.ok(v_result->>'status' = '200' and v_result#>>'{body,lead,id}' = v_lead::text
    and not (v_result#>'{body,lead}' ? 'raw_payload'), 'busca devolve somente contrato do lead');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead',jsonb_build_object('id',v_lead))#>>'{body,lead,id}' = v_lead::text, 'busca por ID encontra somente lead autorizado');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead','{"telefone":"11928309999"}');
  perform pg_temp.ok(v_result->>'status' = '200' and v_result#>>'{body,encontrado}' = 'false' and v_result#>'{body,lead}' = 'null', 'busca ausente é 200 false/null');

  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',jsonb_build_object(
    'id',v_lead,'telefone','(11) 92830-0002','etapa_id','warm','dados_adicionais',jsonb_build_object('fgts',true)));
  perform pg_temp.ok(v_result->>'status' = '200', 'PATCH autorizado');
  perform pg_temp.ok(auth.uid() is null and auth.role() = 'service_role', 'PATCH restaura claims do chamador');
  perform pg_temp.ok(exists (select 1 from public.lead_events where lead_id = v_lead and kind = 'stage_changed'
    and to_value = 'warm' and actor_id = v_actor), 'trigger de etapa audita identidade técnica');
  perform pg_temp.ok((select phone = '5511928300002' and phone_raw = '(11) 92830-0002'
    and assigned_to = v_broker and status = 'assigned' and notes = 'Original'
    and raw_payload#>>'{fields,meta}' = 'preservada' and raw_payload#>>'{outro_canal,id}' = '123'
    and raw_payload#>>'{integracoes,tres_c,dados_adicionais,renda}' = '2000'
    and raw_payload#>>'{integracoes,tres_c,dados_adicionais,fgts}' = 'true' from public.leads where id = v_lead), 'PATCH atualiza canônico/raw e merge preserva os demais dados');
  select to_jsonb(l) into v_before from public.leads l where id = v_lead;
  update public.leads set raw_payload = '[]' where id = v_lead;
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',
    jsonb_build_object('id',v_lead,'nome','Não gravar','dados_adicionais','{}'::jsonb));
  perform pg_temp.ok(v_result->>'status' = '400' and auth.uid() is null
    and (select full_name = 'Lead 3C' and raw_payload = '[]' from public.leads where id = v_lead), 'erro de merge não perde dados nem deixa claims técnicos ativos');
  update public.leads set raw_payload = v_before->'raw_payload' where id = v_lead;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',jsonb_build_object('id',v_lead,'assigned_to',v_outsider))->>'status' = '400', 'allowlist rejeita redistribuição arbitrária');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',jsonb_build_object('id',v_lead,'etapa_id','descartado'))->>'status' = '422', 'estado operacional não vira etapa');
  update public.leads set status = 'lost',lost_at = now() where id = v_lead;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',jsonb_build_object('id',v_lead,'etapa_id','hot'))->>'status' = '422', 'PATCH não altera etapa de lead encerrado');

  v_body := jsonb_build_object('id',v_lead,'data','2026-10-16T14:00:00-03:00','duracao_seg',90,
    'desfecho','sem_interesse','resumo','Resumo da conversa','_idempotency_key','call-283');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',v_body);
  perform pg_temp.ok(v_result->>'status' = '201', 'ligação permitida no histórico do lead encerrado');
  v_event := (v_result#>>'{body,ligacao_id}')::uuid;
  v_again := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',v_body);
  perform pg_temp.ok(v_again = v_result, 'replay retorna mesma ligação e envelope');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',v_body || '{"resumo":"Diferente"}')->>'status' = '409', 'reuso de chave com outros dados é conflito');
  perform pg_temp.ok((select count(*) = 1 from public.lead_events where lead_id = v_lead and kind = 'voice_ai_call'), 'replay e conflito não duplicam ligação');
  perform pg_temp.ok((select actor_id = v_actor and detail->>'origem' = '3c' and detail->>'duracao_seg' = '90'
    and detail->>'resumo' = 'Resumo da conversa' and not (detail ? '_idempotency_key') from public.lead_events where id = v_event), 'histórico contém ator técnico e dados explícitos sem chave de idempotência');
  perform public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',v_body - '_idempotency_key');
  perform public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',v_body - '_idempotency_key');
  perform pg_temp.ok((select count(*) = 3 from public.lead_events where lead_id = v_lead and kind = 'voice_ai_call'), 'sem chave, cada chamada registra outra ligação');
  perform pg_temp.ok((select status = 'lost' and notes = 'Original' from public.leads where id = v_lead), 'ligação não reabre lead nem sobrescreve notas');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','registrar_ligacao',(v_body || '{"data":"2026-10-16T14:00:00"}') - '_idempotency_key')->>'status' = '400', 'data de ligação exige fuso explícito');

  insert into public.leads (full_name,phone,distribution_group_id,assigned_to,status)
    values ('Fora do escopo','1192830003',v_other_group,v_outsider,'assigned') returning id into v_other;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead',jsonb_build_object('id',v_other))#>>'{body,encontrado}' = 'false', 'busca não revela lead fora do escopo');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','atualizar_lead',jsonb_build_object('id',v_other,'nome','Inválido'))->>'status' = '404', 'PATCH fora do escopo é 404');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead','{"nome":"Não duplicar","telefone":"1192830003"}')->>'status' = '404', 'POST não duplica telefone existente fora do escopo');
  insert into public.leads (full_name,phone,email,distribution_group_id)
    values ('Duplicado preservado','11928300002','lead283@teste.invalid',v_group) returning id into v_duplicate;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead','{"telefone":"11928300002"}')->>'status' = '422', 'telefone ambíguo não escolhe registro arbitrário');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead','{"nome":"Duplicado","telefone":"11928300002"}')->>'status' = '422', 'POST ambíguo preserva duplicados existentes');
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead','{"email":"lead283@teste.invalid"}')->>'status' = '422', 'email ambíguo também é explícito');
  update public.leads set distribution_group_id = v_other_group,assigned_to = v_outsider where id = v_duplicate;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead','{"nome":"Duplicado","telefone":"11928300002"}')->>'status' = '422', 'POST ambíguo não escolhe entre lead autorizado e fora do escopo');
  delete from public.leads where id = v_duplicate;
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead',jsonb_build_object('id',v_lead))#>>'{body,lead,id}' = v_lead::text, 'lead autorizado continua visível antes do repasse');
  update public.leads set distribution_group_id = v_other_group,assigned_to = v_outsider where id = v_lead;
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','buscar_lead',jsonb_build_object('id',v_lead));
  perform pg_temp.ok(v_result#>>'{body,encontrado}' = 'false' and v_result#>'{body,lead}' = 'null', 'GET não reaproveita autorização depois de repasse fora do escopo');
  v_result := public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','criar_lead','{"nome":"Não revelar","telefone":"11928300002"}');
  perform pg_temp.ok(v_result->>'status' = '404' and not (v_result->'body' ? 'id'), 'POST existente não revela ID depois de repasse fora do escopo');
  update private.integration_credentials set active = false where provider = '3c' and label = 'api_token';
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','etapas')->>'status' = '401', 'revogação é fresca a cada pedido');
  update private.integration_credentials set active = true,config = config || '{"enabled":false}' where provider = '3c' and label = 'api_token';
  perform pg_temp.ok(public.integracao_3c_request('token-283-novo-0123456789abcdef0123456789abcdef','etapas')->>'status' = '503', 'integração desabilitada não executa operações');
end;
$$;

rollback;
