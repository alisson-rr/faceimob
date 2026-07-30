import { Lead, PipelineDeal, DealStage } from "@/types/crm";
import { mockBrokers } from "@/data/mockData";

// ── Types ────────────────────────────────────────────────────
export interface AutoTask {
  id: string;
  type: "follow_up_call" | "visit_prep" | "proposal_delivery" | "reminder" | "welcome" | "follow_up_message";
  title: string;
  description: string;
  assignedTo: string;
  relatedTo: string;
  priority: "high" | "medium" | "low";
  dueDate: string;
  completed: boolean;
  createdAt: string;
}

export interface AutomationAlert {
  id: string;
  type: "new_lead" | "visit_today" | "deal_approval" | "deal_inactive" | "stage_change" | "follow_up_due";
  title: string;
  message: string;
  severity: "info" | "warning" | "danger";
  timestamp: string;
  read: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  template: string;
  variables: string[];
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string;
}

export interface SourceMetrics {
  source: string;
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgDaysToConvert: number;
}

// ── WhatsApp Templates ───────────────────────────────────────
export const whatsappTemplates: WhatsAppTemplate[] = [
  {
    id: "wt1", name: "Boas-vindas",
    template: "Olá {{client_name}}, aqui é {{broker_name}} da Faceimob! 🏠\nGostaria de ajudá-lo(a) a encontrar as melhores opções de imóveis.\nPosso agendar uma visita para você?",
    variables: ["client_name", "broker_name"],
  },
  {
    id: "wt2", name: "Follow-up",
    template: "Olá {{client_name}}! 👋\nEstou entrando em contato novamente para saber se ainda tem interesse no {{project}}.\nTemos condições especiais esta semana!",
    variables: ["client_name", "project"],
  },
  {
    id: "wt3", name: "Confirmação de Visita",
    template: "Olá {{client_name}}! ✅\nConfirmando sua visita ao {{project}} no dia {{visit_date}}.\n{{broker_name}} estará te esperando.\nEndereço: {{address}}",
    variables: ["client_name", "project", "visit_date", "broker_name", "address"],
  },
  {
    id: "wt4", name: "Lembrete de Visita",
    template: "Lembrete: {{client_name}}, sua visita ao {{project}} é amanhã! 📅\nHorário: {{visit_time}}\nQualquer dúvida, estou à disposição.\n— {{broker_name}}",
    variables: ["client_name", "project", "visit_time", "broker_name"],
  },
];

// ── Email Templates ──────────────────────────────────────────
export const emailTemplates: EmailTemplate[] = [
  {
    id: "et1", name: "Boas-vindas Lead",
    subject: "Bem-vindo(a) à Faceimob! 🏠",
    body: "Olá {{client_name}},\n\nSeja bem-vindo(a) à Faceimob! Nosso corretor {{broker_name}} entrará em contato em breve para apresentar as melhores opções de imóveis para você.\n\nAtenciosamente,\nEquipe Faceimob",
    trigger: "new_lead",
  },
  {
    id: "et2", name: "Confirmação de Visita",
    subject: "Visita Confirmada - {{project}}",
    body: "Olá {{client_name}},\n\nSua visita ao {{project}} está confirmada para {{visit_date}}.\n\nSeu corretor {{broker_name}} estará esperando no local.\n\nAtenciosamente,\nEquipe Faceimob",
    trigger: "visit_scheduled",
  },
  {
    id: "et3", name: "Follow-up Proposta",
    subject: "Sobre sua proposta - {{project}}",
    body: "Olá {{client_name}},\n\nGostaríamos de verificar se tem alguma dúvida sobre a proposta do {{project}}, unidade {{unit}}.\n\nEstamos à disposição para esclarecer qualquer ponto.\n\nAtenciosamente,\n{{broker_name}} — Faceimob",
    trigger: "proposal",
  },
];

// ── Auto-assign broker ───────────────────────────────────────
export function autoAssignBroker(): { id: string; name: string } {
  const activeBrokers = mockBrokers.filter((b) => b.active);
  // Round-robin based on lowest sales (simplistic availability)
  const sorted = [...activeBrokers].sort((a, b) => a.monthly_sales - b.monthly_sales);
  const chosen = sorted[0];
  return { id: chosen.id, name: chosen.name };
}

// ── Generate tasks for lead ──────────────────────────────────
export function generateLeadTasks(lead: Lead): AutoTask[] {
  const tasks: AutoTask[] = [];
  const now = new Date().toISOString();

  tasks.push({
    id: `task-welcome-${lead.id}`,
    type: "welcome",
    title: `Enviar mensagem de boas-vindas para ${lead.name}`,
    description: `Lead novo criado via ${lead.source}. Enviar WhatsApp de boas-vindas.`,
    assignedTo: lead.broker_name || "Não atribuído",
    relatedTo: lead.name,
    priority: "high",
    dueDate: now,
    completed: false,
    createdAt: now,
  });

  tasks.push({
    id: `task-followup-${lead.id}`,
    type: "follow_up_call",
    title: `Ligar para ${lead.name}`,
    description: `Realizar primeira ligação de contato.`,
    assignedTo: lead.broker_name || "Não atribuído",
    relatedTo: lead.name,
    priority: "medium",
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    completed: false,
    createdAt: now,
  });

  return tasks;
}

// ── Follow-up automation rules ───────────────────────────────
export function checkFollowUpRules(lead: Lead): { action: string; severity: "info" | "warning" | "danger" } | null {
  const daysSinceCreated = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24));

  if (lead.status === "converted" || lead.status === "lost") return null;

  if (daysSinceCreated >= 14) {
    return { action: `Marcar ${lead.name} como inativo (${daysSinceCreated} dias sem atividade)`, severity: "danger" };
  }
  if (daysSinceCreated >= 7) {
    return { action: `Enviar follow-up automático para ${lead.name} (${daysSinceCreated} dias)`, severity: "warning" };
  }
  if (daysSinceCreated >= 3) {
    return { action: `Lembrar corretor sobre ${lead.name} (${daysSinceCreated} dias)`, severity: "info" };
  }
  return null;
}

