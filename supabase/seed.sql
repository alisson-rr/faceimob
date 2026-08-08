-- =============================================================================
-- Seed — dados de configuração sem os quais o sistema não opera.
--
-- Não contém dado de negócio (corretor, lead, negócio): apenas o catálogo que
-- o produto pressupõe existir. Idempotente, pode rodar de novo sem duplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Estágios do pipeline
-- -----------------------------------------------------------------------------
insert into public.pipeline_stages (code, label, position, outcome, color, requires_document, is_initial)
values
  ('incomplete',      'Incompleto',      1, 'open',   '#94a3b8', false, true),
  ('lead',            'Lead',            2, 'open',   '#38bdf8', false, false),
  ('proposal',        'Proposta',        3, 'open',   '#818cf8', false, false),
  ('visit_scheduled', 'Visita Agendada', 4, 'open',   '#e879f9', false, false),
  ('under_analysis',  'Em Análise',      5, 'open',   '#fbbf24', true,  false),
  ('approved',        'Aprovado',        6, 'open',   '#34d399', true,  false),
  ('contract',        'Contrato',        7, 'open',   '#22d3ee', true,  false),
  ('closed',          'Fechado',         8, 'won',    '#facc15', true,  false),
  ('lost',            'Perdido',         9, 'lost',   '#f87171', false, false)
on conflict do nothing;

-- Quem pode mover para cada estágio. Corretor toca o funil comercial; a partir
-- da análise, o CCA assume.
insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, r.role, true, true
from public.pipeline_stages s
cross join (values ('admin'::app_role), ('director'), ('manager')) as r(role)
on conflict do nothing;

insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, 'broker'::app_role, true, true
from public.pipeline_stages s
where s.code in ('incomplete','lead','proposal','visit_scheduled','under_analysis','lost')
on conflict do nothing;

insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, 'cca'::app_role, true, true
from public.pipeline_stages s
where s.code in ('under_analysis','approved','contract','closed','lost')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de documento — os "campos específicos para cada tipo de documento".
-- required_for_conversion marca o que o CCA exige para aceitar a esteira.
-- -----------------------------------------------------------------------------
insert into public.document_types
  (code, label, category, required_for_conversion, allows_multiple, naming_pattern, sort_order)
values
  ('rg_cpf',            'RG / CPF',                  'identificacao', true,  false, '{tipo}-{cliente}', 1),
  ('comprovante_renda', 'Comprovante de Renda',      'renda',         true,  true,  '{tipo}-{cliente}-{data}', 2),
  ('ctps',              'CTPS',                      'renda',         false, false, '{tipo}-{cliente}', 3),
  ('extrato_fgts',      'Extrato FGTS',              'renda',         false, false, '{tipo}-{cliente}-{data}', 4),
  ('imposto_renda',     'Declaração de IR',          'renda',         false, false, '{tipo}-{cliente}-{data}', 5),
  ('comprovante_resid', 'Comprovante de Residência', 'endereco',      true,  false, '{tipo}-{cliente}', 6),
  ('certidao_civil',    'Certidão de Estado Civil',  'identificacao', false, false, '{tipo}-{cliente}', 7),
  ('simulacao',         'Simulação de Crédito',      'credito',       false, true,  '{tipo}-{negocio}', 8),
  ('outros',            'Outros',                    'geral',         false, true,  '{tipo}-{cliente}-{data}', 99)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Estágios do CCA (configuráveis pela tela do CCA, como os do pipeline)
-- -----------------------------------------------------------------------------
insert into public.cca_stages (name, color, position, status)
select v.name, v.color, v.position, v.status::cca_status
from (
  values
    ('Pendência de Documentos', '#f87171', 1, 'pending_documents'),
    ('Em Análise',              '#fbbf24', 2, 'under_review'),
    ('Enviado à Construtora',   '#818cf8', 3, 'sent_to_developer'),
    ('Enviado à Agência',       '#22d3ee', 4, 'sent_to_agency'),
    ('Aprovado',                '#34d399', 5, 'approved'),
    ('Reprovado',               '#f43f5e', 6, 'rejected')
) as v(name, color, position, status)
where not exists (
  select 1 from public.cca_stages cs where cs.status = v.status::cca_status
);

