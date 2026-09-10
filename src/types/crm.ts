export type UserRole = 'admin' | 'manager' | 'broker';

export type DealStage = 'incomplete' | 'lead' | 'proposal' | 'visit_scheduled' | 'under_analysis' | 'approved' | 'contract' | 'closed';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export type DocumentReviewStatus = 'draft' | 'pending' | 'returned' | 'approved';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  avatar?: string;
}

export interface Broker {
  id: string;
  name: string;
  active: boolean;
  monthly_sales: number;
  monthly_vgv: number;
  team: string;
}

export interface Manager {
  id: string;
  name: string;
  team: string;
  active: boolean;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  source: string;
  broker_id: string;
  broker_name?: string;
  created_at: string;
  status: LeadStatus;
  notes: string;
}

export interface DealHistoryEntry {
  id: string;
  user_name: string;
  text: string;
  timestamp: string; // ISO string
}

export interface PipelineDeal {
  id: string;
  code?: string;
  client: string;
  cpf?: string;
  contato?: string;
  email_client?: string;
  numero_pis?: string;
  estado_civil?: string;
  naturalidade?: string;
  cotista?: string;
  dependente?: string;
  data_admissao?: string;
  referencia_cch?: string;
  cep?: string;
  // 2nd client (compra conjunta)
  has_second_client?: boolean;
  client2?: string;
  cpf2?: string;
  contato2?: string;
  email_client2?: string;
  numero_pis2?: string;
  estado_civil2?: string;
  naturalidade2?: string;
  cotista2?: string;
  dependente2?: string;
  data_admissao2?: string;
  referencia_cch2?: string;
  cep2?: string;
  // Renda informal
  has_informal_income?: boolean;
  segmento_atividade?: string;
  forma_atuacao?: string;
  tempo_atividade?: string;
  forma_divulgacao?: string;
  declara_ir?: string;
  rendimento_mensal?: string;
  observacoes_renda?: string;
  // Core
  developer: string;
  project: string;
  unit: string;
  status: string;
  stage: DealStage;
  lead_origin?: string;
  month_base?: string; // MM/YYYY - data base do negócio
  visit_date?: string;
  visit_result?: 'pending' | 'completed' | 'cancelled';
  // Nome dos participantes — só para exibir. Quem identifica é o `*_id`:
  // homônimo colide no `find` por nome e renomear o perfil trocava o dono do
  // rateio de VGV (achado F06). Escrita SEMPRE pelo id.
  broker1: string;
  broker2?: string;
  broker3?: string;
  manager1: string;
  manager2?: string;
  manager3?: string;
  broker1_id?: string | null;
  broker2_id?: string | null;
  broker3_id?: string | null;
  manager1_id?: string | null;
  manager2_id?: string | null;
  manager3_id?: string | null;
  developer_id?: string | null;
  project_id?: string | null;
  /** Rótulo da etapa vindo de `pipeline_stages.label` — a fonte única (F11). */
  stage_label?: string;
  vgv_bruto?: number;
  perc_desconto?: string;
  vgv_liquido?: number;
  deal_value: number;
  days_in_pipeline: number;
  active: boolean;
  created_at: string;
  notes?: string;
  document_review_status?: DocumentReviewStatus;
  document_review_requested_at?: string;
  document_review_reason?: string;
  history?: DealHistoryEntry[];
}

export interface Visit {
  id: string;
  deal_id: string;
  client: string;
  broker: string;
  date: string;
  result: string;
}

export interface GamificationEntry {
  id: string;
  user_id: string;
  user_name: string;
  calls: number;
  leads_collected: number;
  leads_sent: number;
  deals_closed: number;
  points: number;
  month: string;
}

export interface Campaign {
  id: string;
  name: string;
  source: string;
  leads_generated: number;
  deals_converted: number;
}

/**
 * Espelho de `pipeline_stages` para as telas de ANÁLISE (funil do Dashboard,
 * `aiAnalytics`), que precisam da ordem do funil sem consultar o catálogo.
 *
 * A fonte de verdade das etapas é a tabela `pipeline_stages` no banco: é dela
 * que saem o `label`, a posição e — o que importa de verdade — o `id` que
 * `can_enter_stage()` autoriza. O Pipeline lê o catálogo (`listPipelineStages`)
 * e o `stage_label` que `listLegacyDeals` já traz junto; não usa esta lista.
 * `src/components/pipeline/stages.test.ts` reprova se as duas divergirem.
 *
 * Falta aqui, de propósito, a etapa `lost` ('Perdido'): ela é desfecho, não
 * coluna de funil, e incluí-la mudaria o funil do Dashboard.
 */
export const DEAL_STAGES: { value: DealStage; label: string }[] = [
  { value: 'incomplete', label: 'Incompleto' },
  { value: 'lead', label: 'Lead' },
  { value: 'proposal', label: 'Proposta' },
  { value: 'visit_scheduled', label: 'Visita Agendada' },
  { value: 'under_analysis', label: 'Em Análise' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'contract', label: 'Contrato' },
  { value: 'closed', label: 'Fechado' },
];

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'qualified', label: 'Qualificado' },
  { value: 'converted', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
];
