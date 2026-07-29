-- =============================================================================
-- Fase 3 - Leads, negocios, documentos, visitas, CCA e conversas SDR
-- =============================================================================

insert into public.leads (
  id, full_name, phone, phone_raw, email, document, source_id,
  distribution_group_id, form_id, external_id, campaign_id, campaign_name,
  adset_id, adset_name, ad_id, ad_name, utm_source, utm_medium, utm_campaign,
  landing_page, raw_payload, status, funnel_stage, assigned_to, assigned_at,
  attend_deadline, first_contact_at, last_activity_at, next_action_at,
  sdr_qualified_at, converted_at, lost_reason, lost_at, notes, created_at
)
select
  l.id, l.full_name, l.phone, l.phone, l.email, l.document, s.id,
  g.id, l.form_id, l.external_id, l.campaign_id, l.campaign_name,
  l.adset_id, l.adset_name, l.ad_id, l.ad_name, l.utm_source, l.utm_medium,
  l.utm_campaign, l.landing_page, l.raw_payload, l.status::lead_status,
  l.funnel_stage::lead_funnel_stage, l.assigned_to, l.assigned_at,
  l.attend_deadline, l.first_contact_at, l.last_activity_at, l.next_action_at,
  l.sdr_qualified_at, l.converted_at, l.lost_reason, l.lost_at, l.notes,
  l.created_at
