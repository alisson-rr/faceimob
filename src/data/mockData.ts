import type { Broker, Manager, Lead, PipelineDeal, GamificationEntry, Campaign } from '@/types/crm';

export const mockBrokers: Broker[] = [
  { id: '1', name: 'Carlos Silva', active: true, monthly_sales: 5, monthly_vgv: 2500000, team: 'Alpha' },
  { id: '2', name: 'Ana Martins', active: true, monthly_sales: 8, monthly_vgv: 4200000, team: 'Alpha' },
  { id: '3', name: 'Roberto Souza', active: true, monthly_sales: 3, monthly_vgv: 1800000, team: 'Beta' },
  { id: '4', name: 'Juliana Costa', active: false, monthly_sales: 0, monthly_vgv: 0, team: 'Beta' },
  { id: '5', name: 'Fernando Lima', active: true, monthly_sales: 6, monthly_vgv: 3100000, team: 'Gamma' },
];

export const mockManagers: Manager[] = [
  { id: '1', name: 'Marcos Oliveira', team: 'Alpha', active: true },
  { id: '2', name: 'Patricia Rocha', team: 'Beta', active: true },
  { id: '3', name: 'Ricardo Santos', team: 'Gamma', active: true },
];

export const mockLeads: Lead[] = [
  { id: '1', name: 'João Pereira', phone: '(11) 99999-0001', whatsapp: '5511999990001', email: 'joao@email.com', source: 'Facebook Ads', broker_id: '1', broker_name: 'Carlos Silva', created_at: '2026-03-01', status: 'new', notes: 'Interessado em 2 quartos' },
  { id: '2', name: 'Maria Santos', phone: '(11) 99999-0002', whatsapp: '5511999990002', email: 'maria@email.com', source: 'Google Ads', broker_id: '2', broker_name: 'Ana Martins', created_at: '2026-03-02', status: 'contacted', notes: 'Busca apartamento na zona sul' },
  { id: '3', name: 'Pedro Alves', phone: '(11) 99999-0003', whatsapp: '5511999990003', email: 'pedro@email.com', source: 'Indicação', broker_id: '1', broker_name: 'Carlos Silva', created_at: '2026-03-03', status: 'qualified', notes: 'Pronto para visita' },
  { id: '4', name: 'Lucia Fernandes', phone: '(11) 99999-0004', whatsapp: '5511999990004', email: 'lucia@email.com', source: 'Portal Imóveis', broker_id: '3', broker_name: 'Roberto Souza', created_at: '2026-02-28', status: 'converted', notes: 'Convertido para deal' },
  { id: '5', name: 'André Gomes', phone: '(11) 99999-0005', whatsapp: '5511999990005', email: 'andre@email.com', source: 'Instagram', broker_id: '5', broker_name: 'Fernando Lima', created_at: '2026-03-04', status: 'new', notes: '' },
];

