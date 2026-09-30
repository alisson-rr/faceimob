-- =============================================================================
-- 0174 — origem "Site · Formulário do imóvel"
--
-- Pedido do cliente em 30/09/2026: na página do imóvel, o botão de WhatsApp dá
-- lugar a um formulário que manda o lead direto ao CRM (`source =
-- 'property_form'` em `site.leads`, 0173). O WhatsApp fica só no balão
-- flutuante. Sem esta linha o lead entraria com a origem genérica "Site".
-- =============================================================================
insert into public.lead_sources (code, label, channel) values
  ('site_property_form', 'Site · Formulário do imóvel', 'organic')
on conflict (code) do nothing;