from (
  values
    ('40000000-0000-0000-0000-000000000001'::uuid, 'Juliana Almeida', '5511981010001', 'juliana.almeida@example.com', null,
     'meta_ads', 'leads-parque-das-flores', 'seed-form-parque-flores', 'seed-lead-001',
     'seed-campaign-01', 'Lancamento Parque das Flores', 'seed-adset-01', 'Familias SP', 'seed-ad-01', 'Video apartamento decorado',
     'facebook', 'paid_social', 'parque_flores', 'https://faceimob.example/seed/parque-flores',
     '{"seed":true,"form":"parque-flores"}'::jsonb, 'queued', 'new', null::uuid, null::timestamptz,
     null::timestamptz, null::timestamptz, now() - interval '20 minutes', null::timestamptz,
     null::timestamptz, null::timestamptz, null::text, null::timestamptz,
     'Lead novo aguardando a roleta.', now() - interval '20 minutes'),

    ('40000000-0000-0000-0000-000000000002'::uuid, 'Rafael Souza', '5511981010002', 'rafael.souza@example.com', null,
     'portal', 'leads-regiao-sul', 'seed-form-regiao-sul', 'seed-lead-002',
     'seed-campaign-02', 'Imoveis Regiao Sul', 'seed-adset-02', 'Compradores Curitiba', 'seed-ad-02', 'Carrossel Viva Centro',
     'portal', 'referral', 'viva_centro', 'https://faceimob.example/seed/viva-centro',
     '{"seed":true,"form":"regiao-sul"}'::jsonb, 'assigned', 'new', '10000000-0000-0000-0000-000000000008'::uuid, now() - interval '2 minutes',
     now() + interval '4 minutes', null::timestamptz, now() - interval '2 minutes', now() + interval '1 hour',
     null::timestamptz, null::timestamptz, null::text, null::timestamptz,
     'Aguardando aceite do corretor.', now() - interval '15 minutes'),

    ('40000000-0000-0000-0000-000000000003'::uuid, 'Camila Ribeiro', '5511981010003', 'camila.ribeiro@example.com', '39053344705',
     'whatsapp', 'fila-geral', null, 'seed-lead-003',
     null, null, null, null, null, null, 'whatsapp', 'organic', 'atendimento_direto', null,
     '{"seed":true,"channel":"whatsapp"}'::jsonb, 'attending', 'warm', '10000000-0000-0000-0000-000000000005'::uuid, now() - interval '2 hours',
     null::timestamptz, now() - interval '115 minutes', now() - interval '25 minutes', now() + interval '3 hours',
     now() - interval '2 hours', null::timestamptz, null::text, null::timestamptz,
     'Renda familiar informada; verificar uso de FGTS.', now() - interval '1 day'),

    ('40000000-0000-0000-0000-000000000004'::uuid, 'Thiago Fernandes', '5511981010004', 'thiago.fernandes@example.com', null,
     'organico', 'fila-geral', null, 'seed-lead-004',
     null, null, null, null, null, null, 'google', 'organic', 'busca_imovel_sp', null,
     '{"seed":true}'::jsonb, 'in_progress', 'scheduled_visit', '10000000-0000-0000-0000-000000000006'::uuid, now() - interval '2 days',
     null::timestamptz, now() - interval '2 days', now() - interval '3 hours', now() + interval '1 day',
     null::timestamptz, null::timestamptz, null::text, null::timestamptz,
     'Visita ao decorado confirmada.', now() - interval '4 days'),

    ('40000000-0000-0000-0000-000000000005'::uuid, 'Mariana Lopes', '5511981010005', 'mariana.lopes@example.com', '52998224725',
     'indicacao', 'fila-geral', null, 'seed-lead-005',
     null, null, null, null, null, null, 'indicacao', 'referral', 'clientes_ativos', null,
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000005'::uuid, now() - interval '18 days',
     null::timestamptz, now() - interval '18 days', now() - interval '2 days', null::timestamptz,
     now() - interval '17 days', now() - interval '15 days', null::text, null::timestamptz,
     'Cliente convertido e contrato assinado.', now() - interval '20 days'),

    ('40000000-0000-0000-0000-000000000006'::uuid, 'Eduardo Nascimento', '5511981010006', 'eduardo.nascimento@example.com', '15350946056',
     'meta_ads', 'leads-parque-das-flores', 'seed-form-parque-flores', 'seed-lead-006',
     'seed-campaign-01', 'Lancamento Parque das Flores', 'seed-adset-03', 'Investidores SP', 'seed-ad-03', 'Imagem oportunidade',
     'instagram', 'paid_social', 'parque_flores', 'https://faceimob.example/seed/parque-flores',
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000007'::uuid, now() - interval '12 days',
     null::timestamptz, now() - interval '12 days', now() - interval '1 day', null::timestamptz,
     now() - interval '11 days', now() - interval '9 days', null::text, null::timestamptz,
     'Documentacao em analise pelo CCA.', now() - interval '14 days'),

    ('40000000-0000-0000-0000-000000000007'::uuid, 'Larissa Gomes', '5511981010007', 'larissa.gomes@example.com', '65074259001',
     'portal', 'leads-regiao-sul', 'seed-form-regiao-sul', 'seed-lead-007',
     'seed-campaign-02', 'Imoveis Regiao Sul', null, null, null, null, 'portal', 'referral', 'viva_centro', null,
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000009'::uuid, now() - interval '10 days',
     null::timestamptz, now() - interval '10 days', now() - interval '8 hours', null::timestamptz,
     now() - interval '9 days', now() - interval '7 days', null::text, null::timestamptz,
     'Proposta comercial em negociacao.', now() - interval '12 days'),

    ('40000000-0000-0000-0000-000000000008'::uuid, 'Henrique Araujo', '5511981010008', 'henrique.araujo@example.com', null,
     'importacao', 'fila-geral', null, 'seed-lead-008',
     null, null, null, null, null, null, 'csv', 'import', 'base_antiga', null,
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000010'::uuid, now() - interval '45 days',
     null::timestamptz, now() - interval '45 days', now() - interval '35 days', null::timestamptz,
     null::timestamptz, now() - interval '40 days', null::text, null::timestamptz,
     'Negocio convertido e posteriormente perdido.', now() - interval '50 days'),

    ('40000000-0000-0000-0000-000000000009'::uuid, 'Beatriz Castro', '5511981010009', 'beatriz.castro@example.com', '53754788006',
     'meta_ads', 'leads-regiao-sul', 'seed-form-regiao-sul', 'seed-lead-009',
     'seed-campaign-03', 'Jardins do Sul', null, null, null, null, 'instagram', 'paid_social', 'jardins_sul', null,
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000008'::uuid, now() - interval '38 days',
     null::timestamptz, now() - interval '38 days', now() - interval '3 days', null::timestamptz,
     now() - interval '37 days', now() - interval '34 days', null::text, null::timestamptz,
     'Contrato em fase final.', now() - interval '42 days'),

    ('40000000-0000-0000-0000-000000000010'::uuid, 'Lucas Moreira', '5511981010010', 'lucas.moreira@example.com', '71293718061',
     'organico', 'fila-geral', null, 'seed-lead-010',
     null, null, null, null, null, null, 'google', 'organic', 'reserva_paulista', null,
     '{"seed":true}'::jsonb, 'converted', 'qualified', '10000000-0000-0000-0000-000000000006'::uuid, now() - interval '75 days',
     null::timestamptz, now() - interval '75 days', now() - interval '60 days', null::timestamptz,
     null::timestamptz, now() - interval '70 days', null::text, null::timestamptz,
     'Venda de mes anterior para historico.', now() - interval '80 days'),

    ('40000000-0000-0000-0000-000000000011'::uuid, 'Isabela Moraes', '5511981010011', 'isabela.moraes@example.com', null,
     'whatsapp', 'fila-geral', null, 'seed-lead-011',
     null, null, null, null, null, null, 'whatsapp', 'organic', 'remarketing', null,
     '{"seed":true}'::jsonb, 'lost', 'no_response', '10000000-0000-0000-0000-000000000007'::uuid, now() - interval '9 days',
     null::timestamptz, now() - interval '9 days', now() - interval '4 days', null::timestamptz,
     null::timestamptz, null::timestamptz, 'Sem retorno apos cinco tentativas.', now() - interval '4 days',
     'Disponivel para campanha de retomada.', now() - interval '10 days'),

    ('40000000-0000-0000-0000-000000000012'::uuid, 'Guilherme Pires', '5511981010012', 'guilherme.pires@example.com', null,
     'meta_ads', 'fila-geral', null, 'seed-lead-012',
     'seed-campaign-04', 'Publico amplo', null, null, null, null, 'facebook', 'paid_social', 'captacao_geral', null,
     '{"seed":true}'::jsonb, 'discarded', 'new', null::uuid, null::timestamptz,
     null::timestamptz, null::timestamptz, now() - interval '3 days', null::timestamptz,
     null::timestamptz, null::timestamptz, null::text, null::timestamptz,
     'Telefone invalido; registro mantido para auditoria.', now() - interval '3 days')
) as l(
  id, full_name, phone, email, document, source_code, group_slug, form_id,
  external_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
  utm_source, utm_medium, utm_campaign, landing_page, raw_payload, status,
  funnel_stage, assigned_to, assigned_at, attend_deadline, first_contact_at,
  last_activity_at, next_action_at, sdr_qualified_at, converted_at, lost_reason,
  lost_at, notes, created_at
)
left join public.lead_sources s on s.code = l.source_code
left join public.distribution_groups g on g.slug = l.group_slug
on conflict (id) do nothing;