export const mockDeals: PipelineDeal[] = [
  { id: '1', client: 'João Pereira', developer: 'Cyrela', project: 'Residencial Aurora', unit: '12A', status: 'Ativo', stage: 'proposal', broker1: 'Carlos Silva', broker2: 'Ana Martins', manager1: 'Marcos Oliveira', deal_value: 650000, days_in_pipeline: 12, active: true, created_at: '2026-02-21', notes: 'Cliente interessado em financiamento' },
  { id: '2', client: 'Maria Santos', developer: 'MRV', project: 'Parque das Flores', unit: '305', status: 'Ativo', stage: 'visit_scheduled', visit_date: '2026-03-10', visit_result: 'pending', broker1: 'Ana Martins', manager1: 'Marcos Oliveira', deal_value: 420000, days_in_pipeline: 8, active: true, created_at: '2026-02-25', notes: 'Visita agendada para sábado' },
  { id: '3', client: 'Lucia Fernandes', developer: 'Tenda', project: 'Vila Verde', unit: '201', status: 'Ativo', stage: 'approved', broker1: 'Roberto Souza', manager1: 'Patricia Rocha', deal_value: 310000, days_in_pipeline: 25, active: true, created_at: '2026-02-08' },
  { id: '4', client: 'Ricardo Mendes', developer: 'Eztec', project: 'Sky Tower', unit: '1801', status: 'Ativo', stage: 'contract', broker1: 'Fernando Lima', broker2: 'Carlos Silva', manager1: 'Ricardo Santos', deal_value: 1200000, days_in_pipeline: 45, active: true, created_at: '2026-01-19', notes: 'Aguardando documentação do banco' },
  { id: '5', client: 'Camila Ribeiro', developer: 'Cyrela', project: 'Residencial Aurora', unit: '8B', status: 'Ativo', stage: 'lead', broker1: 'Ana Martins', manager1: 'Marcos Oliveira', deal_value: 580000, days_in_pipeline: 3, active: true, created_at: '2026-03-02' },
  { id: '6', client: 'Bruno Almeida', developer: 'MRV', project: 'Parque das Flores', unit: '108', status: 'Inativo', stage: 'closed', broker1: 'Carlos Silva', manager1: 'Marcos Oliveira', deal_value: 390000, days_in_pipeline: 60, active: false, created_at: '2026-01-04' },
  { id: '7', client: 'Fernanda Dias', developer: 'Direcional', project: 'Jardim das Palmeiras', unit: '502', status: 'Ativo', stage: 'proposal', broker1: 'Fernando Lima', manager1: 'Ricardo Santos', manager2: 'Patricia Rocha', deal_value: 475000, days_in_pipeline: 6, active: true, created_at: '2026-02-27', notes: 'Proposta enviada via email' },
  { id: '8', client: 'Gabriel Torres', developer: 'Even', project: 'Sky Tower', unit: '1205', status: 'Ativo', stage: 'visit_scheduled', visit_date: '2026-03-08', visit_result: 'completed', broker1: 'Carlos Silva', broker2: 'Roberto Souza', manager1: 'Marcos Oliveira', deal_value: 890000, days_in_pipeline: 15, active: true, created_at: '2026-02-18' },
  { id: '9', client: 'Isabela Nunes', developer: 'Cyrela', project: 'Residencial Aurora', unit: '3C', status: 'Ativo', stage: 'lead', broker1: 'Roberto Souza', manager1: 'Patricia Rocha', deal_value: 520000, days_in_pipeline: 1, active: true, created_at: '2026-03-04' },
  { id: '10', client: 'Thiago Barbosa', developer: 'MRV', project: 'Vila Verde', unit: '404', status: 'Ativo', stage: 'approved', broker1: 'Ana Martins', manager1: 'Marcos Oliveira', deal_value: 285000, days_in_pipeline: 30, active: true, created_at: '2026-02-03', notes: 'Aprovação de crédito confirmada' },
  { id: '11', client: 'Larissa Moreira', developer: 'Tenda', project: 'Parque das Flores', unit: '607', status: 'Ativo', stage: 'proposal', broker1: 'Fernando Lima', manager1: 'Ricardo Santos', deal_value: 340000, days_in_pipeline: 9, active: true, created_at: '2026-02-24' },
  { id: '12', client: 'Diego Cardoso', developer: 'Eztec', project: 'Sky Tower', unit: '2002', status: 'Ativo', stage: 'contract', broker1: 'Carlos Silva', manager1: 'Marcos Oliveira', manager2: 'Patricia Rocha', deal_value: 1450000, days_in_pipeline: 52, active: true, created_at: '2026-01-12', notes: 'Contrato em revisão jurídica' },
];

export const mockGamification: GamificationEntry[] = [
  { id: '1', user_id: '2', user_name: 'Ana Martins', calls: 45, leads_collected: 22, leads_sent: 18, deals_closed: 8, points: 930, month: '2026-03' },
  { id: '2', user_id: '5', user_name: 'Fernando Lima', calls: 38, leads_collected: 15, leads_sent: 12, deals_closed: 6, points: 710, month: '2026-03' },
  { id: '3', user_id: '1', user_name: 'Carlos Silva', calls: 32, leads_collected: 18, leads_sent: 14, deals_closed: 5, points: 640, month: '2026-03' },
  { id: '4', user_id: '3', user_name: 'Roberto Souza', calls: 20, leads_collected: 10, leads_sent: 8, deals_closed: 3, points: 380, month: '2026-03' },
];

export const mockCampaigns: Campaign[] = [
  { id: '1', name: 'Lançamento Aurora', source: 'Facebook Ads', leads_generated: 120, deals_converted: 15 },
  { id: '2', name: 'Parque das Flores Q1', source: 'Google Ads', leads_generated: 85, deals_converted: 10 },
  { id: '3', name: 'Sky Tower Premium', source: 'Instagram', leads_generated: 45, deals_converted: 8 },
  { id: '4', name: 'Vila Verde MCMV', source: 'Portal Imóveis', leads_generated: 200, deals_converted: 22 },
];

export const mockDevelopers = ['Cyrela', 'MRV', 'Tenda', 'Eztec', 'Direcional', 'Even'];
export const mockProjects = ['Residencial Aurora', 'Parque das Flores', 'Vila Verde', 'Sky Tower', 'Jardim das Palmeiras'];
export const mockSources = ['Facebook Ads', 'Google Ads', 'Instagram', 'Portal Imóveis', 'Indicação', 'WhatsApp', 'Site'];
export const mockTeams = ['Alpha', 'Beta', 'Gamma'];
