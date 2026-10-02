-- =============================================================================
-- 0188 — importação da base da Leadfy, pelo administrador
--
-- Pedido do cliente em 02/10/2026: importar a planilha "Leads Todos" da Leadfy
-- (≈ 30 mil linhas) sem duplicar o que já está no CRM:
--   · "Em negociação" com corretor ativo no CRM → em atendimento com ele,
--     atribuído AGORA (aparece para o corretor, depois do recomeço da 0187);
--   · arquivado, novo sem corretor e em negociação sem corretor no CRM → na
--     base como perdido, com o motivo da Leadfy, para exportação e lista de
--     ligação; o corretor de origem fica gravado (atribuído na data original,
--     então só a gestão o vê);
--   · negócio fechado → convertido.
-- A planilha não vai para o repositório: a tela lê o arquivo no navegador e
-- manda as linhas em lotes para `importar_leads_leadfy`.
--
-- Batida contra duplicidade, nesta ordem: o mesmo identificador da Leadfy
-- (`external_id = 'leadfy:<id>'`, reimportar é seguro), o mesmo telefone
-- normalizado e o mesmo e-mail. Dentro da planilha vale o primeiro que chega —
-- a tela manda "em negociação" e os mais novos primeiro.
--
-- Sem aviso de lead novo: quem insere é o admin logado (`leads_avisa_admin`
-- não dispara) e a atribuição é gravada direto, sem `lead_assignments` (de
-- onde sai o aviso ao corretor). O lead importado não entra na roleta.
-- =============================================================================

insert into public.lead_sources (code, label, channel, active)
values ('leadfy', 'Leadfy · Importação', 'import', true)
on conflict (code) do nothing;

create index if not exists leads_email_lower_idx on public.leads (lower(email)) where email is not null;

-- Nome comparável: sem acento, minúsculo, só letras e espaço simples.
create or replace function public.nome_comparavel(p_nome text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(
           lower(translate(coalesce(p_nome, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
             'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
           '[^a-z]+', ' ', 'g')), '');
$$;

revoke all on function public.nome_comparavel(text) from public, anon;
grant execute on function public.nome_comparavel(text) to authenticated, service_role;

-- Perfil ATIVO do CRM para o nome do corretor na Leadfy: nome completo ou
-- apelido iguais; senão o ÚNICO perfil cujo nome contém todas as palavras do
-- nome da Leadfy e começa pela mesma ("Marco Antonio" → "Marco Antonio
-- Torres"). Ambíguo ou ausente = sem corretor.
create or replace function public.perfil_pelo_nome_leadfy(p_nome text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome   text := public.nome_comparavel(p_nome);
  v_partes text[];
  v_ids    uuid[];
begin
  if v_nome is null then
    return null;
  end if;
  select array_agg(p.id) into v_ids
    from public.profiles p
   where p.status = 'active'
     and (public.nome_comparavel(p.full_name) = v_nome or public.nome_comparavel(p.nickname) = v_nome);
  if array_length(v_ids, 1) = 1 then
    return v_ids[1];
  end if;
  v_partes := string_to_array(v_nome, ' ');
  select array_agg(p.id) into v_ids
    from public.profiles p
   where p.status = 'active'
     and string_to_array(public.nome_comparavel(p.full_name), ' ') @> v_partes
     and split_part(public.nome_comparavel(p.full_name), ' ', 1) = v_partes[1];
  if array_length(v_ids, 1) = 1 then
    return v_ids[1];
  end if;
  return null;
end;
$$;

revoke all on function public.perfil_pelo_nome_leadfy(text) from public, anon, authenticated;

-- Prévia da tela: para cada nome da planilha, o perfil que vai receber.
create or replace function public.previa_corretores_leadfy(p_nomes text[])
returns table (nome text, profile_id uuid, perfil text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só administrador e sócio importam leads.' using errcode = '42501';
  end if;
  return query
  select n, pid, (select p.full_name from public.profiles p where p.id = pid)
    from (select distinct unnest(p_nomes) as n) x
    cross join lateral (select public.perfil_pelo_nome_leadfy(x.n) as pid) m
   order by n;
end;
$$;

revoke all on function public.previa_corretores_leadfy(text[]) from public, anon;
grant execute on function public.previa_corretores_leadfy(text[]) to authenticated;

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

    v_status := case
      when r->>'status' = 'Em negociação' and v_corretor is not null then 'attending'
      when r->>'status' = 'Negócio fechado' then 'converted'
      else 'lost'
    end;
    v_etapa := case
      when v_status <> 'attending' then 'new'
      when r->>'atividade' = 'Sem resposta' then 'no_response'
      when r->>'atividade' = 'Visita Agendada' then 'scheduled_visit'
      when r->>'atividade' = 'Aguardando Documentação' then 'gathering_docs'
      when r->>'atividade' in ('Em Proposta', 'Em Análise de Crédito', 'Em negociação') then 'hot'
      else 'first_contact'
    end;
    v_motivo := case
      when v_status <> 'lost' then null
      when r->>'status' = 'Em negociação' then 'Leadfy: em negociação com corretor fora do CRM (' || coalesce(nullif(r->>'corretor', ''), 'sem corretor') || ')'
      when r->>'status' = 'Novo' then 'Leadfy: novo, sem corretor'
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
comment on function public.importar_leads_leadfy(jsonb) is
  'Importa um lote (até 1000) da planilha da Leadfy, sem duplicar por id, telefone ou e-mail. Só admin e sócio (0188).';

-- Lista de ligação (0185): convertido sem negócio vinculado (o "negócio
-- fechado" da Leadfy) já é cliente e não entra.
create or replace function public.lista_de_ligacao()
returns table (campanha text, cliente text, telefone text, criado_em timestamptz)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.has_permission('leads.call_list') then
    raise exception 'Seu perfil não extrai a lista de ligação.' using errcode = '42501';
  end if;

  return query
  select coalesce(nullif(btrim(l.campaign_name), ''), nullif(btrim(l.utm_campaign), ''),
                  s.label, 'Sem campanha'),
         l.full_name,
         coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')),
         l.created_at
    from public.leads l
    left join public.lead_sources s on s.id = l.source_id
   -- "Do mês passado para trás": antes do 1º dia do mês corrente, no fuso da operação.
   where l.created_at < (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
     and l.converted_deal_id is null
     and l.status <> 'converted'
     and coalesce(nullif(btrim(l.phone), ''), nullif(btrim(l.phone_raw), '')) is not null
   order by 1, l.created_at desc;
end;
$$;
