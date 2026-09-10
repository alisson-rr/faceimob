import { PipelineDeal, DealStage, DEAL_STAGES } from "@/types/crm";

// ── Deal Probability Score ───────────────────────────────────
const stageProbability: Record<DealStage, number> = {
  incomplete: 5, lead: 10, proposal: 25, visit_scheduled: 40,
  under_analysis: 55, approved: 75, contract: 90, closed: 100,
};

export function calcDealProbability(deal: PipelineDeal): number {
  let prob = stageProbability[deal.stage];
  // Days penalty
  if (deal.days_in_pipeline > 60) prob -= 15;
  else if (deal.days_in_pipeline > 30) prob -= 8;
  // Visit bonus
  if (deal.visit_result === "completed") prob += 10;
  // High-value slight penalty (harder to close)
  if (deal.deal_value > 1000000) prob -= 5;
  return Math.max(5, Math.min(98, prob));
}

// ── Sales Insights ───────────────────────────────────────────
export interface AIInsight {
  id: string;
  type: "info" | "warning" | "success" | "tip";
  icon: string;
  text: string;
}

export function generateInsights(deals: PipelineDeal[]): AIInsight[] {
  const insights: AIInsight[] = [];
  const active = deals.filter((d) => d.active);
  // Stage conversion
  const proposals = active.filter((d) => d.stage === "proposal").length;
  const visits = active.filter((d) => d.stage === "visit_scheduled").length;
  if (proposals > 0) {
    const convRate = Math.round((visits / proposals) * 100);
    insights.push({ id: "conv1", type: "info", icon: "📊", text: `Deals na etapa Proposta têm ${convRate}% de conversão para Visita.` });
  }

  // Top broker
  const brokerCounts: Record<string, number> = {};
  active.forEach((d) => { brokerCounts[d.broker1] = (brokerCounts[d.broker1] || 0) + 1; });
  const sorted = Object.entries(brokerCounts).sort(([, a], [, b]) => b - a);
  if (sorted.length > 1) {
    const avg = active.length / sorted.length;
    const [topName, topCount] = sorted[0];
    const pctAbove = Math.round(((topCount - avg) / avg) * 100);
    if (pctAbove > 0) {
      insights.push({ id: "broker1", type: "success", icon: "🏆", text: `${topName} gerencia ${pctAbove}% mais deals que a média da equipe.` });
    }
  }

  // Stale deals
  const stale = active.filter((d) => d.days_in_pipeline > 30);
  if (stale.length > 0) {
    insights.push({ id: "stale1", type: "warning", icon: "⏰", text: `${stale.length} deal(s) estão há mais de 30 dias no pipeline. Considere priorizar follow-up.` });
  }

  // Drop-off analysis
  const stageCount: Record<string, number> = {};
  DEAL_STAGES.forEach((s) => { stageCount[s.value] = active.filter((d) => d.stage === s.value).length; });
  let maxDrop = 0, dropFrom = "", dropTo = "";
  for (let i = 0; i < DEAL_STAGES.length - 1; i++) {
    const curr = stageCount[DEAL_STAGES[i].value] || 0;
    const next = stageCount[DEAL_STAGES[i + 1].value] || 0;
    const drop = curr - next;
    if (drop > maxDrop && curr > 0) { maxDrop = drop; dropFrom = DEAL_STAGES[i].label; dropTo = DEAL_STAGES[i + 1].label; }
  }
  if (maxDrop > 0) {
    insights.push({ id: "drop1", type: "tip", icon: "📉", text: `A maior queda de conversão acontece entre ${dropFrom} e ${dropTo}. Foque nessa transição.` });
  }

  // High-value deals
  const highValue = active.filter((d) => d.deal_value >= 500000);
  if (highValue.length > 0) {
    insights.push({ id: "hv1", type: "info", icon: "💎", text: `${highValue.length} deal(s) acima de R$500k merecem follow-up prioritário.` });
  }

  return insights;
}

