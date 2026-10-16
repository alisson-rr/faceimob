-- 0283 · API da 3C: credencial fresca, escopo de leads e histórico de ligações.

insert into public.lead_sources (code, label, channel)
values ('agente_ia_3c', 'Agente de voz 3C', 'other')
on conflict (code) do nothing;

create table private.integracao_3c_idempotency (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operacao text not null,
  chave text not null check (length(chave) between 1 and 128),
  payload_hash bytea not null,
  resposta jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operacao, chave)
);
revoke all on private.integracao_3c_idempotency from public, anon, authenticated, service_role;

create function private.integracao_3c_config_error(p_config jsonb, p_complete boolean)
returns text language plpgsql stable security definer
set search_path = public, private, pg_temp
as $$
declare
  v_groups uuid[];
  v_agendas uuid[];
  v_default uuid;
begin
  if jsonb_typeof(p_config) is distinct from 'object' then return 'Configuração inválida.'; end if;
  if exists (select 1 from jsonb_object_keys(p_config) k where k not in (
    'enabled','integration_user_id','allowed_group_ids','default_group_id','agenda_ids',
    'outcomes')) then return 'Campo de configuração desconhecido.'; end if;
  if jsonb_typeof(p_config->'enabled') is distinct from 'boolean' then return 'Configuração inválida.'; end if;
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = (p_config->>'integration_user_id')::uuid and p.status = 'active'
      and u.raw_user_meta_data->>'integration' = '3c'
      and p.email = p.id::text || '@integracao.faceimob.invalid'
      and not exists (select 1 from public.user_roles r where r.profile_id = p.id)
  ) then return 'Identidade técnica inválida.'; end if;
  if jsonb_typeof(p_config->'allowed_group_ids') is distinct from 'array'
     or jsonb_typeof(p_config->'agenda_ids') is distinct from 'array'
     or jsonb_typeof(p_config->'outcomes') is distinct from 'array' then return 'Listas de configuração inválidas.'; end if;
  select coalesce(array_agg(value::uuid), '{}') into v_groups from jsonb_array_elements_text(p_config->'allowed_group_ids');
  select coalesce(array_agg(value::uuid), '{}') into v_agendas from jsonb_array_elements_text(p_config->'agenda_ids');
  v_default := (p_config->>'default_group_id')::uuid;
  if exists (select 1 from unnest(v_groups) g where g is null or not exists (
      select 1 from public.distribution_groups d where d.id = g and d.active))
     or exists (select 1 from unnest(v_agendas) a where a is null or not exists (
      select 1 from public.profiles p join public.user_roles r on r.profile_id = p.id and r.role = 'broker'
      where p.id = a and p.status = 'active')) then return 'Grupo ou agenda inexistente/inativo.'; end if;
  if v_default is not null and not (v_default = any(v_groups)) then return 'O grupo padrão precisa estar autorizado.'; end if;
  if jsonb_array_length(p_config->'outcomes') not between 1 and 20
     or exists (select 1 from jsonb_array_elements(p_config->'outcomes') o
       where jsonb_typeof(o) <> 'string' or length(btrim(o #>> '{}')) not between 1 and 64) then return 'Desfechos inválidos.'; end if;
  if p_complete and (cardinality(v_groups) = 0 or cardinality(v_agendas) = 0 or v_default is null) then
    return 'Autorize grupos, grupo de entrada e agendas antes de habilitar.';
  end if;
  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return 'Configuração inválida.';
end;
$$;

create function public.configure_integracao_3c(p_config jsonb)
returns jsonb language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_existing jsonb;
  v_config jsonb;
  v_actor uuid;
  v_error text;
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'Configuração inválida.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('integracao_3c:config', 0));
  select config into v_existing from private.integration_credentials where provider = '3c' and label = 'api_token' for update;
  v_actor := (v_existing->>'integration_user_id')::uuid;
  if p_config ? 'integration_user_id' and (p_config->>'integration_user_id') is distinct from v_actor::text then
    raise exception 'A identidade técnica é gerada e preservada pelo servidor.' using errcode = '22023';
  end if;
  if v_actor is null then
    v_actor := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_actor, v_actor::text || '@integracao.faceimob.invalid', '{"full_name":"Integração 3C","integration":"3c"}');
    delete from public.user_roles where profile_id = v_actor and role = 'broker';
  end if;
  v_config := jsonb_build_object(
    'enabled',false,'integration_user_id',v_actor,'allowed_group_ids','[]'::jsonb,
    'default_group_id',null,'agenda_ids','[]'::jsonb,
    'outcomes',jsonb_build_array('agendado','nao_qualificado','sem_interesse')
  ) || coalesce(v_existing,'{}') || p_config || jsonb_build_object('integration_user_id',v_actor);
  v_error := private.integracao_3c_config_error(v_config, (v_config->>'enabled')::boolean);
  if v_error is not null then raise exception '%',v_error using errcode = '22023'; end if;
  if (v_config->>'enabled')::boolean and not exists (
    select 1 from private.integration_credentials where provider = '3c' and label = 'api_token' and secret <> ''
  ) then raise exception 'Cadastre a chave da 3C antes de habilitar.' using errcode = '22023'; end if;
  insert into private.integration_credentials (provider,label,secret,config,updated_by)
  values ('3c','api_token','',v_config,auth.uid())
  on conflict (provider,label) do update set config = excluded.config, updated_by = auth.uid(), updated_at = now();
  return v_config;
end;
$$;

-- O catálogo da integração segue sua própria permissão, sem depender do repasse de leads.
create function public.integracao_3c_options()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id),'[]')
      from public.distribution_groups g where g.active),
    'brokers',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id),'[]')
      from public.profiles p where p.status = 'active'
        and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker'))
  );
