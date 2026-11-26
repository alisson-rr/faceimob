-- =============================================================================
-- 0363 · 3C: visita da base fria volta para a roleta (pedido de 25/11/2026)
--
-- A 3C liga para o mailing da base fria (exportação 3C, 0360): lead perdido ou
-- descartado. A ligação só era aceita em lead dos corretores e grupos
-- autorizados, e a visita só na agenda do corretor atual de lead ATIVO: a
-- Cristiane aceitou a visita e o CRM respondeu AGENDAMENTO_NAO_PERMITIDO.
--
-- Decisão do Douglas: o lead que aceitou a visita volta para a roleta (grupo de
-- entrada da 3C) e fica com quem receber. A 3C marca dia, hora e loja; o CRM
-- anota no lead e no histórico, deixa a próxima ação no horário da visita e o
-- corretor confirma e administra.
--   · registrar_ligacao/atualizar_lead (por lead_id) aceitam lead perdido ou
--     descartado. A busca por telefone continua só no escopo de antes.
--   · criar_evento em lead perdido/descartado: reabre na roleta e responde 201
--     com pendente_corretor = true (sem evento na agenda).
-- O resto das duas funções é igual à 0283 e à 0284.
-- =============================================================================

create or replace function public.integracao_3c_request(p_token text,p_operacao text,p_dados jsonb default '{}')
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
        and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups)
             or l.status in ('lost','discarded'))) then
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
    -- 0363: o mailing da base fria (lead perdido ou descartado) chega pelo lead_id.
    select * into v_lead from public.leads l where l.id = v_id
      and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups)
           or l.status in ('lost','discarded')) for update;
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

create or replace function private.integracao_3c_agenda(
  p_operacao text, p_dados jsonb, p_config jsonb, p_actor uuid
) returns jsonb language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_agendas uuid[];
  v_groups uuid[];
  v_duration bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_agenda uuid;
  v_lead public.leads%rowtype;
  v_event uuid;
  v_body jsonb;
  v_active_agendas int;
  v_candidates numeric;
  v_period_error constant jsonb := '{"status":422,"body":{"erro":"PERIODO_INVALIDO","mensagem":"Informe início e fim com fuso explícito, fim posterior ao início e duração inteira positiva na consulta."}}';
