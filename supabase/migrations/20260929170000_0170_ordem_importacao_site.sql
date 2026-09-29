-- =============================================================================
-- 0170 — ordem da cópia do site: `properties` antes de `property_owners`
--
-- `site.property_owners.property_id` aponta para `site.properties`; na lista da
-- 0169 a tabela vinha antes do imóvel, e a primeira página de proprietários
-- bateria na chave estrangeira. Mesma lista, com a ordem certa. A cópia é
-- idempotente, então repetir depois desta correção não duplica nada.
-- =============================================================================
create or replace function public.site_import_tabelas()
returns text[]
language sql
immutable
as $$
  select array[
    'settings', 'settings_private', 'snippets', 'popups', 'announcements', 'cca_developers',
    'developer_folders', 'broker_links', 'scrapers_config', 'posts',
    'properties', 'property_owners', 'property_images', 'lotes', 'lote_imagens',
    'facebook_campaigns', 'credit_applications', 'leads',
    'university_sections', 'university_videos', 'university_watched', 'evolucao_universidade',
    'support_doc_editors', 'support_documents'
  ]::text[];
$$;