end;
$$;

-- Rotacionar a chave da 3C não pode apagar nem substituir sua autorização.
create or replace function public.set_integration_secret(p_provider text,p_label text,p_secret text,p_config jsonb default '{}')
returns uuid language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_id uuid;
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;
  if p_provider = '3c' and p_label = 'api_token' and
    (p_secret is null or length(p_secret) not between 32 and 512 or p_secret ~ '[[:space:]]') then
    raise exception 'A chave da 3C precisa ter de 32 a 512 caracteres, sem espaços.' using errcode = '22023';
  end if;
  insert into private.integration_credentials (provider,label,secret,config,updated_by)
  values (p_provider,p_label,p_secret,case when p_provider = '3c' and p_label = 'api_token' then '{}'::jsonb else coalesce(p_config,'{}') end,auth.uid())
  on conflict (provider,label) do update set secret = excluded.secret,
    config = case when p_provider = '3c' and p_label = 'api_token' then integration_credentials.config else excluded.config end,
    active = true, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create function private.integracao_3c_token_valido(p_token text,p_secret text)
returns boolean language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare
  v_input bytea := extensions.digest(coalesce(p_token,''),'sha256');
  v_expected bytea := extensions.digest(coalesce(p_secret,''),'sha256');
  v_diff int := 0;
  i int;
begin
  for i in 0..31 loop
    v_diff := v_diff | (get_byte(v_input,i) # get_byte(v_expected,i));
  end loop;
  return v_diff = 0 and coalesce(length(p_token),0) between 32 and 512 and coalesce(length(p_secret),0) >= 32;
end;
$$;

create function private.integracao_3c_lead_json(p_lead public.leads)
returns jsonb language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id',p_lead.id,'nome',p_lead.full_name,'telefone',p_lead.phone,
    'email',p_lead.email,'etapa_id',p_lead.funnel_stage,'corretor_id',p_lead.assigned_to,'criado_em',p_lead.created_at);
$$;

create function private.integracao_3c_payload(p_original jsonb,p_extras jsonb)
returns jsonb language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_root jsonb := coalesce(p_original,'{}');
  v_integracoes jsonb;
  v_3c jsonb;
