-- =============================================================================
-- 0209 — Central do Corretor no CRM
--
-- Pedido do cliente em 03/10/2026: "a central do corretor pode direcionar ao
-- CRM para não termos 2 acessos e sim um só". A tela `/central` lê o que a Área
-- do Corretor do site já usava (schema `site`, 0169): atalhos, documentos de
-- suporte e progresso da Universidade, com a RLS de lá.
--
-- Item de menu como os outros (0015): código no catálogo, concedido a todos os
-- papéis. Admin passa por `is_admin()`; a matriz continua editável na tela.
-- =============================================================================

insert into public.permissions (code, label, category, description)
values ('menu.central', 'Central do Corretor', 'menu',
        'Atalhos, documentos de suporte para análise e Universidade.')
on conflict (code) do update
  set label = excluded.label, category = excluded.category, description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
select r, 'menu.central', true
  from unnest(enum_range(null::public.app_role)) as r
on conflict (role, permission) do nothing;