-- -----------------------------------------------------------------------------
-- Turnos — "três turnos diários, com janelas de atendimento configuráveis".
-- Janelas sem sobreposição para que current_shift() seja determinística.
-- -----------------------------------------------------------------------------
insert into public.work_shifts (code, label, checkin_start, distribution_start, checkout_time, position)
values
  ('manha', 'Manhã', '08:00', '08:30', '12:00', 1),
  ('tarde', 'Tarde', '13:00', '13:30', '18:00', 2),
  ('noite', 'Noite', '18:30', '19:00', '21:30', 3)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Grupos de distribuição — a fila geral precisa existir: é o destino padrão
-- de todo lead sem formulário mapeado.
-- -----------------------------------------------------------------------------
insert into public.distribution_groups (name, slug, kind, attend_timeout_seconds)
values
  ('Fila Geral',    'fila-geral',    'general', 300),
  ('Triagem SDR IA','triagem-sdr-ia','sdr',     null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Origens de lead
-- -----------------------------------------------------------------------------
insert into public.lead_sources (code, label, channel)
values
  ('meta_ads',   'Meta Ads',    'meta'),
  ('whatsapp',   'WhatsApp',    'whatsapp'),
  ('organico',   'Orgânico',    'organic'),
  ('indicacao',  'Indicação',   'indication'),
  ('importacao', 'Importação',  'import'),
  ('portal',     'Portal',      'portal')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Metas de funil — 10% / 40% / 50%, conforme definido em reunião.
-- -----------------------------------------------------------------------------
insert into public.funnel_targets
  (scope, lead_to_analysis_pct, analysis_to_approval_pct, approval_to_sale_pct)
select 'global', 10, 40, 50
where not exists (select 1 from public.funnel_targets where scope = 'global');

-- -----------------------------------------------------------------------------
-- Jogo: temporada aberta + regras de pontuação padrão.
-- Os valores espelham a configuração que o time já usa hoje; são editáveis na
-- tela de gamificação sem migration.
-- -----------------------------------------------------------------------------
insert into public.game_seasons (label, period_start)
select to_char(current_date, 'TMMonth YYYY'), public.month_start(current_date)
where not exists (select 1 from public.game_seasons where closed_at is null);

insert into public.game_scoring_rules (season_id, event_code, label, points)
values
  (null, 'incompleto_com_doc', 'Incompleto com documento',  10),
  (null, 'esteira',            'Envio para esteira ágil',  140),
  (null, 'aprovado',           'Análise aprovada',         250),
  (null, 'venda',              'Venda',                    600),
  (null, 'distrato',           'Distrato',                -600)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Catálogo de permissões e concessões padrão por papel.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, label, category, description) values
  ('leads.view_queue',      'Ver fila de leads',           'leads',    'Enxergar leads ainda não atribuídos'),
  ('leads.reassign',        'Realocar leads',              'leads',    'Mover lead entre corretores'),
  ('leads.delete',          'Excluir leads',               'leads',    null),
  ('deals.view_all',        'Ver todos os negócios',       'negocios', 'Ignorar o recorte por equipe'),
  ('deals.edit_value',      'Editar VGV',                  'negocios', null),
  ('deals.delete',          'Excluir negócios',            'negocios', null),
  ('cca.review',            'Analisar crédito',            'cca',      'Movimentar a esteira do CCA'),
  ('reports.view_finance',  'Ver dados financeiros',       'relatorios', 'Aportes, custos e VGV consolidado'),
  ('teams.manage',          'Gerenciar equipes',           'equipes',  'Incluir e desligar integrantes'),
  ('users.manage_roles',    'Gerenciar papéis',            'usuarios', null),
  ('settings.integrations', 'Gerenciar integrações',       'config',   'Tokens de API'),
  ('game.close_season',     'Encerrar temporada',          'jogo',     null)
on conflict do nothing;

insert into public.role_permissions (role, permission, allowed) values
  ('director', 'leads.view_queue',     true),
  ('director', 'leads.reassign',       true),
  ('director', 'deals.view_all',       true),
  ('director', 'deals.edit_value',     true),
  ('director', 'reports.view_finance', true),
  ('director', 'teams.manage',         true),

  ('manager',  'leads.view_queue',     true),
  ('manager',  'leads.reassign',       true),
  ('manager',  'deals.edit_value',     true),
  ('manager',  'teams.manage',         true),

  ('cca',      'cca.review',           true),
  ('cca',      'deals.view_all',       true),

  ('marketing','reports.view_finance', true),

  ('partner',  'deals.view_all',       true),
  ('partner',  'reports.view_finance', true)
on conflict do nothing;
