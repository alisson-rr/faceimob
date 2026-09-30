-- =============================================================================
-- 0173 — lead do site entra no CRM
--
-- Pedido do cliente em 30/09/2026: o Leadfy sai; todo lead do site
-- faceimob.com.br entra no CRM com a origem em nome amigável e o link da página
-- de onde veio. Na coleta de documentos (análise de crédito), o link da pasta
-- do Drive vai junto, para quem receber o lead abrir os documentos.
--
-- Todo envio do site grava uma linha em `site.leads` (a coleta de documentos
-- também, com `source = 'credit_application'`), então um gatilho só basta:
--   · cria o lead em `public.leads` (fila `queued`) e chama a roleta, como o
--     webhook da Meta;
--   · origem: uma linha de `lead_sources` por canal do site ("Site · Página do
--     imóvel", "Site · Coleta de documentos"…), editável no cadastro de origens;
--   · `landing_page` = página de origem; imóvel e pasta do Drive nas notas e em
--     `raw_payload`;
--   · `external_id = 'site:<id>'`: repetir não duplica.
-- A cópia do Lovable desliga os gatilhos de `site` (0169), então os leads
-- antigos não entram de novo. Falha aqui não perde o lead do site: ele continua
-- em `site.leads` e o motivo vai para o log do banco.
-- =============================================================================

insert into public.lead_sources (code, label, channel) values
  ('site',                      'Site',                               'organic'),
  ('site_property_whatsapp',    'Site · Página do imóvel',            'organic'),
  ('site_site_whatsapp',        'Site · WhatsApp flutuante',          'organic'),
  ('site_whatsapp_button',      'Site · Botão WhatsApp',              'organic'),
  ('site_contact_form',         'Site · Formulário de contato',       'organic'),
  ('site_exit_popup',           'Site · Popup de saída',              'organic'),
  ('site_popup',                'Site · Popup',                       'organic'),
  ('site_credit_application',   'Site · Coleta de documentos',        'organic'),
  ('site_hero_search',          'Site · Busca do topo',               'organic'),
  ('site_blog',                 'Site · Blog',                        'organic')
on conflict (code) do nothing;

create or replace function site.leads_para_o_crm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source   uuid;
  v_titulo   text;
  v_codigo   text;
  v_slug     text;
  v_pasta    text;
  v_pagina   text;
  v_lead     uuid;
  v_notas    text[];
begin
  select id into v_source from public.lead_sources
   where code = 'site_' || coalesce(nullif(new.source, ''), 'whatsapp_button');
  if v_source is null then
    select id into v_source from public.lead_sources where code = 'site';
  end if;

  if new.property_id is not null then
    select p.title, p.code, p.slug into v_titulo, v_codigo, v_slug
      from site.properties p where p.id = new.property_id;
  end if;

  -- A coleta grava a pasta em `credit_applications` logo antes deste lead.
  if new.source = 'credit_application' then
    select c.drive_folder_url into v_pasta
      from site.credit_applications c
     where c.phone = new.phone
       and c.created_at > now() - interval '15 minutes'
     order by c.created_at desc
     limit 1;
  end if;

  -- Só link http(s) vira link clicável no CRM.
  v_pagina := case when new.page_url ~* '^https?://' then left(new.page_url, 500) end;

  v_notas := array_remove(array[
    case when v_titulo is not null
         then format('Imóvel: %s%s', v_titulo, coalesce(' (' || v_codigo || ')', '')) end,
    case when v_pasta is not null then 'Pasta de documentos (Drive): ' || v_pasta end,
    nullif(left(trim(coalesce(new.message, '')), 1000), '')
  ], null);

  insert into public.leads (
    full_name, phone, phone_raw, email, status, funnel_stage,
    source_id, utm_source, landing_page, external_id, notes, raw_payload
  ) values (
    left(new.name, 200),
    new.phone,
    new.phone,
    nullif(new.email, ''),
    'queued',
    'new',
    v_source,
    'site',
    v_pagina,
    'site:' || new.id,
    nullif(array_to_string(v_notas, E'\n'), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'site_lead_id', new.id,
      'canal', new.source,
      'pagina', v_pagina,
      'imovel', case when v_titulo is not null then jsonb_build_object(
                  'titulo', v_titulo, 'codigo', v_codigo, 'slug', v_slug) end,
      'pasta_drive', v_pasta,
      'mensagem', new.message
    ))
  )
  on conflict (external_id) where external_id is not null do nothing
  returning id into v_lead;

  if v_lead is not null then
    begin
      perform public.assign_lead(v_lead);
    exception when others then
      -- Sem roleta agora, o lead fica `queued` e a varredura tenta de novo.
      raise warning 'site.leads_para_o_crm: roleta falhou para o lead %: %', v_lead, sqlerrm;
    end;
  end if;

  return null;
exception when others then
  raise warning 'site.leads_para_o_crm: lead do site % não entrou no CRM: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function site.leads_para_o_crm() from public, anon, authenticated;

drop trigger if exists leads_para_o_crm on site.leads;
create trigger leads_para_o_crm
  after insert on site.leads
  for each row execute function site.leads_para_o_crm();

comment on function site.leads_para_o_crm() is
  'Lead do site vira lead do CRM, com origem amigável (lead_sources site_*), página de origem e pasta do Drive da coleta de documentos (0173).';
