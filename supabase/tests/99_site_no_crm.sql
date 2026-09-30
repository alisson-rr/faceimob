-- =============================================================================
-- 0172 — a chave do site só abre o schema `site` e os buckets do site.
-- 0173 — lead do site vira lead do CRM, com origem amigável e links.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.ok(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000017201', 'rita@v0172.test', '{"full_name":"Rita Editora 0172"}')
on conflict do nothing;

insert into site.properties (id, code, slug, title, city, active)
values ('00000000-0000-0000-0000-0000000172a1', 'T0172', 'imovel-0172', 'Residencial 0172', 'Porto Alegre', true);

-- No Supabase real o RLS de storage.objects está ligado; o stub local não liga.
alter table storage.objects enable row level security;

-- -----------------------------------------------------------------------------
-- 0172: o papel do servidor do site
-- -----------------------------------------------------------------------------
set role site_server;
do $$
begin
  perform pg_temp.ok((select count(*) from site.properties where code = 'T0172') = 1,
    'site_server lê as tabelas do site');
  update site.properties set title = 'Residencial 0172 revisto' where code = 'T0172';
  perform pg_temp.ok(found, 'site_server grava nas tabelas do site');

  begin
    perform 1 from public.leads limit 1;
    raise exception 'FALHOU: site_server leu public.leads';
  exception when insufficient_privilege then
    raise notice '  ok  site_server não lê os leads do CRM';
  end;

  begin
    perform 1 from public.profiles limit 1;
    raise exception 'FALHOU: site_server leu public.profiles';
  exception when insufficient_privilege then
    raise notice '  ok  site_server não lê perfis do CRM direto';
  end;

  begin
    perform 1 from auth.users limit 1;
    raise exception 'FALHOU: site_server leu auth.users';
  exception when insufficient_privilege then
    raise notice '  ok  site_server não lê o Auth';
  end;

  perform pg_temp.ok(
    (select full_name from site.crm_perfil_por_email('RITA@v0172.test')) = 'Rita Editora 0172',
    'site_server acha perfil do CRM pelo e-mail, só pela função');
  perform pg_temp.ok(
    (select count(*) from site.crm_perfis(array['00000000-0000-0000-0000-000000017201'::uuid])) = 1,
    'site_server lê nome e e-mail pelos ids');

  insert into storage.objects (bucket_id, name) values ('property-images', 'teste-0172.jpg');
  raise notice '  ok  site_server grava no bucket do site';

  begin
    insert into storage.objects (bucket_id, name) values ('lead-attachments', 'teste-0172.pdf');
    raise exception 'FALHOU: site_server gravou em bucket do CRM';
  exception when insufficient_privilege then
    raise notice '  ok  site_server não grava em bucket do CRM';
  end;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-000000017201', 'role', 'authenticated')::text, true);
do $$
begin
  perform site.crm_perfis(array['00000000-0000-0000-0000-000000017201'::uuid]);
  raise exception 'FALHOU: usuário logado chamou site.crm_perfis';
exception when insufficient_privilege then
  raise notice '  ok  perfis do CRM não saem para usuário logado';
end
$$;
reset role;

-- -----------------------------------------------------------------------------
-- 0173: lead do site vira lead do CRM
-- -----------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into site.leads (id, name, phone, message, property_id, source, page_url) values
  ('00000000-0000-0000-0000-0000000173b1', 'Ana Visitante', '51999990173', 'Quero visitar',
   '00000000-0000-0000-0000-0000000172a1', 'property_whatsapp', 'https://faceimob.com.br/imovel/imovel-0172'),
  ('00000000-0000-0000-0000-0000000173b2', 'Beto Popup', '51999990174', null,
   null, 'canal_novo', 'javascript:alert(1)');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into site.credit_applications (name, phone, doc_type, address, drive_folder_url, consent_lgpd)
values ('Caio Crédito', '51999990175', 'rg', 'Rua 0173', 'https://drive.google.com/drive/folders/pasta0173', true);
insert into site.leads (id, name, phone, message, source, page_url) values
  ('00000000-0000-0000-0000-0000000173b3', 'Caio Crédito', '51999990175', 'Análise de crédito solicitada.',
   'credit_application', 'https://faceimob.com.br/imovel/imovel-0172');

do $$
declare
  v public.leads;
begin
  select * into v from public.leads where external_id = 'site:00000000-0000-0000-0000-0000000173b1';
  perform pg_temp.ok(v.id is not null, 'lead do site entrou no CRM');
  perform pg_temp.ok(
    (select label from public.lead_sources where id = v.source_id) = 'Site · Página do imóvel',
    'origem com nome amigável');
  perform pg_temp.ok(v.landing_page = 'https://faceimob.com.br/imovel/imovel-0172', 'link da página de origem');
  perform pg_temp.ok(v.notes like '%Imóvel: Residencial 0172 revisto (T0172)%', 'imóvel nas notas');
  perform pg_temp.ok(v.status in ('queued', 'assigned') and v.funnel_stage = 'new',
    'lead entra na fila da roleta como novo');

  select * into v from public.leads where external_id = 'site:00000000-0000-0000-0000-0000000173b2';
  perform pg_temp.ok((select code from public.lead_sources where id = v.source_id) = 'site',
    'canal desconhecido cai na origem "Site"');
  perform pg_temp.ok(v.landing_page is null, 'endereço que não é http(s) não vira link');

  select * into v from public.leads where external_id = 'site:00000000-0000-0000-0000-0000000173b3';
  perform pg_temp.ok(
    (select label from public.lead_sources where id = v.source_id) = 'Site · Coleta de documentos',
    'coleta de documentos com origem própria');
  perform pg_temp.ok(v.raw_payload->>'pasta_drive' = 'https://drive.google.com/drive/folders/pasta0173',
    'pasta do Drive vai com o lead');
  perform pg_temp.ok(v.notes like '%Pasta de documentos (Drive): https://drive.google.com/drive/folders/pasta0173%',
    'pasta do Drive nas notas');
end
$$;

-- Formulário da página do imóvel (0174) tem origem própria.
insert into site.leads (id, name, phone, source, property_id, page_url) values
  ('00000000-0000-0000-0000-0000000174b1', 'Dora Formulário', '51999990176', 'property_form',
   '00000000-0000-0000-0000-0000000172a1', 'https://faceimob.com.br/imovel/imovel-0172');
do $$
begin
  perform pg_temp.ok(
    (select s.label from public.leads l join public.lead_sources s on s.id = l.source_id
      where l.external_id = 'site:00000000-0000-0000-0000-0000000174b1') = 'Site · Formulário do imóvel',
    'formulário do imóvel com origem própria');
end
$$;

-- 0175: só as fotos do site ficam públicas; documentos continuam privados.
do $$
begin
  perform pg_temp.ok(
    (select bool_and(public) from storage.buckets where id in ('property-images', 'blog-images')),
    'fotos de imóveis e do blog em pasta pública');
  perform pg_temp.ok(
    not exists (select 1 from storage.buckets
                 where id in ('property-docs', 'support-docs', 'campaign-images') and public),
    'documentos e material de campanha seguem privados');
end
$$;

-- A cópia do Lovable desliga os gatilhos: lead antigo não entra de novo.
do $$
begin
  perform public.site_import_linhas('leads', jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-0000-0000-0000000173b9', 'name', 'Lead Antigo', 'phone', '51999990179',
    'source', 'whatsapp_button', 'created_at', '2026-01-01T00:00:00Z')));
  perform pg_temp.ok(
    not exists (select 1 from public.leads where external_id = 'site:00000000-0000-0000-0000-0000000173b9'),
    'lead importado do Lovable não vira lead novo no CRM');
end
$$;

rollback;