// ── Deal stage automation ────────────────────────────────────
export function getStageActions(stage: DealStage, deal: PipelineDeal): AutoTask[] {
  const tasks: AutoTask[] = [];
  const now = new Date().toISOString();

  switch (stage) {
    case "proposal":
      tasks.push({
        id: `stage-prop-${deal.id}`, type: "proposal_delivery",
        title: `Enviar proposta para ${deal.client}`,
        description: `Proposta do ${deal.project} - Unidade ${deal.unit}`,
        assignedTo: deal.broker1, relatedTo: deal.client,
        priority: "high", dueDate: now, completed: false, createdAt: now,
      });
      break;
    case "visit_scheduled":
      tasks.push({
        id: `stage-visit-${deal.id}`, type: "visit_prep",
        title: `Preparar visita para ${deal.client}`,
        description: `Visita ao ${deal.project} em ${deal.visit_date || "data a definir"}`,
        assignedTo: deal.broker1, relatedTo: deal.client,
        priority: "high", dueDate: deal.visit_date || now, completed: false, createdAt: now,
      });
      break;
    case "approved":
      tasks.push({
        id: `stage-appr-${deal.id}`, type: "follow_up_call",
        title: `Atualizar métricas - Deal ${deal.client} aprovado`,
        description: `Crédito aprovado. Iniciar processo de contrato.`,
        assignedTo: deal.broker1, relatedTo: deal.client,
        priority: "medium", dueDate: now, completed: false, createdAt: now,
      });
      break;
    case "closed":
      tasks.push({
        id: `stage-close-${deal.id}`, type: "follow_up_call",
        title: `Registrar venda - ${deal.client}`,
        description: `Deal fechado: ${deal.project} ${deal.unit} - R$ ${deal.deal_value.toLocaleString("pt-BR")}`,
        assignedTo: deal.broker1, relatedTo: deal.client,
        priority: "low", dueDate: now, completed: true, createdAt: now,
      });
      break;
  }
  return tasks;
}

// ── Generate pipeline alerts ─────────────────────────────────
export function generatePipelineAlerts(leads: Lead[], deals: PipelineDeal[]): AutomationAlert[] {
  const alerts: AutomationAlert[] = [];
  const now = new Date().toISOString();

  // New leads (created today)
  const today = new Date().toISOString().slice(0, 10);
  leads.filter((l) => l.created_at === today).forEach((l) => {
    alerts.push({
      id: `alert-new-${l.id}`, type: "new_lead",
      title: "Novo Lead Atribuído",
      message: `${l.name} via ${l.source} → ${l.broker_name || "Sem corretor"}`,
      severity: "info", timestamp: now, read: false,
    });
  });

  // Visits today
  deals.filter((d) => d.visit_date === today && d.active).forEach((d) => {
    alerts.push({
      id: `alert-visit-${d.id}`, type: "visit_today",
      title: "Visita Agendada Hoje",
      message: `${d.client} - ${d.project} (${d.broker1})`,
      severity: "warning", timestamp: now, read: false,
    });
  });

  // Deals waiting approval
  deals.filter((d) => d.stage === "under_analysis" && d.active).forEach((d) => {
    alerts.push({
      id: `alert-appr-${d.id}`, type: "deal_approval",
      title: "Aguardando Aprovação",
      message: `Deal de ${d.client} em análise há ${d.days_in_pipeline} dias`,
      severity: d.days_in_pipeline > 20 ? "danger" : "info", timestamp: now, read: false,
    });
  });

  // Inactive deals
  deals.filter((d) => d.days_in_pipeline > 30 && d.active && !["approved", "contract", "closed"].includes(d.stage)).forEach((d) => {
    alerts.push({
      id: `alert-inact-${d.id}`, type: "deal_inactive",
      title: "Deal Inativo",
      message: `${d.client} está há ${d.days_in_pipeline} dias sem avanço`,
      severity: "danger", timestamp: now, read: false,
    });
  });

  // Follow-up due
  leads.forEach((l) => {
    const rule = checkFollowUpRules(l);
    if (rule) {
      alerts.push({
        id: `alert-fu-${l.id}`, type: "follow_up_due",
        title: "Follow-up Necessário",
        message: rule.action,
        severity: rule.severity, timestamp: now, read: false,
      });
    }
  });

  return alerts.slice(0, 12);
}

// ── Source tracking ──────────────────────────────────────────
export function calculateSourceMetrics(leads: Lead[]): SourceMetrics[] {
  const sourceMap: Record<string, { total: number; converted: number; totalDays: number }> = {};

  leads.forEach((l) => {
    if (!sourceMap[l.source]) sourceMap[l.source] = { total: 0, converted: 0, totalDays: 0 };
    sourceMap[l.source].total++;
    if (l.status === "converted") {
      sourceMap[l.source].converted++;
      sourceMap[l.source].totalDays += Math.floor((Date.now() - new Date(l.created_at).getTime()) / (1000 * 60 * 60 * 24));
    }
  });

  return Object.entries(sourceMap).map(([source, data]) => ({
    source,
    totalLeads: data.total,
    converted: data.converted,
    conversionRate: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0,
    avgDaysToConvert: data.converted > 0 ? Math.round(data.totalDays / data.converted) : 0,
  })).sort((a, b) => b.conversionRate - a.conversionRate);
}

// ── Render WhatsApp template ─────────────────────────────────
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  });
  return result;
}
