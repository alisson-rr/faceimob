-- =============================================================================
-- 0015 — Acesso ao menu como permissão de verdade
--
-- A tela `AdminPermissions.tsx` oferecia três matrizes (menu, funcionalidades,
-- etapas) e não gravava nenhuma delas: era `useState` puro. Funcionalidades e
-- etapas já tinham tabela (`role_permissions`, `stage_permissions`); o menu não
-- tinha nada — a visibilidade estava hardcoded em `AppSidebar.tsx`.
--
-- Em vez de criar uma tabela de menu, o item de menu vira um código no catálogo
-- `permissions` que já existe. Assim menu, funcionalidade e etapa passam a ser
-- governados pelo mesmo mecanismo (`role_permissions` + `has_permission`), e o
-- front continua lendo de um lugar só.
--
-- `has_permission()` já curto-circuita em `is_admin()`, então admin não precisa
-- de linha aqui: tem tudo por construção.
-- =============================================================================

insert into public.permissions (code, label, category, description) values
  ('menu.dashboard',             'Dashboard',           'menu', null),
  ('menu.pipeline',              'Pipeline',            'menu', null),
  ('menu.cca',                   'CCA Pipeline',        'menu', null),
  ('menu.marketing',             'Marketing',           'menu', null),
  ('menu.equipes',               'Equipes',             'menu', null),
  ('menu.links',                 'Links',               'menu', null),
  ('menu.gamification',          'Gamificação',         'menu', null),
  ('menu.resultados',            'Resultados',          'menu', null),
  ('menu.checkpoint',            'Checkpoint',          'menu', null),
  ('menu.checkin',               'Check-in',            'menu', null),
  ('menu.sdr',                   'SDR IA',              'menu', null),
  ('menu.leads',                 'Leads',               'menu', null),
  ('menu.data',                  'Dados',               'menu', null),
  ('menu.settings',              'Configurações',       'menu', 'Segurança da própria conta'),
  ('menu.admin_permissions',     'Admin · Permissões',  'menu', null),
  ('menu.admin_developers',      'Admin · Construtoras','menu', null),
  ('menu.admin_daily_teams',     'Admin · Diário',      'menu', null),
  ('menu.admin_allowed_ips',     'Admin · IPs',         'menu', null),
  ('menu.admin_lead_automation', 'Admin · Automação',   'menu', null)
on conflict (code) do nothing;

-- Concessões iniciais: reproduzem exatamente o que `AppSidebar.tsx` mostrava
-- antes desta migration, para que ninguém perca nem ganhe item no deploy.
-- A partir daqui a matriz é editável pela tela, que é o requisito.
insert into public.role_permissions (role, permission, allowed)
select r.role, p.code, true
from (values
  -- partner, director, manager e broker: o menu principal como estava
  ('partner'::app_role,  'menu.dashboard'),
  ('partner',            'menu.pipeline'),
  ('partner',            'menu.cca'),
  ('partner',            'menu.marketing'),
  ('partner',            'menu.equipes'),
  ('partner',            'menu.links'),
  ('partner',            'menu.gamification'),
  ('partner',            'menu.resultados'),
  ('partner',            'menu.checkpoint'),
  ('partner',            'menu.checkin'),
  ('partner',            'menu.sdr'),
  ('partner',            'menu.leads'),

  ('director',           'menu.dashboard'),
  ('director',           'menu.pipeline'),
  ('director',           'menu.marketing'),
  ('director',           'menu.equipes'),
  ('director',           'menu.links'),
  ('director',           'menu.gamification'),
  ('director',           'menu.resultados'),
  ('director',           'menu.checkpoint'),
  ('director',           'menu.checkin'),
  ('director',           'menu.sdr'),
  ('director',           'menu.leads'),

  ('manager',            'menu.dashboard'),
  ('manager',            'menu.pipeline'),
  ('manager',            'menu.marketing'),
  ('manager',            'menu.equipes'),
  ('manager',            'menu.links'),
  ('manager',            'menu.gamification'),
  ('manager',            'menu.resultados'),
  ('manager',            'menu.checkpoint'),
  ('manager',            'menu.checkin'),
  ('manager',            'menu.sdr'),
  ('manager',            'menu.leads'),

  ('broker',             'menu.dashboard'),
  ('broker',             'menu.pipeline'),
  ('broker',             'menu.equipes'),
  ('broker',             'menu.links'),
  ('broker',             'menu.gamification'),
  ('broker',             'menu.checkin'),
  ('broker',             'menu.leads'),

  ('cca',                'menu.cca'),
  ('cca',                'menu.equipes'),

  -- sdr e marketing não apareciam em nenhuma lista do sidebar: quem tinha só
  -- esse papel abria o sistema com o menu principal vazio. Concessão mínima
  -- para o papel existir na prática.
  ('sdr',                'menu.sdr'),
  ('sdr',                'menu.leads'),
  ('marketing',          'menu.marketing'),
  ('marketing',          'menu.resultados')
) as r(role, permission)
join public.permissions p on p.code = r.permission
on conflict (role, permission) do nothing;

-- `Dados` e `Configurações` ficavam fora do filtro por papel — todo mundo via.
-- Preserva esse estado; agora dá para restringir pela tela.
insert into public.role_permissions (role, permission, allowed)
select r.role, p.code, true
from public.permissions p
cross join (values
  ('partner'::app_role), ('director'), ('manager'), ('broker'),
  ('cca'), ('sdr'), ('marketing')
) as r(role)
where p.code in ('menu.data', 'menu.settings')
on conflict (role, permission) do nothing;