// ── Sales Forecast ───────────────────────────────────────────
export interface SalesForecast {
  expectedClosings: number;
  projectedVGV: number;
  avgProbability: number;
}

export function generateForecast(deals: PipelineDeal[]): SalesForecast {
  const active = deals.filter((d) => d.active && d.stage !== "closed");
  const probabilities = active.map((d) => calcDealProbability(d));
  const expectedClosings = probabilities.reduce((a, p) => a + p / 100, 0);
  const projectedVGV = active.reduce((a, d, i) => a + d.deal_value * (probabilities[i] / 100), 0);
  const avgProbability = probabilities.length ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : 0;
  return { expectedClosings: Math.round(expectedClosings * 10) / 10, projectedVGV, avgProbability: Math.round(avgProbability) };
}

// ── Follow-up Recommendations ────────────────────────────────
export interface FollowUpRec {
  id: string;
  dealId: string;
  client: string;
  type: "inactive" | "high_value" | "visit_pending" | "stale";
  text: string;
  priority: "high" | "medium" | "low";
}

export function generateFollowUps(deals: PipelineDeal[]): FollowUpRec[] {
  const recs: FollowUpRec[] = [];
  const active = deals.filter((d) => d.active && d.stage !== "closed");

  active.forEach((d) => {
    if (d.days_in_pipeline > 7 && d.stage === "lead") {
      recs.push({ id: `fu-${d.id}-1`, dealId: d.id, client: d.client, type: "inactive", priority: "medium",
        text: `Agende follow-up com ${d.client}. Deal inativo há ${d.days_in_pipeline} dias.` });
    }
    if (d.deal_value >= 500000 && !["approved", "contract"].includes(d.stage)) {
      recs.push({ id: `fu-${d.id}-2`, dealId: d.id, client: d.client, type: "high_value", priority: "high",
        text: `Deal de R$${(d.deal_value / 1000).toFixed(0)}k com ${d.client} deve receber follow-up prioritário.` });
    }
    if (d.visit_result === "pending" && d.visit_date) {
      recs.push({ id: `fu-${d.id}-3`, dealId: d.id, client: d.client, type: "visit_pending", priority: "high",
        text: `Visita agendada para ${d.client} em ${d.visit_date}. Confirme presença.` });
    }
    if (d.days_in_pipeline > 45) {
      recs.push({ id: `fu-${d.id}-4`, dealId: d.id, client: d.client, type: "stale", priority: "high",
        text: `Deal com ${d.client} está parado há ${d.days_in_pipeline} dias. Risco de perda.` });
    }
  });

  return recs.sort((a, b) => (a.priority === "high" ? -1 : 1) - (b.priority === "high" ? -1 : 1)).slice(0, 8);
}

// ── Smart Alerts ─────────────────────────────────────────────
export interface SmartAlert {
  id: string;
  type: "danger" | "warning" | "info";
  title: string;
  text: string;
}

export function generateAlerts(deals: PipelineDeal[]): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const active = deals.filter((d) => d.active);

  // Stuck deals
  const stuck = active.filter((d) => d.days_in_pipeline > 45 && !["approved", "contract", "closed"].includes(d.stage));
  stuck.forEach((d) => {
    alerts.push({ id: `alert-stuck-${d.id}`, type: "danger", title: "Deal Travado", text: `${d.client} - ${d.days_in_pipeline} dias em ${DEAL_STAGES.find((s) => s.value === d.stage)?.label}` });
  });

  // High-value low probability
  active.forEach((d) => {
    const prob = calcDealProbability(d);
    if (d.deal_value >= 800000 && prob < 40) {
      alerts.push({ id: `alert-hv-${d.id}`, type: "warning", title: "Alto Valor / Baixa Probabilidade", text: `${d.client} - R$${(d.deal_value / 1000).toFixed(0)}k com ${prob}% de chance` });
    }
  });

  return alerts.slice(0, 5);
}

