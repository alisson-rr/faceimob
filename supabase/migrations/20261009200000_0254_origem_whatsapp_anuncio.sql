-- =============================================================================
-- 0254 · Origem "WhatsApp · Anúncio" para o lead do clique-para-WhatsApp
--
-- Pedido de 09/10/2026: campanha de mensagem para o WhatsApp precisa virar lead
-- na roleta. O `whatsapp-inbound-webhook` cria o lead quando a primeira
-- mensagem de um número desconhecido traz o `referral` do anúncio, e liga o
-- lead a esta origem para ele aparecer separado nos relatórios por origem.
-- =============================================================================

insert into public.lead_sources (code, label, channel, active)
values ('whatsapp_ads', 'WhatsApp · Anúncio', 'meta', true)
on conflict (code) do nothing;