insert into public.lead_assignments (
  id, lead_id, profile_id, group_id, sequence, assigned_at, deadline,
  responded_at, released_at, release_reason
)
select
  a.id, a.lead_id, a.profile_id, g.id, 1, a.assigned_at, a.deadline,
  a.responded_at, a.released_at, a.release_reason::lead_release_reason
from (
  values
    ('41000000-0000-0000-0000-000000000001'::uuid, '40000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'leads-regiao-sul', now() - interval '2 minutes', now() + interval '4 minutes', null::timestamptz, null::timestamptz, null::text),
    ('41000000-0000-0000-0000-000000000002'::uuid, '40000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'fila-geral', now() - interval '2 hours', now() - interval '115 minutes', now() - interval '115 minutes', null::timestamptz, null::text),
    ('41000000-0000-0000-0000-000000000003'::uuid, '40000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000006'::uuid, 'fila-geral', now() - interval '2 days', now() - interval '2 days' + interval '5 minutes', now() - interval '2 days', null::timestamptz, null::text),
    ('41000000-0000-0000-0000-000000000004'::uuid, '40000000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'fila-geral', now() - interval '18 days', now() - interval '18 days' + interval '5 minutes', now() - interval '18 days', now() - interval '15 days', 'manual'),
    ('41000000-0000-0000-0000-000000000005'::uuid, '40000000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'leads-parque-das-flores', now() - interval '12 days', now() - interval '12 days' + interval '7 minutes', now() - interval '12 days', now() - interval '9 days', 'manual'),
    ('41000000-0000-0000-0000-000000000006'::uuid, '40000000-0000-0000-0000-000000000007'::uuid, '10000000-0000-0000-0000-000000000009'::uuid, 'leads-regiao-sul', now() - interval '10 days', now() - interval '10 days' + interval '6 minutes', now() - interval '10 days', now() - interval '7 days', 'manual'),
    ('41000000-0000-0000-0000-000000000007'::uuid, '40000000-0000-0000-0000-000000000008'::uuid, '10000000-0000-0000-0000-000000000010'::uuid, 'fila-geral', now() - interval '45 days', now() - interval '45 days' + interval '5 minutes', now() - interval '45 days', now() - interval '40 days', 'manual'),
    ('41000000-0000-0000-0000-000000000008'::uuid, '40000000-0000-0000-0000-000000000009'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'leads-regiao-sul', now() - interval '38 days', now() - interval '38 days' + interval '6 minutes', now() - interval '38 days', now() - interval '34 days', 'manual'),
    ('41000000-0000-0000-0000-000000000009'::uuid, '40000000-0000-0000-0000-000000000010'::uuid, '10000000-0000-0000-0000-000000000006'::uuid, 'fila-geral', now() - interval '75 days', now() - interval '75 days' + interval '5 minutes', now() - interval '75 days', now() - interval '70 days', 'manual'),
    ('41000000-0000-0000-0000-000000000010'::uuid, '40000000-0000-0000-0000-000000000011'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'fila-geral', now() - interval '9 days', now() - interval '9 days' + interval '5 minutes', now() - interval '9 days', now() - interval '4 days', 'manual')
) as a(id, lead_id, profile_id, group_slug, assigned_at, deadline, responded_at, released_at, release_reason)
left join public.distribution_groups g on g.slug = a.group_slug
on conflict (id) do nothing;

insert into public.lead_events (id, lead_id, actor_id, kind, from_value, to_value, detail, created_at)
values
  ('42000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', null, 'assigned', 'queued', '10000000-0000-0000-0000-000000000008', '{"seed":true}', now() - interval '2 minutes'),
  ('42000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', 'claimed', 'assigned', 'attending', '{"seed":true}', now() - interval '115 minutes'),
  ('42000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', 'stage_changed', 'warm', 'scheduled_visit', '{"seed":true}', now() - interval '1 day'),
  ('42000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'converted', 'in_progress', 'converted', '{"seed":true}', now() - interval '15 days'),
  ('42000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000007', 'status_changed', 'in_progress', 'lost', '{"reason":"no_response","seed":true}', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.lead_comments (id, lead_id, author_id, body, created_at)
values
  ('43000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', 'Cliente pretende usar FGTS e possui entrada aproximada de R$ 45 mil.', now() - interval '1 hour'),
  ('43000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', 'Visita confirmada com o casal para amanha as 15h.', now() - interval '3 hours'),
  ('43000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000011', 'Comprovante de renda recebido; falta extrato atualizado do FGTS.', now() - interval '1 day')
on conflict (id) do nothing;

insert into public.lead_attachments (
  id, lead_id, document_type_id, storage_path, original_name, stored_name,
  mime_type, size_bytes, uploaded_by
)
select
  a.id, a.lead_id, d.id, a.storage_path, a.original_name, a.stored_name,
  'application/pdf', a.size_bytes, a.uploaded_by
from (
  values
    ('44000000-0000-0000-0000-000000000001'::uuid, '40000000-0000-0000-0000-000000000003'::uuid, 'rg_cpf', 'seed/leads/003/rg-cpf-camila.pdf', 'documento-camila.pdf', 'rg-cpf-camila.pdf', 184320::bigint, '10000000-0000-0000-0000-000000000005'::uuid),
    ('44000000-0000-0000-0000-000000000002'::uuid, '40000000-0000-0000-0000-000000000006'::uuid, 'comprovante_renda', 'seed/leads/006/holerite-eduardo.pdf', 'holerite.pdf', 'comprovante-renda-eduardo.pdf', 245760::bigint, '10000000-0000-0000-0000-000000000007'::uuid)
) as a(id, lead_id, document_code, storage_path, original_name, stored_name, size_bytes, uploaded_by)
join public.document_types d on d.code = a.document_code
on conflict (storage_path) do nothing;

insert into public.deals (
  id, code, lead_id, developer_id, project_id, unit, stage_id, outcome,
  month_base, vgv_gross, discount_pct, lead_origin, notes, stage_entered_at,
  closed_at, lost_reason, created_by, created_at
)
select
  d.id, d.code, d.lead_id, d.developer_id, d.project_id, d.unit, s.id,
  d.outcome::deal_outcome, d.month_base, d.vgv_gross, d.discount_pct,
  d.lead_origin, d.notes, d.stage_entered_at, d.closed_at, d.lost_reason,
  d.created_by, d.created_at
from (
  values
    ('50000000-0000-0000-0000-000000000001'::uuid, 'SEED-NEG-001', '40000000-0000-0000-0000-000000000005'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '31000000-0000-0000-0000-000000000001'::uuid, 'Torre A - 804', 'closed', 'won', public.month_start(current_date), 485000::numeric, 2.5::numeric, 'Indicacao', 'Contrato assinado e venda concluida.', now() - interval '2 days', now() - interval '2 days', null::text, '10000000-0000-0000-0000-000000000005'::uuid, now() - interval '15 days'),
    ('50000000-0000-0000-0000-000000000002'::uuid, 'SEED-NEG-002', '40000000-0000-0000-0000-000000000006'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '31000000-0000-0000-0000-000000000001'::uuid, 'Torre B - 305', 'under_analysis', 'open', public.month_start(current_date), 420000::numeric, 0::numeric, 'Meta Ads', 'Analise de credito em andamento.', now() - interval '4 days', null::timestamptz, null::text, '10000000-0000-0000-0000-000000000007'::uuid, now() - interval '9 days'),
    ('50000000-0000-0000-0000-000000000003'::uuid, 'SEED-NEG-003', '40000000-0000-0000-0000-000000000007'::uuid, '30000000-0000-0000-0000-000000000002'::uuid, '31000000-0000-0000-0000-000000000003'::uuid, 'Unidade 1202', 'proposal', 'open', public.month_start(current_date), 390000::numeric, 1.0::numeric, 'Portal', 'Cliente avaliando a proposta.', now() - interval '2 days', null::timestamptz, null::text, '10000000-0000-0000-0000-000000000009'::uuid, now() - interval '7 days'),
    ('50000000-0000-0000-0000-000000000004'::uuid, 'SEED-NEG-004', '40000000-0000-0000-0000-000000000008'::uuid, '30000000-0000-0000-0000-000000000002'::uuid, '31000000-0000-0000-0000-000000000004'::uuid, 'Bloco 2 - 101', 'lost', 'lost', (public.month_start(current_date) - interval '1 month')::date, 510000::numeric, 0::numeric, 'Importacao', 'Cliente optou por outro empreendimento.', now() - interval '35 days', now() - interval '35 days', 'Comprou com concorrente.', '10000000-0000-0000-0000-000000000010'::uuid, now() - interval '40 days'),
    ('50000000-0000-0000-0000-000000000005'::uuid, 'SEED-NEG-005', '40000000-0000-0000-0000-000000000009'::uuid, '30000000-0000-0000-0000-000000000002'::uuid, '31000000-0000-0000-0000-000000000004'::uuid, 'Bloco 1 - 706', 'contract', 'open', (public.month_start(current_date) - interval '1 month')::date, 545000::numeric, 3.0::numeric, 'Meta Ads', 'Minuta enviada para assinatura.', now() - interval '3 days', null::timestamptz, null::text, '10000000-0000-0000-0000-000000000008'::uuid, now() - interval '34 days'),
    ('50000000-0000-0000-0000-000000000006'::uuid, 'SEED-NEG-006', '40000000-0000-0000-0000-000000000010'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '31000000-0000-0000-0000-000000000002'::uuid, 'Torre C - 402', 'closed', 'won', (public.month_start(current_date) - interval '2 months')::date, 610000::numeric, 0::numeric, 'Organico', 'Venda historica para os graficos.', now() - interval '60 days', now() - interval '60 days', null::text, '10000000-0000-0000-0000-000000000006'::uuid, now() - interval '70 days')
) as d(
  id, code, lead_id, developer_id, project_id, unit, stage_code, outcome,
  month_base, vgv_gross, discount_pct, lead_origin, notes, stage_entered_at,
  closed_at, lost_reason, created_by, created_at
)
join public.pipeline_stages s on s.code = d.stage_code
where not exists (
  select 1 from public.deals existing
  where existing.id = d.id or existing.code = d.code
)
on conflict (id) do nothing;

update public.leads l
set converted_deal_id = d.id
from public.deals d
where d.lead_id = l.id
  and l.id between '40000000-0000-0000-0000-000000000005'::uuid
               and '40000000-0000-0000-0000-000000000010'::uuid
  and l.converted_deal_id is null;

insert into public.deal_clients (
  id, deal_id, ordinal, full_name, cpf, phone, email, marital_status,
  postal_code, has_informal_income, activity_segment, declares_income_tax,
  monthly_income, income_notes
)
values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, 'Mariana Lopes', '52998224725', '5511981010005', 'mariana.lopes@example.com', 'casada', '01310100', false, 'Tecnologia', true, 12500, 'Renda CLT comprovada.'),
  ('51000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 2, 'Renato Lopes', '29470137006', '5511981010105', 'renato.lopes@example.com', 'casado', '01310100', true, 'Comercio', true, 7800, 'Composicao de renda.'),
  ('51000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 1, 'Eduardo Nascimento', '15350946056', '5511981010006', 'eduardo.nascimento@example.com', 'solteiro', '13010000', false, 'Industria', true, 9200, 'FGTS disponivel.'),
  ('51000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 1, 'Larissa Gomes', '65074259001', '5511981010007', 'larissa.gomes@example.com', 'solteira', '80010000', true, 'Servicos', false, 6800, 'Parte da renda e informal.'),
  ('51000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', 1, 'Henrique Araujo', null, '5511981010008', 'henrique.araujo@example.com', null, null, false, null, false, 5900, null),
  ('51000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000005', 1, 'Beatriz Castro', '53754788006', '5511981010009', 'beatriz.castro@example.com', 'casada', '90010000', false, 'Saude', true, 11000, null),
  ('51000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000006', 1, 'Lucas Moreira', '71293718061', '5511981010010', 'lucas.moreira@example.com', 'solteiro', '13015000', false, 'Financeiro', true, 14500, null)
on conflict (id) do nothing;

insert into public.deal_participants (id, deal_id, profile_id, role)
values
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'broker'),
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'broker'),
  ('52000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009', 'broker'),
  ('52000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000010', 'broker'),
  ('52000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000010', 'broker'),
  ('52000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000008', 'broker'),
  ('52000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'broker')
on conflict (deal_id, profile_id, role) do nothing;

insert into public.deal_documents (
  id, deal_id, document_type_id, storage_path, original_name, stored_name,
  mime_type, size_bytes, version, uploaded_by
)
select
  x.id, x.deal_id, dt.id, x.storage_path, x.original_name, x.stored_name,
  'application/pdf', x.size_bytes, 1, x.uploaded_by
from (
  values
    ('53000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000001'::uuid, 'rg_cpf', 'seed/deals/001/rg-cpf-mariana.pdf', 'documentos-mariana.pdf', 'rg-cpf-mariana.pdf', 205000::bigint, '10000000-0000-0000-0000-000000000005'::uuid),
    ('53000000-0000-0000-0000-000000000002'::uuid, '50000000-0000-0000-0000-000000000001'::uuid, 'comprovante_renda', 'seed/deals/001/renda-mariana.pdf', 'holerites-mariana.pdf', 'comprovante-renda-mariana.pdf', 310000::bigint, '10000000-0000-0000-0000-000000000005'::uuid),
    ('53000000-0000-0000-0000-000000000003'::uuid, '50000000-0000-0000-0000-000000000002'::uuid, 'rg_cpf', 'seed/deals/002/rg-cpf-eduardo.pdf', 'documento-eduardo.pdf', 'rg-cpf-eduardo.pdf', 198000::bigint, '10000000-0000-0000-0000-000000000007'::uuid),
    ('53000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000002'::uuid, 'comprovante_renda', 'seed/deals/002/renda-eduardo.pdf', 'holerite-eduardo.pdf', 'comprovante-renda-eduardo.pdf', 240000::bigint, '10000000-0000-0000-0000-000000000007'::uuid),
    ('53000000-0000-0000-0000-000000000005'::uuid, '50000000-0000-0000-0000-000000000005'::uuid, 'rg_cpf', 'seed/deals/005/rg-cpf-beatriz.pdf', 'documento-beatriz.pdf', 'rg-cpf-beatriz.pdf', 220000::bigint, '10000000-0000-0000-0000-000000000008'::uuid)
) as x(id, deal_id, document_code, storage_path, original_name, stored_name, size_bytes, uploaded_by)
join public.document_types dt on dt.code = x.document_code
on conflict (storage_path) do nothing;

insert into public.deal_history (id, deal_id, actor_id, kind, from_value, to_value, detail, created_at)
values
  ('54000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'created', null, 'lead', '{"seed":true}', now() - interval '15 days'),
  ('54000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'stage_changed', 'contract', 'closed', '{"seed":true}', now() - interval '2 days'),
  ('54000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'submitted_to_cca', 'proposal', 'under_analysis', '{"seed":true}', now() - interval '4 days'),
  ('54000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009', 'value_changed', '385000', '386100', '{"discount_pct":1,"seed":true}', now() - interval '2 days'),
  ('54000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000010', 'stage_changed', 'proposal', 'lost', '{"reason":"concorrencia","seed":true}', now() - interval '35 days')
on conflict (id) do nothing;

insert into public.visits (
  id, deal_id, lead_id, broker_id, scheduled_at, performed_at, result, notes
)
values
  ('55000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', now() + interval '1 day', null, 'scheduled', 'Visita ao apartamento decorado.'),
  ('55000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', null, '10000000-0000-0000-0000-000000000005', now() - interval '12 days', now() - interval '12 days', 'completed', 'Cliente aprovou a planta e a localizacao.'),
  ('55000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', null, '10000000-0000-0000-0000-000000000009', now() - interval '3 days', null, 'no_show', 'Cliente solicitou reagendamento.')
on conflict (id) do nothing;

insert into public.cca_cases (
  id, deal_id, status, analyst_id, agency_name, submitted_at, decided_at,
  decision_notes, pending_items, stage_id
)
select
  c.id, c.deal_id, c.status::cca_status, c.analyst_id, c.agency_name,
  c.submitted_at, c.decided_at, c.decision_notes, c.pending_items, cs.id
from (
  values
    ('56000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000001'::uuid, 'approved', '10000000-0000-0000-0000-000000000011'::uuid, 'Agencia Centro', now() - interval '10 days', now() - interval '6 days', 'Credito aprovado dentro das condicoes propostas.', '[]'::jsonb, 'approved'),
    ('56000000-0000-0000-0000-000000000002'::uuid, '50000000-0000-0000-0000-000000000002'::uuid, 'pending_documents', '10000000-0000-0000-0000-000000000011'::uuid, 'Agencia Paulista', now() - interval '4 days', null::timestamptz, null::text, '[{"item":"Extrato FGTS atualizado","owner":"broker"},{"item":"Comprovante de residencia","owner":"client"}]'::jsonb, 'pending_documents'),
    ('56000000-0000-0000-0000-000000000003'::uuid, '50000000-0000-0000-0000-000000000005'::uuid, 'sent_to_developer', '10000000-0000-0000-0000-000000000011'::uuid, null::text, now() - interval '2 days', null::timestamptz, null::text, '[]'::jsonb, 'sent_to_developer')
) as c(id, deal_id, status, analyst_id, agency_name, submitted_at, decided_at, decision_notes, pending_items, stage_status)
left join public.cca_stages cs on cs.status = c.stage_status::cca_status
on conflict (deal_id) do nothing;

insert into public.cca_case_events (id, case_id, actor_id, kind, from_value, to_value, detail, created_at)
values
  ('57000000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'status_changed', 'under_review', 'approved', '{"seed":true}', now() - interval '6 days'),
  ('57000000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000011', 'pending_item_added', 'under_review', 'pending_documents', '{"item":"Extrato FGTS atualizado","seed":true}', now() - interval '1 day'),
  ('57000000-0000-0000-0000-000000000003', '56000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000011', 'submitted_external', 'under_review', 'sent_to_developer', '{"seed":true}', now() - interval '2 days')
on conflict (id) do nothing;

insert into public.developer_submissions (
  id, deal_id, developer_id, to_email, cc_emails, subject, body,
  document_ids, status, attempts, sent_at, requested_by
)
values (
  '58000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000005',
  '30000000-0000-0000-0000-000000000002',
  'credito@vivalar.example.invalid',
  array['gestao@faceimob.example.invalid'],
  'Documentacao - SEED-NEG-005 - Beatriz Castro',
  'Envio demonstrativo criado pelo seed.',
  array['53000000-0000-0000-0000-000000000005'::uuid],
  'sent',
  1,
  now() - interval '2 days',
  '10000000-0000-0000-0000-000000000011'
)
on conflict (id) do nothing;

insert into public.sdr_conversations (
  id, lead_id, agent_id, status, score, summary, collected,
  started_at, last_message_at, qualified_at, handed_off_at, handed_off_to
)
select
  c.id, c.lead_id,
  coalesce(
    (select id from public.sdr_agents where id = '36000000-0000-0000-0000-000000000001'),
    (select id from public.sdr_agents where active order by is_orchestrator desc, created_at limit 1)
  ),
  c.status, c.score, c.summary, c.collected, c.started_at, c.last_message_at,
  c.qualified_at, c.handed_off_at, c.handed_off_to
from (
  values
    ('59000000-0000-0000-0000-000000000001'::uuid, '40000000-0000-0000-0000-000000000003'::uuid, 'handed_off', 86, 'Busca apartamento de dois dormitorios em Sao Paulo.', '{"city":"Sao Paulo","income":9800,"timeline":"3 meses","fgts":true}'::jsonb, now() - interval '1 day 2 hours', now() - interval '1 day', now() - interval '1 day 10 minutes', now() - interval '1 day', '10000000-0000-0000-0000-000000000005'::uuid),
    ('59000000-0000-0000-0000-000000000002'::uuid, '40000000-0000-0000-0000-000000000001'::uuid, 'active', 42, 'Primeiro contato em andamento.', '{"city":"Sao Paulo","bedrooms":2}'::jsonb, now() - interval '20 minutes', now() - interval '10 minutes', null::timestamptz, null::timestamptz, null::uuid),
    ('59000000-0000-0000-0000-000000000003'::uuid, '40000000-0000-0000-0000-000000000011'::uuid, 'abandoned', 18, 'Contato sem resposta.', '{"attempts":3}'::jsonb, now() - interval '8 days', now() - interval '5 days', null::timestamptz, null::timestamptz, null::uuid)
) as c(id, lead_id, status, score, summary, collected, started_at, last_message_at, qualified_at, handed_off_at, handed_off_to)
on conflict (id) do nothing;

insert into public.sdr_messages (
  id, conversation_id, author, body, provider_message_id, template_id,
  tokens_in, tokens_out, created_at
)
values
  ('5a000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', 'agent', 'Ola, Camila! Voce procura imovel em qual cidade?', 'seed-msg-001', '35000000-0000-0000-0000-000000000001', 42, 18, now() - interval '1 day 2 hours'),
  ('5a000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', 'lead', 'Em Sao Paulo, dois quartos. Tenho FGTS e quero comprar em ate tres meses.', 'seed-msg-002', null, null, null, now() - interval '1 day 1 hour'),
  ('5a000000-0000-0000-0000-000000000003', '59000000-0000-0000-0000-000000000001', 'agent', 'Perfeito. Vou encaminhar voce para a Ana, que conhece as melhores opcoes para esse perfil.', 'seed-msg-003', null, 66, 25, now() - interval '1 day'),
  ('5a000000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000002', 'agent', 'Ola, Juliana! Recebemos seu interesse no Parque das Flores.', 'seed-msg-004', '35000000-0000-0000-0000-000000000001', 35, 16, now() - interval '18 minutes'),
  ('5a000000-0000-0000-0000-000000000005', '59000000-0000-0000-0000-000000000002', 'lead', 'Gostaria de saber os valores das unidades de dois quartos.', 'seed-msg-005', null, null, null, now() - interval '10 minutes')
on conflict (id) do nothing;

insert into public.remarketing_lists (
  id, name, description, template_id, agent_id, handoff_group_id,
  status, scheduled_for, throttle_per_minute, created_by
)
select
  '5b000000-0000-0000-0000-000000000001',
  'Retomada - leads sem resposta',
  'Lista demonstrativa de contatos perdidos ou inativos.',
  (select id from public.whatsapp_templates where name = 'retomada_interesse'),
  (select id from public.sdr_agents where active order by is_orchestrator desc, created_at limit 1),
  (select id from public.distribution_groups where slug = 'fila-geral'),
  'draft',
  now() + interval '2 days',
  20,
  '10000000-0000-0000-0000-000000000013'
where not exists (
  select 1 from public.remarketing_lists where id = '5b000000-0000-0000-0000-000000000001'
);

insert into public.remarketing_contacts (
  id, list_id, full_name, phone, email, lead_id, status, sent_at,
  replied_at, last_error, extra
)
values
  ('5c000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 'Isabela Moraes', '5511981010011', 'isabela.moraes@example.com', '40000000-0000-0000-0000-000000000011', 'pending', null, null, null, '{"segment":"no_response","seed":true}'),
  ('5c000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000001', 'Guilherme Pires', '5511981010012', 'guilherme.pires@example.com', '40000000-0000-0000-0000-000000000012', 'failed', now() - interval '1 day', null, 'Telefone invalido', '{"segment":"invalid_phone","seed":true}')
on conflict (list_id, phone) do nothing;
