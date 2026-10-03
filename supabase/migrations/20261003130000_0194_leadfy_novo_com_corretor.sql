-- =============================================================================
-- 0194 — importação da Leadfy: lead "Novo" com corretor do CRM vai para ele
--
-- Pedido do cliente em 03/10/2026, ao subir os leads de 01 e 02/10: "se for
-- duplicado não duplique e não dispare notificação, apenas distribua no
-- match". A 0188 só entregava ao corretor o lead "Em negociação"; o "Novo"
-- ficava na base como perdido mesmo com corretor do CRM. Agora os dois vão
-- para o corretor que casou, em atendimento, sem aviso (a importação não
-- passa pela roleta nem por `lead_assignments`). O resto da função não muda.
-- =============================================================================

create or replace function public.importar_leads_leadfy(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            jsonb;
  v_fonte      uuid;
  v_ext        text;
  v_fone       text;
  v_email      text;
  v_status     text;
  v_corretor   uuid;
  v_cache      jsonb := '{}'::jsonb;
  v_criado     timestamptz;
  v_atividade  timestamptz;
  v_etapa      text;
  v_motivo     text;
  v_inseridos  int := 0;
  v_atendimento int := 0;
  v_duplicados int := 0;
  v_invalidos  int := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio importam leads.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Mande no máximo 1000 linhas por lote.' using errcode = '22023';
  end if;

  select id into v_fonte from public.lead_sources where code = 'leadfy';

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_ext := 'leadfy:' || left(btrim(coalesce(r->>'id', '')), 80);
    if v_ext = 'leadfy:' then
      v_invalidos := v_invalidos + 1;
      continue;
    end if;
    v_fone := public.normalize_phone(nullif(btrim(r->>'telefone'), ''));
    v_email := lower(nullif(btrim(r->>'email'), ''));
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_email := null;
    end if;

    if exists (select 1 from public.leads where external_id = v_ext)
       or (v_fone is not null and exists (select 1 from public.leads where phone = v_fone))
       or (v_email is not null and exists (select 1 from public.leads where lower(email) = v_email)) then
      v_duplicados := v_duplicados + 1;
      continue;
    end if;

    -- Corretor: um lookup por nome por lote.
    if v_cache ? coalesce(r->>'corretor', '') then
      v_corretor := (v_cache ->> coalesce(r->>'corretor', ''))::uuid;
    else
      v_corretor := public.perfil_pelo_nome_leadfy(r->>'corretor');
      v_cache := v_cache || jsonb_build_object(coalesce(r->>'corretor', ''), v_corretor);
    end if;

    begin
      v_criado := coalesce((r->>'criado_em')::timestamptz, now());
    exception when others then
      v_criado := now();
    end;
    begin
      v_atividade := (r->>'data_atividade')::timestamptz;
    exception when others then
      v_atividade := null;
    end;

    -- 0194: "Novo" com corretor do CRM também vai para ele (pedido de 03/10/2026:
    -- "apenas distribua no match"), em atendimento e sem aviso — como "Em negociação".
    v_status := case
      when r->>'status' in ('Em negociação', 'Novo') and v_corretor is not null then 'attending'
      when r->>'status' = 'Negócio fechado' then 'converted'
      else 'lost'
    end;
    v_etapa := case
      when v_status <> 'attending' or r->>'status' = 'Novo' then 'new'
      when r->>'atividade' = 'Sem resposta' then 'no_response'
      when r->>'atividade' = 'Visita Agendada' then 'scheduled_visit'
      when r->>'atividade' = 'Aguardando Documentação' then 'gathering_docs'
      when r->>'atividade' in ('Em Proposta', 'Em Análise de Crédito', 'Em negociação') then 'hot'
      else 'first_contact'
    end;
    v_motivo := case
      when v_status <> 'lost' then null
      when r->>'status' = 'Em negociação' then 'Leadfy: em negociação com corretor fora do CRM (' || coalesce(nullif(r->>'corretor', ''), 'sem corretor') || ')'
      when r->>'status' = 'Novo' then 'Leadfy: novo, com corretor fora do CRM (' || coalesce(nullif(r->>'corretor', ''), 'sem corretor') || ')'
      else 'Leadfy: ' || coalesce(nullif(btrim(r->>'motivo'), ''), 'arquivado')
    end;

    insert into public.leads (
      full_name, phone, phone_raw, email, source_id, external_id,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, utm_source,
      status, funnel_stage, assigned_to, assigned_at, first_contact_at, last_activity_at,
      lost_reason, lost_at, notes, raw_payload, created_at
    ) values (
      left(coalesce(nullif(btrim(r->>'cliente'), ''), 'Sem nome'), 200),
      v_fone, left(nullif(btrim(r->>'telefone'), ''), 40), v_email, v_fonte, v_ext,
      left(nullif(btrim(r->>'campanha_id'), ''), 40), left(coalesce(nullif(btrim(r->>'campanha'), ''), nullif(btrim(r->>'formulario'), '')), 200),
      left(nullif(btrim(r->>'conjunto_id'), ''), 40), left(nullif(btrim(r->>'conjunto'), ''), 200),
      left(nullif(btrim(r->>'anuncio_id'), ''), 40), left(nullif(btrim(r->>'anuncio'), ''), 200),
      left(nullif(btrim(r->>'fonte'), ''), 80),
      v_status::lead_status, v_etapa::lead_funnel_stage,
      v_corretor,
      case when v_corretor is null then null when v_status = 'attending' then now() else v_criado end,
      case when v_status = 'attending' then v_criado end,
      coalesce(v_atividade, v_criado),
      v_motivo,
      case when v_status = 'lost' then coalesce(v_atividade, v_criado) end,
      left(concat_ws(E'\n',
        'Importado da Leadfy em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
        'Situação na Leadfy: ' || nullif(r->>'status', ''),
        'Corretor na Leadfy: ' || nullif(r->>'corretor', ''),
        'Gerente na Leadfy: ' || nullif(r->>'gerente', ''),
        'Grupo: ' || nullif(r->>'grupo', ''),
        'Imóvel: ' || nullif(r->>'imovel', ''),
        'Cidade: ' || nullif(r->>'cidade', ''),
        'Atividade: ' || nullif(r->>'atividade', ''),
        nullif(r->>'obs', '')), 4000),
      jsonb_build_object('leadfy', r),
      v_criado
    );

    v_inseridos := v_inseridos + 1;
    if v_status = 'attending' then
      v_atendimento := v_atendimento + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inseridos', v_inseridos, 'em_atendimento', v_atendimento,
    'duplicados', v_duplicados, 'invalidos', v_invalidos);
end;
$$;

revoke all on function public.importar_leads_leadfy(jsonb) from public, anon;
grant execute on function public.importar_leads_leadfy(jsonb) to authenticated;
