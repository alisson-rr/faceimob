-- =============================================================================
-- Fase 2 - Catalogo comercial, roleta, check-in e configuracao SDR
-- =============================================================================

insert into public.developers (
  id, name, slug, flow, submission_email, contact_name, contact_phone, notes
)
values
  ('30000000-0000-0000-0000-000000000001', 'Horizonte Urbanismo', 'horizonte-urbanismo',
   'internal', null, 'Roberta Almeida', '5511988001001', 'Construtora de demonstracao com fluxo interno no CCA.'),
  ('30000000-0000-0000-0000-000000000002', 'Viva Lar Incorporadora', 'viva-lar-incorporadora',
   'external', 'credito@vivalar.example.invalid', 'Gustavo Nunes', '5511988001002', 'Fluxo externo de demonstracao.')
on conflict (id) do nothing;

insert into public.developer_projects (id, developer_id, name, city, state)
values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Parque das Flores', 'Sao Paulo', 'SP'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Reserva Paulista', 'Campinas', 'SP'),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'Viva Centro', 'Curitiba', 'PR'),
  ('31000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Jardins do Sul', 'Porto Alegre', 'RS')
on conflict (id) do nothing;

insert into public.allowed_ips (id, label, ip_range, team_id, created_by)
values
  ('32000000-0000-0000-0000-000000000001', 'Desenvolvimento local', '127.0.0.1/32', null,
   '10000000-0000-0000-0000-000000000001'),
  ('32000000-0000-0000-0000-000000000002', 'Rede da unidade Paulista', '192.168.10.0/24',
   '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('32000000-0000-0000-0000-000000000003', 'Rede da unidade Sul', '192.168.20.0/24',
   '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.distribution_groups (id, name, slug, kind, attend_timeout_seconds)
values
  ('33000000-0000-0000-0000-000000000001', 'Leads Parque das Flores', 'leads-parque-das-flores', 'specific', 420),
  ('33000000-0000-0000-0000-000000000002', 'Leads Regiao Sul', 'leads-regiao-sul', 'specific', 360)
on conflict (slug) do nothing;

insert into public.distribution_group_members (group_id, profile_id)
select g.id, m.profile_id
from (
  values
    ('fila-geral', '10000000-0000-0000-0000-000000000005'::uuid),
    ('fila-geral', '10000000-0000-0000-0000-000000000006'::uuid),
    ('fila-geral', '10000000-0000-0000-0000-000000000007'::uuid),
    ('fila-geral', '10000000-0000-0000-0000-000000000008'::uuid),
    ('fila-geral', '10000000-0000-0000-0000-000000000009'::uuid),
    ('fila-geral', '10000000-0000-0000-0000-000000000010'::uuid),
    ('leads-parque-das-flores', '10000000-0000-0000-0000-000000000005'::uuid),
    ('leads-parque-das-flores', '10000000-0000-0000-0000-000000000006'::uuid),
    ('leads-parque-das-flores', '10000000-0000-0000-0000-000000000007'::uuid),
    ('leads-regiao-sul', '10000000-0000-0000-0000-000000000008'::uuid),
    ('leads-regiao-sul', '10000000-0000-0000-0000-000000000009'::uuid),
    ('leads-regiao-sul', '10000000-0000-0000-0000-000000000010'::uuid)
) as m(group_slug, profile_id)
join public.distribution_groups g on g.slug = m.group_slug
on conflict (group_id, profile_id) do nothing;

insert into public.distribution_group_forms (group_id, form_id, form_name)
select g.id, f.form_id, f.form_name
from (
  values
    ('leads-parque-das-flores', 'seed-form-parque-flores', 'Formulario Parque das Flores'),
    ('leads-regiao-sul', 'seed-form-regiao-sul', 'Formulario Regiao Sul')
) as f(group_slug, form_id, form_name)
join public.distribution_groups g on g.slug = f.group_slug
on conflict (form_id) do nothing;

insert into public.automation_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.checkins (
  id, profile_id, shift_id, work_date, checked_in_at, checked_out_at,
  auto_checkout, ip_address, leads_received
)
select
  c.id,
  c.profile_id,
  s.id,
  c.work_date,
  c.checked_in_at,
  c.checked_out_at,
  c.auto_checkout,
  c.ip_address::inet,
  c.leads_received
from (
  values
    ('34000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'manha', current_date - 1, now() - interval '1 day 8 hours', now() - interval '1 day 3 hours', true,  '192.168.10.11', 4),
    ('34000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000006'::uuid, 'manha', current_date - 1, now() - interval '1 day 8 hours', now() - interval '1 day 3 hours', true,  '192.168.10.12', 3),
    ('34000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'tarde', current_date - 1, now() - interval '1 day 5 hours', now() - interval '1 day',         true,  '192.168.20.11', 5),
    ('34000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'manha', current_date,     now() - interval '3 hours',       null,                               false, '192.168.10.11', 2),
    ('34000000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000006'::uuid, 'manha', current_date,     now() - interval '3 hours',       null,                               false, '192.168.10.12', 1),
    ('34000000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'tarde', current_date,     now() - interval '2 hours',       null,                               false, '192.168.20.11', 2)
) as c(id, profile_id, shift_code, work_date, checked_in_at, checked_out_at, auto_checkout, ip_address, leads_received)
join public.work_shifts s on s.code = c.shift_code
on conflict (profile_id, work_date, shift_id) do nothing;

insert into public.whatsapp_templates (
  id, name, language, category, body, variables, provider_template_id, approved
)
values
  ('35000000-0000-0000-0000-000000000001', 'boas_vindas_faceimob', 'pt_BR', 'UTILITY',
   'Ola, {{1}}! Recebemos seu interesse no {{2}}. Posso fazer algumas perguntas rapidas?',
   array['nome', 'empreendimento'], 'seed-template-welcome', true),
  ('35000000-0000-0000-0000-000000000002', 'retomada_interesse', 'pt_BR', 'MARKETING',
   'Ola, {{1}}! Temos novidades que combinam com o imovel que voce procura. Quer conversar?',
   array['nome'], 'seed-template-remarketing', true)
on conflict (name) do nothing;

insert into public.sdr_agents (
  id, name, role, is_orchestrator, system_prompt, model, temperature,
  max_turns, handoff_group_id
)
select
  '36000000-0000-0000-0000-000000000001',
  'Orquestrador FACEIMOB',
  'orchestrator',
  true,
  'Identifique o interesse, a renda aproximada, a cidade e o prazo de compra. Encaminhe leads qualificados para um corretor.',
  'claude-sonnet-5',
  0.4,
  10,
  g.id
from public.distribution_groups g
where g.slug = 'fila-geral'
  and not exists (select 1 from public.sdr_agents a where a.active and a.is_orchestrator)
on conflict (id) do nothing;

insert into public.sdr_agents (
  id, name, role, is_orchestrator, system_prompt, model, temperature,
  max_turns, handoff_group_id
)
select
  '36000000-0000-0000-0000-000000000002',
  'Qualificador de Credito',
  'qualifier',
  false,
  'Colete renda familiar, FGTS, entrada disponivel e restricoes de credito sem prometer aprovacao.',
  'claude-sonnet-5',
  0.3,
  8,
  g.id
from public.distribution_groups g
where g.slug = 'triagem-sdr-ia'
on conflict (id) do nothing;

update public.lead_sources
set form_id = coalesce(form_id, case code
      when 'meta_ads' then 'seed-form-parque-flores'
      when 'portal' then 'seed-form-regiao-sul'
      else null
    end),
    sdr_agent_id = coalesce(sdr_agent_id,
      (select id from public.sdr_agents where id = '36000000-0000-0000-0000-000000000001'),
      (select id from public.sdr_agents where active order by is_orchestrator desc, created_at limit 1)
    ),
    welcome_template_id = coalesce(
      welcome_template_id,
      (select id from public.whatsapp_templates where name = 'boas_vindas_faceimob')
    )
where code in ('meta_ads', 'portal');
