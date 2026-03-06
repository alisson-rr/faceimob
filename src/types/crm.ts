export type UserRole = 'admin' | 'manager' | 'broker';

export type DealStage = 'incomplete' | 'lead' | 'proposal' | 'visit_scheduled' | 'under_analysis' | 'approved' | 'contract' | 'closed';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

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

export interface PipelineDeal {
  id: string;
  client: string;
  developer: string;
  project: string;
  unit: string;
  status: string;
  stage: DealStage;
  visit_date?: string;
  visit_result?: 'pending' | 'completed' | 'cancelled';
  broker1: string;
  broker2?: string;
  manager1: string;
  manager2?: string;
  deal_value: number;
  days_in_pipeline: number;
  active: boolean;
  created_at: string;
  notes?: string;
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
