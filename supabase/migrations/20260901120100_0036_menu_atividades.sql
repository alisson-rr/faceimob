-- =============================================================================
-- 0036 — Menu "Atividades"
--
-- A agenda do que a pessoa marcou dentro de um lead ou negócio (`tasks`, 0011)
-- só existia dentro dos modais. "Atividade vencida" é compromisso da pessoa e
-- nada acontece sozinho quando vence — o valor está em alguém ver que venceu,
-- e para isso precisa de uma tela com item de menu.
--
-- Mesmo mecanismo da 0015: o item vira código em `permissions` e a visibilidade
-- sai de `role_permissions` + `has_permission()`. Admin não precisa de linha
-- (`has_permission` curto-circuita em `is_admin()`). Quem recorta o conteúdo é
-- o RLS de `tasks`; aqui é só quem enxerga o item.
-- =============================================================================

insert into public.permissions (code, label, category, description) values
  ('menu.atividades', 'Atividades', 'menu', null)
on conflict (code) do nothing;

-- Os papéis que atendem lead e tocam negócio. CCA, SDR e marketing não marcam
-- atividade para si nessas telas.
insert into public.role_permissions (role, permission, allowed)
select r.role, p.code, true
from (values
  ('partner'::app_role, 'menu.atividades'),
  ('director',          'menu.atividades'),
  ('manager',           'menu.atividades'),
  ('broker',            'menu.atividades')
) as r(role, permission)
join public.permissions p on p.code = r.permission
on conflict (role, permission) do nothing;
