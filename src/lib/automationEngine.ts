// Templates de e-mail e o renderizador de variáveis usados pela tela de Leads.
// Os templates de WhatsApp saíram daqui: agora vivem na tabela
// `whatsapp_templates` e são geridos no módulo SDR.

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  trigger: string;
}

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

// ── Render template ──────────────────────────────────────────
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  });
  return result;
}
