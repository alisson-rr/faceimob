-- =============================================================================
-- 0218 — documentos da coleta do site direto nos anexos do lead
--
-- Pedido de 04/10/2026: "se conseguir já largar as docs no card do lead,
-- melhor ainda, aí eliminamos o Drive". A coleta de documentos do site
-- (análise de crédito) mandava os arquivos para uma pasta do Google Drive — e
-- na VPS a conta do Drive nem está configurada. Agora:
--   · o servidor do site (`site_server`) grava os arquivos no bucket do CRM
--     `lead-attachments`, SÓ sob o prefixo `site/` (inserir e ler o que gravou;
--     nada de apagar nem de ler os anexos do CRM);
--   · o gatilho que cria o lead (0173) anexa esses arquivos ao lead
--     (`lead_attachments`), e quem recebe o lead abre na aba Anexos, com a
--     mesma permissão de qualquer anexo (0141).
-- O Drive vira opcional no site: com a conta configurada, a pasta continua
-- indo nas notas.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'site_server') then
    raise warning '0218: papel site_server ausente; rode a 0172 como supabase_admin.';
    return;
  end if;
  begin
    drop policy if exists "site_server: documentos da coleta" on storage.objects;
    create policy "site_server: documentos da coleta" on storage.objects
      for insert to site_server
      with check (bucket_id = 'lead-attachments' and name like 'site/%');
    drop policy if exists "site_server: lê documentos da coleta" on storage.objects;
    create policy "site_server: lê documentos da coleta" on storage.objects
      for select to site_server
      using (bucket_id = 'lead-attachments' and name like 'site/%');
  exception when others then
    raise warning '0218: não criei as policies do site_server em storage.objects (%). Rode este arquivo como supabase_admin.', sqlerrm;
  end;
end;
$$;

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
  v_arquivos jsonb;
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
    select c.drive_folder_url, c.files into v_pasta, v_arquivos
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
    case when jsonb_typeof(v_arquivos) = 'array'
          and exists (select 1 from jsonb_array_elements(v_arquivos) f where f ? 'storage_path')
         then 'Documentos do cliente: na aba Anexos deste lead.' end,
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

  -- 0218: os documentos da coleta viram anexos do lead. Só arquivo que o site
  -- gravou mesmo no bucket, sob `site/` — o caminho vindo da linha não basta.
  if v_lead is not null and jsonb_typeof(v_arquivos) = 'array' then
    insert into public.lead_attachments (lead_id, storage_path, original_name, stored_name, mime_type, size_bytes)
    select v_lead, o.name,
           left(coalesce(nullif(btrim(f ->> 'name'), ''), regexp_replace(o.name, '^.*/', '')), 200),
           regexp_replace(o.name, '^.*/', ''),
           left(f ->> 'mime', 120),
           case when (f ->> 'size') ~ '^[0-9]{1,12}$' then (f ->> 'size')::bigint end
      from jsonb_array_elements(v_arquivos) f
      join storage.objects o
        on o.bucket_id = 'lead-attachments'
       and o.name = f ->> 'storage_path'
       and o.name like 'site/%'
    on conflict (storage_path) do nothing;
  end if;

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

comment on function site.leads_para_o_crm() is
  'Lead do site vira lead do CRM, com origem amigável, página de origem, pasta do Drive (se houver) e os documentos da coleta como anexos do lead (0173, 0218).';
