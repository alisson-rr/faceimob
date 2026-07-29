-- =============================================================================
-- Fase 1 - Pessoas, papeis e equipes
--
-- As contas abaixo existem para dar consistencia aos relacionamentos do app.
-- Elas ficam bloqueadas no Supabase Auth e nao servem para login. Crie o seu
-- usuario real com `npm run user:create`.
-- =============================================================================

with seed_users(id, email, full_name, phone) as (
  values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'seed.admin@example.invalid',     'Amanda Administradora',  '5511999000001'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'seed.diretora@example.invalid',  'Daniela Diretora',        '5511999000002'),
    ('10000000-0000-0000-0000-000000000003'::uuid, 'seed.gerente.sp@example.invalid','Marcos Gerente',          '5511999000003'),
    ('10000000-0000-0000-0000-000000000004'::uuid, 'seed.gerente.sul@example.invalid','Fernanda Gerente',       '5511999000004'),
    ('10000000-0000-0000-0000-000000000005'::uuid, 'seed.ana@example.invalid',       'Ana Oliveira',            '5511999000005'),
    ('10000000-0000-0000-0000-000000000006'::uuid, 'seed.bruno@example.invalid',     'Bruno Santos',            '5511999000006'),
    ('10000000-0000-0000-0000-000000000007'::uuid, 'seed.carla@example.invalid',     'Carla Lima',              '5511999000007'),
    ('10000000-0000-0000-0000-000000000008'::uuid, 'seed.diego@example.invalid',     'Diego Costa',             '5511999000008'),
    ('10000000-0000-0000-0000-000000000009'::uuid, 'seed.elisa@example.invalid',     'Elisa Rocha',             '5511999000009'),
    ('10000000-0000-0000-0000-000000000010'::uuid, 'seed.felipe@example.invalid',    'Felipe Martins',          '5511999000010'),
    ('10000000-0000-0000-0000-000000000011'::uuid, 'seed.cca@example.invalid',       'Claudia Analista CCA',     '5511999000011'),
    ('10000000-0000-0000-0000-000000000012'::uuid, 'seed.sdr@example.invalid',       'Sara SDR',                 '5511999000012'),
    ('10000000-0000-0000-0000-000000000013'::uuid, 'seed.marketing@example.invalid', 'Mateus Marketing',         '5511999000013'),
    ('10000000-0000-0000-0000-000000000014'::uuid, 'seed.parceiro@example.invalid',  'Patricia Parceira',        '5511999000014')
)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  banned_until,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed_demo', true),
  jsonb_build_object('full_name', u.full_name, 'phone', u.phone, 'seed_demo', true),
  now(),
  now(),
  '2126-01-01 00:00:00+00'::timestamptz,
  '',
  '',
  '',
  ''
from seed_users u
where not exists (select 1 from auth.users au where au.id = u.id or au.email = u.email);

with seed_users(id, email) as (
  values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'seed.admin@example.invalid'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'seed.diretora@example.invalid'),
    ('10000000-0000-0000-0000-000000000003'::uuid, 'seed.gerente.sp@example.invalid'),
    ('10000000-0000-0000-0000-000000000004'::uuid, 'seed.gerente.sul@example.invalid'),
    ('10000000-0000-0000-0000-000000000005'::uuid, 'seed.ana@example.invalid'),
    ('10000000-0000-0000-0000-000000000006'::uuid, 'seed.bruno@example.invalid'),
    ('10000000-0000-0000-0000-000000000007'::uuid, 'seed.carla@example.invalid'),
    ('10000000-0000-0000-0000-000000000008'::uuid, 'seed.diego@example.invalid'),
    ('10000000-0000-0000-0000-000000000009'::uuid, 'seed.elisa@example.invalid'),
    ('10000000-0000-0000-0000-000000000010'::uuid, 'seed.felipe@example.invalid'),
    ('10000000-0000-0000-0000-000000000011'::uuid, 'seed.cca@example.invalid'),
    ('10000000-0000-0000-0000-000000000012'::uuid, 'seed.sdr@example.invalid'),
    ('10000000-0000-0000-0000-000000000013'::uuid, 'seed.marketing@example.invalid'),
    ('10000000-0000-0000-0000-000000000014'::uuid, 'seed.parceiro@example.invalid')
)
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id,
  u.email,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from seed_users u
where exists (select 1 from auth.users au where au.id = u.id)
on conflict (provider_id, provider) do nothing;

insert into public.user_roles (profile_id, role, granted_by)
values
  ('10000000-0000-0000-0000-000000000001', 'admin',     '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'director',  '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000003', 'manager',   '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000004', 'manager',   '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000005', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000006', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000007', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000008', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000009', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000010', 'broker',    '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000011', 'cca',       '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000012', 'sdr',       '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000013', 'marketing', '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000014', 'partner',   '10000000-0000-0000-0000-000000000001')
on conflict (profile_id, role) do nothing;

-- O trigger de auth concede broker por padrao. Nas personas nao comerciais,
-- removemos esse papel para os totais de equipe permanecerem corretos.
delete from public.user_roles
where role = 'broker'
  and profile_id in (
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000014'
  );

insert into public.teams (id, name, slug, director_id, manager_id)
values
  ('20000000-0000-0000-0000-000000000001', 'Equipe Paulista', 'equipe-paulista',
   '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', 'Equipe Sul', 'equipe-sul',
   '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004')
on conflict (slug) do nothing;

insert into public.team_members (id, team_id, profile_id, joined_at)
values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', current_date - 180),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', current_date - 160),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', current_date - 130),
  ('21000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', current_date - 90),
  ('21000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', current_date - 180),
  ('21000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000008', current_date - 150),
  ('21000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000009', current_date - 120),
  ('21000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000010', current_date - 75)
on conflict (id) do nothing;
