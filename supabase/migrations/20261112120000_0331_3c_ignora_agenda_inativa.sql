-- =============================================================================
-- 0331 · 3C: corretor suspenso/desligado na agenda não derruba a integração
--
-- Incidente de 10–12/11/2026: o Victor (um dos 9 corretores da agenda da 3C)
-- foi suspenso em 09/11 e TODA chamada da 3C passou a responder 503
-- INTEGRACAO_INDISPONIVEL, porque `integracao_3c_config_error` exigia que
-- cada agenda fosse um corretor ativo. Os agendamentos da Ana pararam de
-- chegar até a agenda ser editada à mão.
--
-- Agora a agenda e os grupos autorizados só precisam existir. Quem está
-- inativo é ignorado onde importa: a agenda (0284) já só oferece e agenda
-- corretor `active`, e grupo inativo não recebe lead. Para habilitar continua
-- sendo preciso ao menos um corretor ativo na agenda e o grupo de entrada
-- ativo: sem eles não há para onde mandar o lead, e o 503 é o certo.
-- =============================================================================

create or replace function private.integracao_3c_config_error(p_config jsonb, p_complete boolean)
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
  -- 0331: basta existir; ativo/inativo é decidido no uso.
  if exists (select 1 from unnest(v_groups) g where g is null or not exists (
      select 1 from public.distribution_groups d where d.id = g))
     or exists (select 1 from unnest(v_agendas) a where a is null or not exists (
      select 1 from public.profiles p join public.user_roles r on r.profile_id = p.id and r.role = 'broker'
      where p.id = a)) then return 'Grupo ou agenda inexistente.'; end if;
  if v_default is not null and not (v_default = any(v_groups)) then return 'O grupo padrão precisa estar autorizado.'; end if;
  if jsonb_array_length(p_config->'outcomes') not between 1 and 20
     or exists (select 1 from jsonb_array_elements(p_config->'outcomes') o
       where jsonb_typeof(o) <> 'string' or length(btrim(o #>> '{}')) not between 1 and 64) then return 'Desfechos inválidos.'; end if;
  if p_complete and (cardinality(v_groups) = 0 or cardinality(v_agendas) = 0 or v_default is null) then
    return 'Autorize grupos, grupo de entrada e agendas antes de habilitar.';
  end if;
  if p_complete and not exists (select 1 from public.distribution_groups d where d.id = v_default and d.active) then
    return 'O grupo de entrada está inativo.';
  end if;
  if p_complete and not exists (select 1 from public.profiles p where p.id = any(v_agendas) and p.status = 'active') then
    return 'Nenhum corretor ativo na agenda.';
  end if;
  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return 'Configuração inválida.';
end;
$$;
revoke all on function private.integracao_3c_config_error(jsonb,boolean) from public, anon, authenticated, service_role;
