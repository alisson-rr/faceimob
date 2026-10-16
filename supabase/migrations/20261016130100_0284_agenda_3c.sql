-- Visitas por corretor: a 3C fornece os intervalos; o FaceImob valida acesso e ocupacao.
alter table public.visits
  add column ends_at timestamptz,
  add column title text,
  add column event_type text,
  add column origin text,
  add column created_by uuid references public.profiles(id) on delete set null,
  add constraint visits_end_after_start check (ends_at is null or ends_at > scheduled_at);

alter table public.visits alter column created_by set default auth.uid();

comment on column public.visits.ends_at is
  'Fim informado pelo agendador. Visita sem fim bloqueia o dia em America/Sao_Paulo, sem inferir duracao.';

create index visits_scheduled_agenda_idx on public.visits (broker_id, scheduled_at)
  where result = 'scheduled';

-- O mesmo lock é usado por API e gravação manual, inclusive troca de corretor e cancelamento.
create or replace function private.proteger_horario_visita_3c()
returns trigger language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_config jsonb;
  v_broker uuid;
  v_brokers uuid[];
  v_changed boolean;
  v_inicio timestamptz;
  v_fim timestamptz;
begin
  if tg_op = 'UPDATE' then
    v_brokers := array[old.broker_id, new.broker_id];
    v_changed := new.broker_id is distinct from old.broker_id
      or new.scheduled_at is distinct from old.scheduled_at
      or new.ends_at is distinct from old.ends_at
      or (new.result = 'scheduled' and old.result <> 'scheduled');
  else
    v_brokers := array[new.broker_id];
    v_changed := true;
  end if;
  select c.config into v_config from private.integration_credentials c
   where c.provider = '3c' and c.label = 'api_token' and c.active
     and c.config->>'enabled' = 'true';
  if not found then return new; end if;
  v_brokers := array(select distinct b from unnest(v_brokers) b
    where b is not null and v_config->'agenda_ids' @> to_jsonb(b::text) order by b);
  if cardinality(v_brokers) = 0 then return new; end if;
  for v_broker in select b from unnest(v_brokers) b order by b loop
    perform pg_advisory_xact_lock(hashtextextended('3c:agenda:' || v_broker::text, 0));
  end loop;
  if new.result <> 'scheduled' or not v_changed then return new; end if;
  if not coalesce(v_config->'agenda_ids' @> to_jsonb(new.broker_id::text), false) then return new; end if;
  if tg_op = 'UPDATE' and new.scheduled_at is distinct from old.scheduled_at
      and new.ends_at is not distinct from old.ends_at and old.ends_at is not null then
    new.ends_at := new.scheduled_at + (old.ends_at - old.scheduled_at);
  end if;
  -- Fim desconhecido, inclusive em visita nova: ocupa o dia sem gravar fim ficticio.
  v_inicio := case when new.ends_at is null then
    ((new.scheduled_at at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
    else new.scheduled_at end;
  v_fim := coalesce(new.ends_at,
    (((new.scheduled_at at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo'));
  if exists (
    select 1 from public.visits v
    where v.broker_id = new.broker_id and v.result = 'scheduled' and v.id <> new.id
      and (new.ends_at is not null or v.ends_at is not null)
      and v_inicio < coalesce(v.ends_at,
        (((v.scheduled_at at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo'))
      and v_fim > case when v.ends_at is null
        then ((v.scheduled_at at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
        else v.scheduled_at end
  ) then
    raise exception 'HORARIO_OCUPADO: o corretor já possui uma visita nesse período.' using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function private.proteger_horario_visita_3c() from public, anon, authenticated;
create trigger visits_proteger_horario_3c
  before insert or update of broker_id, scheduled_at, ends_at, result on public.visits
  for each row execute function private.proteger_horario_visita_3c();

-- Chamada apenas pelo RPC da integração, que autentica e valida o principal fresco.
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
      and (l.assigned_to = any(v_agendas) or l.distribution_group_id = any(v_groups)) for no key update;
  exception when invalid_text_representation then
    return jsonb_build_object('status', 422, 'body', jsonb_build_object('erro', 'DADOS_INVALIDOS', 'mensagem', 'Informe um lead_id válido.'));
  end;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('erro', 'LEAD_NAO_ENCONTRADO', 'mensagem', 'Lead não encontrado.'));
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

revoke all on function private.integracao_3c_agenda(text, jsonb, jsonb, uuid) from public, anon, authenticated;