// ── Broker Performance Analysis ──────────────────────────────
export interface BrokerAnalysis {
  name: string;
  dealsActive: number;
  dealsClosed: number;
  totalVGV: number;
  avgDealValue: number;
  conversionRate: number;
  status: "top" | "average" | "underperforming";
  suggestion?: string;
}

export function analyzeBrokers(deals: PipelineDeal[]): BrokerAnalysis[] {
  const brokerMap: Record<string, { active: number; closed: number; vgv: number }> = {};
  deals.forEach((d) => {
    if (!brokerMap[d.broker1]) brokerMap[d.broker1] = { active: 0, closed: 0, vgv: 0 };
    if (d.active) { brokerMap[d.broker1].active++; brokerMap[d.broker1].vgv += d.deal_value; }
    if (d.stage === "closed") brokerMap[d.broker1].closed++;
  });

  const analyses = Object.entries(brokerMap).map(([name, data]) => {
    const total = data.active + data.closed;
    const convRate = total > 0 ? Math.round((data.closed / total) * 100) : 0;
    const avgVal = total > 0 ? data.vgv / data.active : 0;
    let status: "top" | "average" | "underperforming" = "average";
    let suggestion: string | undefined;

    if (data.active >= 3 || data.closed >= 2) status = "top";
    else if (data.active <= 1 && data.closed === 0) {
      status = "underperforming";
      suggestion = `${name} precisa de mais leads ou mentoria para aumentar o pipeline.`;
    }

    return { name, dealsActive: data.active, dealsClosed: data.closed, totalVGV: data.vgv, avgDealValue: avgVal, conversionRate: convRate, status, suggestion };
  });

  return analyses.sort((a, b) => b.totalVGV - a.totalVGV);
}

// ── AI Assistant (query mock data) ───────────────────────────
export function askAssistant(question: string, deals: PipelineDeal[]): string {
  const q = question.toLowerCase();
  const active = deals.filter((d) => d.active);
  const closed = deals.filter((d) => d.stage === "closed");

  if (q.includes("mais deal") || q.includes("mais negóci") || q.includes("top corretor")) {
    const counts: Record<string, number> = {};
    active.forEach((d) => { counts[d.broker1] = (counts[d.broker1] || 0) + 1; });
    const top = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
    return top ? `${top[0]} lidera com ${top[1]} deals ativos no pipeline.` : "Não há dados suficientes.";
  }

  if (q.includes("vgv") && (q.includes("total") || q.includes("trimestre") || q.includes("mês"))) {
    const total = active.reduce((a, d) => a + d.deal_value, 0);
    return `O VGV total do pipeline ativo é R$ ${total.toLocaleString("pt-BR")}.`;
  }

  if (q.includes("provável") || q.includes("probabilidade") || q.includes("mais perto")) {
    const withProb = active.map((d) => ({ ...d, prob: calcDealProbability(d) })).sort((a, b) => b.prob - a.prob).slice(0, 3);
    return withProb.map((d) => `${d.client} - ${d.prob}% (${DEAL_STAGES.find((s) => s.value === d.stage)?.label})`).join("\n") || "Sem dados.";
  }

  if (q.includes("follow") || q.includes("acompanhar") || q.includes("inativ")) {
    const inactive = active.filter((d) => d.days_in_pipeline > 14).slice(0, 3);
    return inactive.length ? inactive.map((d) => `${d.client} - ${d.days_in_pipeline} dias sem atividade`).join("\n") : "Todos os deals estão em dia!";
  }

  if (q.includes("fechou") || q.includes("fechados") || q.includes("closed")) {
    return `Total de deals fechados: ${closed.length}. VGV fechado: R$ ${closed.reduce((a, d) => a + d.deal_value, 0).toLocaleString("pt-BR")}.`;
  }

  return "Desculpe, não entendi a pergunta. Tente perguntar sobre VGV total, top corretor, deals mais prováveis ou follow-ups pendentes.";
}
