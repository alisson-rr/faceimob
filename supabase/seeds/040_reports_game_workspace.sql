-- =============================================================================
-- Fase 4 - Daily, metas, gamificacao, marketing e area de trabalho
-- =============================================================================

insert into public.daily_reports (
  id, team_id, report_date, submitted_by, submitted_at, notes
)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', current_date,     '10000000-0000-0000-0000-000000000003', now() - interval '30 minutes', 'Equipe focada nos retornos de propostas abertas.'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', current_date,     '10000000-0000-0000-0000-000000000004', now() - interval '20 minutes', 'Prioridade do dia: visitas e documentacao.'),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', current_date - 1, '10000000-0000-0000-0000-000000000003', now() - interval '1 day', 'Bom volume de contatos e uma venda concluida.'),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', current_date - 1, '10000000-0000-0000-0000-000000000004', now() - interval '1 day', 'Duas visitas realizadas.')
on conflict do nothing;

insert into public.daily_entries (
  id, report_id, profile_id, leads, calls, doc_collections, visits_scheduled,
  visits_done, analyses_sent, analyses_approved, sales
)
values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 4, 18, 2, 1, 1, 1, 1, 1),
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 3, 14, 1, 2, 0, 0, 0, 0),
  ('61000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 5, 22, 3, 1, 1, 1, 0, 0),
  ('61000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000008', 5, 20, 2, 2, 1, 1, 0, 0),
  ('61000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000009', 3, 15, 1, 1, 1, 0, 0, 0),
  ('61000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000010', 2, 11, 1, 0, 0, 0, 0, 0),
  ('61000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', 6, 24, 2, 1, 1, 1, 1, 1),
  ('61000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 4, 17, 2, 1, 1, 0, 0, 0),
  ('61000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000008', 5, 21, 3, 2, 2, 1, 0, 0),
  ('61000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000009', 4, 16, 1, 1, 0, 0, 0, 0)
on conflict do nothing;

insert into public.funnel_targets (
  id, scope, team_id, director_id, lead_to_analysis_pct,
  analysis_to_approval_pct, approval_to_sale_pct, effective_from
)
values
  ('62000000-0000-0000-0000-000000000001', 'team', '20000000-0000-0000-0000-000000000001', null, 12, 45, 55, public.month_start(current_date)),
  ('62000000-0000-0000-0000-000000000002', 'team', '20000000-0000-0000-0000-000000000002', null, 11, 42, 52, public.month_start(current_date)),
  ('62000000-0000-0000-0000-000000000003', 'director', null, '10000000-0000-0000-0000-000000000002', 11.5, 43, 53, public.month_start(current_date))
on conflict do nothing;

insert into public.public_links (
  id, kind, team_id, director_id, slug, pin_hash, active, expires_at,
  last_seen_at, created_by
)
values
  ('63000000-0000-0000-0000-000000000001', 'daily_team', '20000000-0000-0000-0000-000000000001', null,
   'seed-daily-paulista', extensions.crypt('123456', extensions.gen_salt('bf')), true,
   now() + interval '90 days', now() - interval '1 day', '10000000-0000-0000-0000-000000000003'),
  ('63000000-0000-0000-0000-000000000002', 'daily_team', '20000000-0000-0000-0000-000000000002', null,
   'seed-daily-sul', extensions.crypt('123456', extensions.gen_salt('bf')), true,
   now() + interval '90 days', null, '10000000-0000-0000-0000-000000000004'),
  ('63000000-0000-0000-0000-000000000003', 'director_checkpoint', null, '10000000-0000-0000-0000-000000000002',
   'seed-diretoria-daniela', null, true, now() + interval '90 days',
   now() - interval '3 hours', '10000000-0000-0000-0000-000000000002')
on conflict (slug) do nothing;

insert into public.closed_months (period, closed_at, closed_by, notes)
values (
  (public.month_start(current_date) - interval '2 months')::date,
  public.month_start(current_date) - interval '1 month',
  '10000000-0000-0000-0000-000000000001',
  'Mes historico fechado pelo seed.'
)
on conflict (period) do nothing;

insert into public.game_seasons (
  id, label, period_start, period_end, closed_at, closed_by
)
values (
  '64000000-0000-0000-0000-000000000001',
  'Temporada historica demonstrativa',
  (public.month_start(current_date) - interval '3 months')::date,
  (public.month_start(current_date) - interval '2 months' - interval '1 day')::date,
  public.month_start(current_date) - interval '2 months',
  '10000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.game_events (
  id, season_id, profile_id, event_code, points, ref_type, ref_id, occurred_at
)
select
  e.id, s.id, e.profile_id, e.event_code, e.points, e.ref_type, e.ref_id, e.occurred_at
from (
  values
    ('65000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'venda', 600, 'deal', '50000000-0000-0000-0000-000000000001'::uuid, now() - interval '2 days'),
    ('65000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'esteira', 140, 'deal', '50000000-0000-0000-0000-000000000002'::uuid, now() - interval '4 days'),
    ('65000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000005'::uuid, 'aprovado', 250, 'cca_case', '56000000-0000-0000-0000-000000000001'::uuid, now() - interval '6 days'),
    ('65000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000009'::uuid, 'incompleto_com_doc', 10, 'deal', '50000000-0000-0000-0000-000000000003'::uuid, now() - interval '7 days'),
    ('65000000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000010'::uuid, 'distrato', -600, 'deal', '50000000-0000-0000-0000-000000000004'::uuid, now() - interval '35 days'),
    ('65000000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'esteira', 140, 'deal', '50000000-0000-0000-0000-000000000005'::uuid, now() - interval '3 days')
) as e(id, profile_id, event_code, points, ref_type, ref_id, occurred_at)
cross join lateral (
  select id from public.game_seasons where closed_at is null order by period_start desc limit 1
) s
on conflict do nothing;

insert into public.game_season_results (
  season_id, profile_id, rank, points, sales, vgv, breakdown, frozen_at
)
values
  ('64000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 1, 990, 2, 1040000, '{"venda":1200,"aprovado":250,"distrato":-600,"esteira":140}', public.month_start(current_date) - interval '2 months'),
  ('64000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 2, 850, 1, 485000, '{"venda":600,"aprovado":250}', public.month_start(current_date) - interval '2 months'),
  ('64000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000008', 3, 530, 1, 528650, '{"venda":600,"incompleto_com_doc":10,"ajuste":-80}', public.month_start(current_date) - interval '2 months')
on conflict (season_id, profile_id) do nothing;

insert into public.marketing_investments (
  id, developer_id, period, amount, notes, created_by
)
values
  ('66000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', public.month_start(current_date), 18500, 'Meta Ads, videos e landing pages.', '10000000-0000-0000-0000-000000000013'),
  ('66000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', public.month_start(current_date), 14200, 'Campanhas de performance para a regiao Sul.', '10000000-0000-0000-0000-000000000013'),
  ('66000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', (public.month_start(current_date) - interval '1 month')::date, 16800, 'Investimento do mes anterior.', '10000000-0000-0000-0000-000000000013'),
  ('66000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', (public.month_start(current_date) - interval '1 month')::date, 13100, 'Investimento do mes anterior.', '10000000-0000-0000-0000-000000000013')
on conflict do nothing;

insert into public.ad_campaigns (
  id, external_id, platform, name, developer_id, status,
  daily_budget, total_spend, synced_at
)
values
  ('67000000-0000-0000-0000-000000000001', 'seed-meta-campaign-001', 'meta', 'Parque das Flores - Conversao', '30000000-0000-0000-0000-000000000001', 'ACTIVE', 420, 8940, now() - interval '15 minutes'),
  ('67000000-0000-0000-0000-000000000002', 'seed-meta-campaign-002', 'meta', 'Viva Centro - Leads', '30000000-0000-0000-0000-000000000002', 'ACTIVE', 350, 7210, now() - interval '15 minutes'),
  ('67000000-0000-0000-0000-000000000003', 'seed-google-campaign-001', 'google', 'Reserva Paulista - Pesquisa', '30000000-0000-0000-0000-000000000001', 'PAUSED', 180, 3680, now() - interval '2 hours')
on conflict (platform, external_id) do nothing;

insert into public.goals (
  id, scope, team_id, profile_id, period_type, period, metric, target, created_by
)
values
  ('68000000-0000-0000-0000-000000000001', 'global', null, null, 'month', public.month_start(current_date), 'sales', 12, '10000000-0000-0000-0000-000000000001'),
  ('68000000-0000-0000-0000-000000000002', 'global', null, null, 'month', public.month_start(current_date), 'vgv', 5500000, '10000000-0000-0000-0000-000000000001'),
  ('68000000-0000-0000-0000-000000000003', 'team', '20000000-0000-0000-0000-000000000001', null, 'month', public.month_start(current_date), 'sales', 7, '10000000-0000-0000-0000-000000000003'),
  ('68000000-0000-0000-0000-000000000004', 'team', '20000000-0000-0000-0000-000000000002', null, 'month', public.month_start(current_date), 'sales', 5, '10000000-0000-0000-0000-000000000004'),
  ('68000000-0000-0000-0000-000000000005', 'profile', null, '10000000-0000-0000-0000-000000000005', 'month', public.month_start(current_date), 'sales', 3, '10000000-0000-0000-0000-000000000003'),
  ('68000000-0000-0000-0000-000000000006', 'profile', null, '10000000-0000-0000-0000-000000000008', 'month', public.month_start(current_date), 'visits', 12, '10000000-0000-0000-0000-000000000004')
on conflict do nothing;

insert into public.tasks (
  id, title, description, assigned_to, created_by, due_at, completed_at,
  status, priority, ref_type, ref_id
)
values
  ('69000000-0000-0000-0000-000000000001', 'Cobrar extrato do FGTS', 'Pedir documento atualizado ao Eduardo.', '10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000011', now() + interval '1 day', null, 'open', 'high', 'cca_case', '56000000-0000-0000-0000-000000000002'),
  ('69000000-0000-0000-0000-000000000002', 'Confirmar visita ao decorado', 'Validar presenca e enviar localizacao.', '10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', now() + interval '8 hours', null, 'open', 'normal', 'lead', '40000000-0000-0000-0000-000000000004'),
  ('69000000-0000-0000-0000-000000000003', 'Revisar proposta comercial', 'Conferir desconto antes do envio final.', '10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000004', now() + interval '2 days', null, 'open', 'normal', 'deal', '50000000-0000-0000-0000-000000000003'),
  ('69000000-0000-0000-0000-000000000004', 'Enviar contrato assinado', 'Documento encaminhado para a incorporadora.', '10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', now() - interval '2 days', now() - interval '1 day', 'done', 'high', 'deal', '50000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.notifications (
  id, profile_id, kind, title, body, link, channel, read_at, sent_at, created_at
)
values
  ('6a000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000008', 'lead_assigned', 'Novo lead atribuido', 'Rafael Souza aguarda atendimento.', '/leads/40000000-0000-0000-0000-000000000002', 'in_app', null, now() - interval '2 minutes', now() - interval '2 minutes'),
  ('6a000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'cca_pending', 'Documento pendente', 'O CCA solicitou um extrato de FGTS atualizado.', '/cca', 'in_app', null, now() - interval '1 day', now() - interval '1 day'),
  ('6a000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', 'deal_won', 'Venda concluida', 'Parabens pela venda SEED-NEG-001!', '/pipeline', 'in_app', now() - interval '1 day', now() - interval '2 days', now() - interval '2 days'),
  ('6a000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'daily_submitted', 'Daily recebida', 'As duas equipes enviaram o fechamento diario.', '/daily', 'email', null, now() - interval '20 minutes', now() - interval '20 minutes')
on conflict (id) do nothing;

insert into public.useful_links (id, label, url, icon, category, sort_order)
values
  ('6b000000-0000-0000-0000-000000000001', 'Central de ajuda do Supabase', 'https://supabase.com/docs', 'book-open', 'ferramentas', 1),
  ('6b000000-0000-0000-0000-000000000002', 'Consulta de CPF - Receita Federal', 'https://servicos.receita.fazenda.gov.br/', 'search', 'consultas', 2),
  ('6b000000-0000-0000-0000-000000000003', 'Portal CAIXA Habitacao', 'https://www.caixa.gov.br/voce/habitacao/', 'home', 'financiamento', 3)
on conflict (id) do nothing;

insert into public.important_notices (
  id, title, body, severity, starts_at, ends_at, active, created_by
)
values
  ('6c000000-0000-0000-0000-000000000001', 'Base demonstrativa carregada', 'Os registros identificados como SEED sao ficticios e podem ser removidos antes do uso real.', 'info', now() - interval '1 day', now() + interval '30 days', true, '10000000-0000-0000-0000-000000000001'),
  ('6c000000-0000-0000-0000-000000000002', 'Documentos pendentes no CCA', 'Revise diariamente os cards com pendencias para nao atrasar a analise de credito.', 'warning', now() - interval '2 days', now() + interval '10 days', true, '10000000-0000-0000-0000-000000000011')
on conflict (id) do nothing;

insert into public.gold_tips (id, title, body, author_id, sort_order)
values
  ('6d000000-0000-0000-0000-000000000001', 'Responda enquanto o interesse esta quente', 'O primeiro contato nos minutos iniciais aumenta a chance de agendamento. Use uma pergunta simples para iniciar a conversa.', '10000000-0000-0000-0000-000000000002', 1),
  ('6d000000-0000-0000-0000-000000000002', 'Registre o proximo passo', 'Todo atendimento deve terminar com data e acao combinadas. Isso torna a carteira previsivel para o corretor e o gestor.', '10000000-0000-0000-0000-000000000003', 2),
  ('6d000000-0000-0000-0000-000000000003', 'Documentacao completa acelera o credito', 'Confira identificacao, renda e residencia antes de mandar o negocio para o CCA.', '10000000-0000-0000-0000-000000000011', 3)
on conflict (id) do nothing;

insert into public.annual_results (
  id, year, month, sales_count, vgv, notes, updated_by
)
values
  ('6e000000-0000-0000-0000-000000000001', extract(year from current_date)::int, extract(month from current_date)::int, 1, 472875, 'Resultado parcial do mes atual.', '10000000-0000-0000-0000-000000000001'),
  ('6e000000-0000-0000-0000-000000000002', extract(year from (current_date - interval '1 month'))::int, extract(month from (current_date - interval '1 month'))::int, 4, 1985000, 'Resultado consolidado do mes anterior.', '10000000-0000-0000-0000-000000000001'),
  ('6e000000-0000-0000-0000-000000000003', extract(year from (current_date - interval '2 months'))::int, extract(month from (current_date - interval '2 months'))::int, 3, 1670000, 'Historico demonstrativo.', '10000000-0000-0000-0000-000000000001')
on conflict (year, month) do nothing;