begin
  if jsonb_typeof(v_root) <> 'object' then raise invalid_parameter_value; end if;
  v_integracoes := coalesce(v_root->'integracoes','{}');
  v_3c := coalesce(v_integracoes->'tres_c','{}');
  if jsonb_typeof(v_integracoes) <> 'object' or jsonb_typeof(v_3c) <> 'object'
    or jsonb_typeof(coalesce(v_3c->'dados_adicionais','{}')) <> 'object' then raise invalid_parameter_value; end if;
  return v_root || jsonb_build_object('integracoes',v_integracoes || jsonb_build_object('tres_c',v_3c ||
    jsonb_build_object('dados_adicionais',coalesce(v_3c->'dados_adicionais','{}') || p_extras)));
end;
$$;

create function public.integracao_3c_request(p_token text,p_operacao text,p_dados jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_credential private.integration_credentials;
  v_config jsonb;
  v_actor uuid;
  v_groups uuid[];
  v_agendas uuid[];
  v_lead public.leads;
  v_phone text;
  v_id uuid;
  v_stage text;
  v_count int;
  v_accessible boolean;
  v_source uuid;
  v_result jsonb;
  v_key text;
  v_hash bytea;
  v_saved private.integracao_3c_idempotency;
  v_event uuid;
  v_when timestamptz;
  v_previous_claims text := coalesce(current_setting('request.jwt.claims',true),'');
  v_actor_claims text;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('status',403,'body',jsonb_build_object('erro','ACESSO_NEGADO','mensagem','Acesso negado.'));
  end if;
  select * into v_credential from private.integration_credentials where provider = '3c' and label = 'api_token';
  if not found or not v_credential.active or not private.integracao_3c_token_valido(p_token,v_credential.secret) then
    return jsonb_build_object('status',401,'body',jsonb_build_object('erro','NAO_AUTORIZADO','mensagem','Chave ausente ou inválida.'));
  end if;
  v_config := v_credential.config;
  if coalesce(v_config->>'enabled','false') <> 'true' or private.integracao_3c_config_error(v_config,true) is not null then
    return jsonb_build_object('status',503,'body',jsonb_build_object('erro','INTEGRACAO_INDISPONIVEL','mensagem','Integração não habilitada ou incompleta.'));
  end if;
  if jsonb_typeof(p_dados) is distinct from 'object' or octet_length(p_dados::text) > 65536 then
    return jsonb_build_object('status',400,'body',jsonb_build_object('erro','DADOS_INVALIDOS','mensagem','Corpo JSON inválido.'));
  end if;
  v_actor := (v_config->>'integration_user_id')::uuid;
  v_actor_claims := (coalesce(nullif(v_previous_claims,''),'{}')::jsonb || jsonb_build_object('sub',v_actor,'role','service_role'))::text;
  select array_agg(value::uuid) into v_groups from jsonb_array_elements_text(v_config->'allowed_group_ids');
  select array_agg(value::uuid) into v_agendas from jsonb_array_elements_text(v_config->'agenda_ids');
  if p_operacao in ('criar_evento','registrar_ligacao') and p_dados ? '_idempotency_key' then
    v_key := p_dados->>'_idempotency_key';
    if jsonb_typeof(p_dados->'_idempotency_key') <> 'string' or length(btrim(v_key)) not between 1 and 128 then
      return jsonb_build_object('status',400,'body',jsonb_build_object('erro','DADOS_INVALIDOS','mensagem','Idempotency-Key inválida.'));
    end if;
    v_hash := extensions.digest((p_dados - '_idempotency_key')::text,'sha256');
    perform pg_advisory_xact_lock(hashtextextended('3c:idem:' || v_actor::text || ':' || p_operacao || ':' || v_key,0));
    select * into v_saved from private.integracao_3c_idempotency where actor_id = v_actor and operacao = p_operacao and chave = v_key;
    if found then
      if v_saved.payload_hash <> v_hash then
        return jsonb_build_object('status',409,'body',jsonb_build_object('erro','IDEMPOTENCIA_CONFLITO','mensagem','Chave já utilizada com outros dados.'));
      end if;
      -- Mesmo um replay exige que o lead continue dentro do escopo atual.
      v_id := coalesce(p_dados->>'id',p_dados->>'lead_id')::uuid;
      if not exists (select 1 from public.leads l where l.id = v_id
        and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups))) then
        return jsonb_build_object('status',404,'body',jsonb_build_object('erro','LEAD_NAO_ENCONTRADO','mensagem','Lead não encontrado.'));
      end if;
      return v_saved.resposta;
    end if;
  end if;
  if p_operacao in ('agendas','disponibilidade','criar_evento') then
    perform set_config('request.jwt.claims',v_actor_claims,true);
    v_result := private.integracao_3c_agenda(p_operacao,p_dados,v_config,v_actor);
    perform set_config('request.jwt.claims',v_previous_claims,true);
  elsif p_operacao = 'etapas' then
    select jsonb_build_object('status',200,'body',jsonb_build_object('etapas',jsonb_agg(jsonb_build_object(
      'id',s,'nome',case s when 'new' then 'Novo' when 'first_contact' then 'Primeiro contato'
      when 'no_response' then 'Sem resposta' when 'warm' then 'Morno' when 'hot' then 'Quente'
      when 'gathering_docs' then 'Coleta de documentos' when 'scheduled_visit' then 'Visita agendada'
      when 'qualified' then 'Qualificado' else s end)))) into v_result
    from unnest(enum_range(null::public.lead_funnel_stage)) e cross join lateral (select e::text as s) t;
  elsif p_operacao in ('buscar_lead','criar_lead','atualizar_lead','registrar_ligacao') then
    if p_dados ? 'telefone' then
      if jsonb_typeof(p_dados->'telefone') <> 'string' then raise invalid_parameter_value; end if;
      v_phone := public.normalize_phone(p_dados->>'telefone');
      if v_phone is null or v_phone !~ '^\d{10,15}$' then raise invalid_parameter_value; end if;
    end if;
    if p_operacao = 'buscar_lead' then
      if exists (select 1 from jsonb_object_keys(p_dados) k where k not in ('id','telefone','email'))
        or (p_dados ? 'email' and (jsonb_typeof(p_dados->'email') <> 'string'
          or length(p_dados->>'email') > 254 or p_dados->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then raise invalid_parameter_value; end if;
      if (case when nullif(p_dados->>'id','') is not null then 1 else 0 end
        + case when v_phone is not null then 1 else 0 end
        + case when nullif(p_dados->>'email','') is not null then 1 else 0 end) <> 1 then raise invalid_parameter_value; end if;
      if p_dados ? 'id' then v_id := (p_dados->>'id')::uuid; end if;
      -- Escopo e payload usam o mesmo snapshot, inclusive durante repasses.
      select count(*),jsonb_agg(private.integracao_3c_lead_json(m.lead))->0 into v_count,v_result
      from (
        select l as lead from public.leads l
        where (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups))
          and ((p_dados ? 'id' and l.id = v_id) or (v_phone is not null and l.phone = v_phone)
            or (p_dados ? 'email' and l.email = btrim(p_dados->>'email')))
        limit 2
      ) m;
      if v_count > 1 then return jsonb_build_object('status',422,'body',jsonb_build_object('erro','LEAD_AMBIGUO','mensagem','Mais de um lead corresponde à busca.')); end if;
      if v_count = 0 then return jsonb_build_object('status',200,'body',jsonb_build_object('encontrado',false,'lead',null)); end if;
      return jsonb_build_object('status',200,'body',jsonb_build_object('encontrado',true,'lead',v_result));
    end if;
    if p_operacao in ('criar_lead','atualizar_lead') then
      if exists (select 1 from jsonb_object_keys(p_dados) k where k not in (
        'id','nome','telefone','email','origem','etapa_id','observacao','dados_adicionais'))
        or (p_operacao = 'atualizar_lead' and (p_dados ? 'origem' or p_dados - 'id' = '{}'))
        or (p_operacao = 'criar_lead' and p_dados ? 'id') then raise invalid_parameter_value; end if;
      if (p_dados ? 'nome' and (jsonb_typeof(p_dados->'nome') <> 'string' or length(btrim(p_dados->>'nome')) not between 1 and 200))
        or (p_dados ? 'email' and p_dados->'email' <> 'null'::jsonb and (jsonb_typeof(p_dados->'email') <> 'string'
          or length(p_dados->>'email') > 254 or p_dados->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
        or (p_dados ? 'observacao' and p_dados->'observacao' <> 'null'::jsonb and (jsonb_typeof(p_dados->'observacao') <> 'string' or length(p_dados->>'observacao') > 10000))
        or (p_dados ? 'origem' and (jsonb_typeof(p_dados->'origem') <> 'string' or length(p_dados->>'origem') not between 1 and 100))
        or (p_dados ? 'dados_adicionais' and jsonb_typeof(p_dados->'dados_adicionais') <> 'object') then raise invalid_parameter_value; end if;
      if p_dados ? 'etapa_id' then
        v_stage := case p_dados->>'etapa_id' when 'novo' then 'new' when 'visita_agendada' then 'scheduled_visit' else p_dados->>'etapa_id' end;
        if v_stage is null or not exists (select 1 from unnest(enum_range(null::public.lead_funnel_stage)) s where s::text = v_stage) then
          return jsonb_build_object('status',422,'body',jsonb_build_object('erro','ETAPA_INVALIDA','mensagem','Etapa desconhecida. Consulte /etapas.'));
        end if;
      end if;
    end if;
    if p_operacao = 'criar_lead' then
      if not (p_dados ? 'nome') or v_phone is null then raise invalid_parameter_value; end if;
      perform pg_advisory_xact_lock(hashtextextended('3c:phone:' || v_phone,0));
      select count(*),min(l.id::text)::uuid,
        bool_or(l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups))
        into v_count,v_id,v_accessible from public.leads l where l.phone = v_phone;
      if v_count > 0 then
        if not coalesce(v_accessible,false) then
          return jsonb_build_object('status',404,'body',jsonb_build_object('erro','LEAD_NAO_ENCONTRADO','mensagem','Lead não encontrado.'));
        end if;
        if v_count > 1 then return jsonb_build_object('status',422,'body',jsonb_build_object('erro','LEAD_AMBIGUO','mensagem','Mais de um lead corresponde ao telefone.')); end if;
        return jsonb_build_object('status',200,'body',jsonb_build_object('id',v_id,'criado',false));
      end if;
      select id into v_source from public.lead_sources where code = 'agente_ia_3c';
      perform set_config('request.jwt.claims',v_actor_claims,true);
      insert into public.leads (full_name,phone,phone_raw,email,source_id,distribution_group_id,status,funnel_stage,notes,raw_payload)
      values (btrim(p_dados->>'nome'),v_phone,p_dados->>'telefone',p_dados->>'email',v_source,
        (v_config->>'default_group_id')::uuid,'queued',coalesce(v_stage,'new')::public.lead_funnel_stage,p_dados->>'observacao',
        private.integracao_3c_payload('{}',coalesce(p_dados->'dados_adicionais','{}')))
      returning id into v_id;
      perform set_config('request.jwt.claims',v_previous_claims,true);
      return jsonb_build_object('status',201,'body',jsonb_build_object('id',v_id,'criado',true));
    end if;
    v_id := (p_dados->>'id')::uuid;
    if v_id is null then raise invalid_parameter_value; end if;
    select * into v_lead from public.leads l where l.id = v_id
      and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups)) for update;
    if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('erro','LEAD_NAO_ENCONTRADO','mensagem','Lead não encontrado.')); end if;
    if p_operacao = 'atualizar_lead' then
      if v_lead.status in ('lost','discarded','converted') and v_stage is not null and v_stage <> v_lead.funnel_stage::text then
        return jsonb_build_object('status',422,'body',jsonb_build_object('erro','LEAD_ENCERRADO','mensagem','Não é possível alterar a etapa de um lead encerrado.'));
      end if;
      if v_phone is not null then
        perform pg_advisory_xact_lock(hashtextextended('3c:phone:' || v_phone,0));
        if exists (select 1 from public.leads where phone = v_phone and id <> v_id) then
          return jsonb_build_object('status',409,'body',jsonb_build_object('erro','TELEFONE_JA_CADASTRADO','mensagem','Telefone já cadastrado.'));
        end if;
      end if;
      perform set_config('request.jwt.claims',v_actor_claims,true);
      update public.leads set
        full_name = case when p_dados ? 'nome' then btrim(p_dados->>'nome') else full_name end,
        phone = coalesce(v_phone,phone), phone_raw = case when p_dados ? 'telefone' then p_dados->>'telefone' else phone_raw end,
        email = case when p_dados ? 'email' then p_dados->>'email' else email end,
        funnel_stage = coalesce(v_stage,funnel_stage::text)::public.lead_funnel_stage,
        notes = case when p_dados ? 'observacao' then p_dados->>'observacao' else notes end,
        raw_payload = case when p_dados ? 'dados_adicionais' then private.integracao_3c_payload(raw_payload,p_dados->'dados_adicionais') else raw_payload end
      where id = v_id;
      perform set_config('request.jwt.claims',v_previous_claims,true);
      return jsonb_build_object('status',200,'body',jsonb_build_object('id',v_id,'atualizado',true));
    end if;
    if exists (select 1 from jsonb_object_keys(p_dados) k where k not in ('id','data','duracao_seg','desfecho','resumo','_idempotency_key'))
      or jsonb_typeof(p_dados->'data') is distinct from 'string'
      or p_dados->>'data' !~ '(Z|[+-]\d{2}:\d{2})$'
      or jsonb_typeof(p_dados->'duracao_seg') is distinct from 'number'
      or p_dados->>'duracao_seg' !~ '^\d+$' or (p_dados->>'duracao_seg')::bigint > 86400
      or jsonb_typeof(p_dados->'desfecho') is distinct from 'string'
      or not (v_config->'outcomes' ? (p_dados->>'desfecho'))
      or jsonb_typeof(p_dados->'resumo') is distinct from 'string'
      or length(p_dados->>'resumo') > 10000 then raise invalid_parameter_value; end if;
    v_when := (p_dados->>'data')::timestamptz;
    insert into public.lead_events (lead_id,actor_id,kind,detail)
    values (v_id,v_actor,'voice_ai_call',jsonb_build_object('data',v_when,'duracao_seg',(p_dados->>'duracao_seg')::int,
      'desfecho',p_dados->>'desfecho','resumo',p_dados->>'resumo','origem','3c')) returning id into v_event;
    v_result := jsonb_build_object('status',201,'body',jsonb_build_object('ligacao_id',v_event,'registrado',true));
  else
    return jsonb_build_object('status',404,'body',jsonb_build_object('erro','ROTA_NAO_ENCONTRADA','mensagem','Operação não encontrada.'));
  end if;
  if v_key is not null and (v_result->>'status')::int between 200 and 299 then
    insert into private.integracao_3c_idempotency (actor_id,operacao,chave,payload_hash,resposta)
    values (v_actor,p_operacao,v_key,v_hash,v_result);
  end if;
  return v_result;
exception
  when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format or check_violation then
    perform set_config('request.jwt.claims',v_previous_claims,true);
    return jsonb_build_object('status',400,'body',jsonb_build_object('erro','DADOS_INVALIDOS','mensagem','Dados inválidos. Confira os campos enviados.'));
  when others then
    perform set_config('request.jwt.claims',v_previous_claims,true);
    return jsonb_build_object('status',500,'body',jsonb_build_object('erro','ERRO_INTERNO','mensagem','Não foi possível concluir a operação.'));
end;
$$;

revoke all on function private.integracao_3c_config_error(jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.integracao_3c_token_valido(text,text) from public, anon, authenticated, service_role;
revoke all on function private.integracao_3c_lead_json(public.leads) from public, anon, authenticated, service_role;
revoke all on function private.integracao_3c_payload(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.configure_integracao_3c(jsonb) from public, anon;
grant execute on function public.configure_integracao_3c(jsonb) to authenticated;
revoke all on function public.integracao_3c_options() from public, anon;
grant execute on function public.integracao_3c_options() to authenticated;
revoke all on function public.integracao_3c_request(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.integracao_3c_request(text,text,jsonb) to service_role;