begin
  if p_operacao not in ('agendas', 'disponibilidade', 'criar_evento') then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('erro', 'ROTA_NAO_ENCONTRADA', 'mensagem', 'Operação de agenda não encontrada.'));
  end if;
  begin
    if p_config->>'enabled' is distinct from 'true'
      or jsonb_typeof(p_config->'agenda_ids') is distinct from 'array'
      or jsonb_typeof(p_config->'allowed_group_ids') is distinct from 'array' then raise invalid_parameter_value; end if;
    select array_agg(x::uuid) into v_agendas from jsonb_array_elements_text(p_config->'agenda_ids') x;
    select array_agg(x::uuid) into v_groups from jsonb_array_elements_text(p_config->'allowed_group_ids') x;
    if coalesce(cardinality(v_agendas), 0) = 0 then raise invalid_parameter_value; end if;
  exception when invalid_parameter_value or invalid_text_representation then
    return jsonb_build_object('status', 503, 'body', jsonb_build_object('erro', 'CONFIGURACAO_PENDENTE', 'mensagem', 'Configure e habilite as agendas autorizadas da integração.'));
  end;
  if p_operacao = 'agendas' then
    select jsonb_build_object('agendas', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.full_name, 'tipo', 'corretor') order by p.full_name, p.id), '[]'::jsonb))
    into v_body from public.profiles p
    where p.id = any(v_agendas) and p.status = 'active'
      and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker');
    return jsonb_build_object('status', 200, 'body', v_body);
  end if;

  begin
    if coalesce(p_dados->>'inicio', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or coalesce(p_dados->>'fim', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return v_period_error;
    end if;
    v_start := (p_dados->>'inicio')::timestamptz;
    v_end := (p_dados->>'fim')::timestamptz;
    v_agenda := nullif(p_dados->>'agenda_id', '')::uuid;
    if v_start >= v_end then return v_period_error; end if;
    if p_operacao = 'disponibilidade' then
      if coalesce(p_dados->>'duracao_min', '') !~ '^[0-9]{1,10}$' then return v_period_error; end if;
      v_duration := (p_dados->>'duracao_min')::bigint;
      if v_duration not between 1 and 2147483647 then return v_period_error; end if;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    return v_period_error;
  end;
  if v_agenda is not null and not exists (
    select 1 from public.profiles p where p.id = v_agenda and p.id = any(v_agendas) and p.status = 'active'
      and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker')
  ) then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('erro', 'AGENDA_NAO_ENCONTRADA', 'mensagem', 'Agenda não encontrada.'));
  end if;

  if p_operacao = 'disponibilidade' then
    select count(*) into v_active_agendas from public.profiles p
    where p.id = any(v_agendas) and p.status = 'active' and (v_agenda is null or p.id = v_agenda)
      and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker');
    -- Teto tecnico por consulta; expediente, horizonte e duracao de negocio sao da 3C.
    v_candidates := floor(extract(epoch from (v_end - v_start)) / (v_duration * 60)) * v_active_agendas;
    if v_candidates > 5000 then
      return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'PERIODO_INVALIDO',
        'mensagem', 'A consulta excede o limite técnico de 5.000 horários candidatos. Reduza o período ou especifique uma agenda.'));
    end if;
    if v_candidates = 0 then return '{"status":200,"body":{"horarios":[]}}'::jsonb; end if;
    with agendas as (
      select p.id from public.profiles p where p.id = any(v_agendas) and p.status = 'active'
        and (v_agenda is null or p.id = v_agenda)
        and exists (select 1 from public.user_roles r where r.profile_id = p.id and r.role = 'broker')
    ), ocupados as materialized (
      select v.broker_id,
        case when v.ends_at is null then
          ((v.scheduled_at at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
          else v.scheduled_at end as inicio,
        coalesce(v.ends_at,
          (((v.scheduled_at at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo')) as fim
      from public.visits v join agendas a on a.id = v.broker_id
      where v.result = 'scheduled'
        and v.scheduled_at < (((v_end at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo')
        and coalesce(v.ends_at,
          (((v.scheduled_at at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo')) > v_start
    ), grade as (
      select a.id as agenda_id, s as inicio, s + make_interval(mins => v_duration::int) as fim
      from agendas a cross join generate_series(v_start,
        v_end - make_interval(mins => v_duration::int), make_interval(mins => v_duration::int)) s
    )
    select jsonb_build_object('horarios', coalesce(jsonb_agg(jsonb_build_object(
      'inicio', g.inicio, 'fim', g.fim, 'agenda_id', g.agenda_id) order by g.inicio, g.agenda_id), '[]'::jsonb))
    into v_body from grade g where not exists (
      select 1 from ocupados v where v.broker_id = g.agenda_id and g.inicio < v.fim and g.fim > v.inicio);
    return jsonb_build_object('status', 200, 'body', v_body);
  end if;

  if v_agenda is null then return v_period_error; end if;
  if p_dados->>'tipo' is distinct from 'visita'
    or jsonb_typeof(p_dados->'titulo') is distinct from 'string'
    or jsonb_typeof(p_dados->'origem') is distinct from 'string'
    or (p_dados ? 'observacao' and p_dados->'observacao' <> 'null'::jsonb
      and jsonb_typeof(p_dados->'observacao') <> 'string')
    or nullif(btrim(p_dados->>'titulo'), '') is null
    or length(p_dados->>'titulo') > 200 or length(coalesce(p_dados->>'observacao', '')) > 10000
    or nullif(btrim(p_dados->>'origem'), '') is null or length(p_dados->>'origem') > 100 then
    return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'DADOS_INVALIDOS', 'mensagem', 'Informe tipo visita, título e origem válidos.'));
  end if;
  begin
    select * into v_lead from public.leads l where l.id = (p_dados->>'lead_id')::uuid
      and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups)
           or l.status in ('lost', 'discarded')) for no key update;
  exception when invalid_text_representation then
    return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'DADOS_INVALIDOS', 'mensagem', 'Informe um lead_id válido.'));
  end;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('erro', 'LEAD_NAO_ENCONTRADO', 'mensagem', 'Lead não encontrado.'));
  end if;
  -- 0363: lead da base fria (perdido ou descartado) que aceitou a visita volta
  -- para a roleta no grupo de entrada da 3C. Dia, hora e loja ficam anotados no
  -- lead e no histórico; o corretor que receber confirma e lança na agenda dele.
  if v_lead.status in ('lost', 'discarded') then
    update public.leads
       set status = 'queued', assigned_to = null, assigned_at = null, attend_deadline = null,
           lost_at = null, lost_reason = null,
           distribution_group_id = coalesce((p_config->>'default_group_id')::uuid, distribution_group_id),
           funnel_stage = 'scheduled_visit', next_action_at = v_start,
           notes = concat_ws(E'
',
             format('Visita combinada pela IA (3C) para %s: %s%s',
               to_char(v_start at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
               btrim(p_dados->>'titulo'),
               coalesce(' · ' || nullif(btrim(p_dados->>'observacao'), ''), '')),
             nullif(notes, ''))
     where id = v_lead.id;
    insert into public.lead_events (lead_id, actor_id, kind, detail)
    values (v_lead.id, p_actor, 'visita_3c_pendente', jsonb_build_object(
      'inicio', v_start, 'fim', v_end, 'titulo', btrim(p_dados->>'titulo'),
      'observacao', nullif(btrim(p_dados->>'observacao'), ''), 'origem', btrim(p_dados->>'origem'),
      'status_anterior', v_lead.status));
    perform public.assign_lead(v_lead.id);
    return jsonb_build_object('status', 201, 'body', jsonb_build_object(
      'evento_id', null, 'criado', true, 'pendente_corretor', true,
      'mensagem', 'Lead reaberto na roleta com a visita anotada; o corretor que receber confirma o horário.'));
  end if;
  if v_lead.assigned_to <> v_agenda or v_lead.status in ('lost', 'discarded', 'converted') then
    return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'AGENDAMENTO_NAO_PERMITIDO', 'mensagem', 'Agende apenas na agenda do corretor atual de um lead ativo.'));
  end if;
  if v_lead.assigned_to is null then
    return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'AGUARDANDO_DISTRIBUICAO', 'mensagem', 'O lead ainda aguarda distribuição para um corretor.'));
  end if;
  begin
    insert into public.visits (lead_id, broker_id, scheduled_at, ends_at, title, event_type, notes, origin, created_by)
    values (v_lead.id, v_agenda, v_start, v_end, btrim(p_dados->>'titulo'), 'visita',
      nullif(btrim(p_dados->>'observacao'), ''), btrim(p_dados->>'origem'), p_actor) returning id into v_event;
  exception when exclusion_violation then
    return jsonb_build_object('status', 409, 'body', jsonb_build_object('erro', 'HORARIO_OCUPADO', 'mensagem', 'O horário já foi ocupado. Consulte a disponibilidade novamente.'));
  end;
  return jsonb_build_object('status', 201, 'body', jsonb_build_object('evento_id', v_event, 'criado', true));
end;
$$;

revoke all on function public.integracao_3c_request(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.integracao_3c_request(text,text,jsonb) to service_role;
revoke all on function private.integracao_3c_agenda(text, jsonb, jsonb, uuid) from public, anon, authenticated;
