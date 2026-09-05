import type { AppRole } from "@/contexts/AuthContext";
import type { StatusTone } from "@/components/shared";
import type { Database } from "@/integrations/supabase/types";

/**
 * Radix recusa `<SelectItem value="">` — string vazia é o valor que limpa a
 * seleção, então usar isso numa opção derruba a tela inteira. Sentinela para as
 * opções que significam "nenhum"; vira `null`/`""` na hora de gravar.
 */
export const SEM_SELECAO = "__nenhum__";

export type Agent = Database["public"]["Tables"]["sdr_agents"]["Row"];
export type Conversation = Database["public"]["Tables"]["sdr_conversations"]["Row"];
/** Roleta que recebe o lead depois do SDR (`sdr_agents.handoff_group_id`). */
export type Group = Pick<
  Database["public"]["Tables"]["distribution_groups"]["Row"],
  "id" | "name" | "kind" | "active"
>;
/**
 * `agent_id` entrou na migration 0082 e ainda não está no `types.ts` gerado
 * (que é regerado por `supabase gen types`, não editado à mão). Opcional na
 * interseção: quando a regeneração acontecer, o campo já existe e nada quebra.
 * É o único lugar onde a CADEIA de agentes sobrevive — `sdr_conversations.
 * agent_id` guarda só o último.
 */
export type Message = Database["public"]["Tables"]["sdr_messages"]["Row"] & {
  agent_id?: string | null;
};
export type Source = Database["public"]["Tables"]["lead_sources"]["Row"];
export type WhatsAppTemplate = Database["public"]["Tables"]["whatsapp_templates"]["Row"];
export type ListStats = { total: number; pending: number; sent: number; replied: number; failed: number };
export type Rlist = Database["public"]["Tables"]["remarketing_lists"]["Row"] & {
  template_name: string | null;
  stats: ListStats;
};

/**
 * Quem escreve no módulo, espelhando as policies do banco: `sdr_agents_write`,
 * `lead_sources_write`, `remarketing_lists_all` (migrations 0008/0031) e, desde
 * a 0069, `whatsapp_templates_write` aceitam admin/marketing/sdr. Os outros
 * papéis com `menu.sdr` (director, manager, partner) leem. UPDATE/DELETE
 * barrado pelo `using` casa zero linhas SEM erro — então, além de esconder o
 * botão, toda gravação pede `.select("id")` e trata vazio como recusa.
 *
 * A migration 0069 alinhou os dois lados que estavam em desacordo: `marketing`
 * escrevia em quatro tabelas do módulo e NÃO tinha `menu.sdr` (não conseguia
 * abrir a tela), e `sdr`, que administra agentes, origens e listas, era o único
 * que não podia mexer no template que ele mesmo usa. Mudou lá, muda aqui.
 */
const SDR_WRITE_ROLES: AppRole[] = ["admin", "marketing", "sdr"];
const TEMPLATE_WRITE_ROLES: AppRole[] = ["admin", "marketing", "sdr"];

export const canManageSdr = (roles: AppRole[]) => roles.some(r => SDR_WRITE_ROLES.includes(r));
export const canEditTemplates = (roles: AppRole[]) => roles.some(r => TEMPLATE_WRITE_ROLES.includes(r));

export const SEM_PERMISSAO = "Nada foi gravado. Verifique sua permissão.";

/**
 * O que falta e onde consertar quando o cofre não tem a chave da OpenAI.
 *
 * Sem ela TODO turno do agente morre em 503 (`code: missing_credential` no
 * `sdr-agent-chat`; `Credencial ausente` no `whatsapp-inbound-webhook`), e até
 * 05/09/2026 a tela só revelava isso DEPOIS de o operador digitar e enviar —
 * enquanto o switch "Ativo" da aba Agentes e o seletor do Playground faziam
 * parecer que o agente estava trabalhando. O sinal vem de
 * `sdr-agent-chat` com `action: "status"`, que devolve só o booleano.
 *
 * Texto único porque os três pontos que avisam (módulo, Agentes, Playground)
 * têm de apontar o MESMO conserto — o rótulo é o mesmo do catálogo de
 * integrações (`src/lib/integrationCatalog.ts`: provider `openai`, "OpenAI —
 * chave de API").
 */
export const IA_SEM_CREDENCIAL =
  "A IA de SDR ainda não está configurada: falta a chave da OpenAI no cofre. "
  + "Cadastre em Admin · Integrações (OpenAI — chave de API).";

/**
 * Status da conversa em português. `human` entrou na 0064: o
 * `whatsapp-inbound-webhook` só atende conversa `active`, então marcar `human`
 * é o que faz o robô calar sem encerrar o atendimento.
 */
export const STATUS_CONVERSA: Record<string, string> = {
  active: "Robô atendendo",
  human: "Operador assumiu",
  qualified: "Qualificada",
  disqualified: "Desqualificada",
  handed_off: "Entregue à roleta",
  abandoned: "Abandonada",
};

/**
 * Papel do agente em português. O seletor da aba Agentes e a lista ao lado leem
 * este mesmo mapa — o operador cadastrava "Qualificador (Frio→Morno)" e relia
 * "qualifier" na linha seguinte, na mesma tela.
 */
export const PAPEL_AGENTE: Record<string, string> = {
  orchestrator: "Orquestrador",
  qualifier: "Qualificador (Frio→Morno)",
  reengager: "Reengajador (Remarketing)",
  handoff: "Handoff / Entrega Corretor",
  custom: "Personalizado",
};

/**
 * Situação da lista de remarketing, derivada dos CONTATOS e não da coluna
 * `remarketing_lists.status`.
 *
 * A coluna mente por construção: o `sdr-whatsapp-broadcast` grava
 * `pending > 0 ? 'draft' : 'done'`, então uma lista que já disparou 500
 * contatos e tem fila volta a exibir "rascunho"; e basta UMA falha em 500 para
 * a lista inteira virar "failed". O selo fica na tela para sempre, o toast do
 * disparo some em segundos — então quem tem de dizer a verdade é o selo.
 * `running` é o único estado que só a coluna conhece (trava de concorrência).
 */
export function situacaoLista(status: string | null, stats: ListStats): { label: string; tone: StatusTone } {
  if (status === "running") return { label: "Disparando…", tone: "info" };
  if (stats.total === 0) return { label: "Sem contatos", tone: "neutral" };
  if (stats.pending === stats.total) return { label: "Rascunho · nada enviado", tone: "neutral" };
  if (stats.pending > 0) return { label: `Envio parcial · ${stats.pending} na fila`, tone: "warning" };
  if (stats.sent === 0 && stats.replied === 0) return { label: `Nenhum envio saiu · ${stats.failed} falhas`, tone: "danger" };
  if (stats.failed > 0) return { label: `Concluída com ${stats.failed} falha(s)`, tone: "warning" };
  return { label: "Concluída", tone: "success" };
}

/**
 * Como o disparo é contado para o operador. A tela pintava verde para qualquer
 * 2xx — inclusive `sent: 0, failed: 500` — e ainda dizia "Nenhum contato
 * pendente nesta lista", que é verdade técnica (todos viraram 'failed') e
 * mentira prática.
 */
export function resumoDisparo(r: { sent: number; failed: number; remaining: number }): {
  tom: "success" | "warning" | "error"; titulo: string; descricao: string;
} {
  const fila = r.remaining > 0
    ? `Sobraram ${r.remaining} contatos pendentes — clique em Disparar de novo para continuar.`
    : "Nenhum contato pendente nesta lista.";
  const ondeVerAFalha = "Cada contato com falha ficou com a situação \"falhou\" e o motivo gravado nele.";
  if (r.failed > 0 && r.sent === 0) {
    return { tom: "error", titulo: `Nenhum envio saiu · ${r.failed} falhas`, descricao: `${ondeVerAFalha} Confira o template aprovado na Meta e as credenciais do WhatsApp.` };
  }
  if (r.failed > 0) {
    return { tom: "warning", titulo: `Enviados: ${r.sent} · Falhas: ${r.failed}`, descricao: `${ondeVerAFalha} ${fila}` };
  }
  if (r.sent === 0) {
    return { tom: "warning", titulo: "Nada foi enviado", descricao: "Nenhum contato pendente para disparar nesta lista." };
  }
  return { tom: "success", titulo: `Enviados: ${r.sent}`, descricao: fila };
}

/**
 * O que se solta ao excluir um agente. Todas as FKs são ON DELETE SET NULL, e o
 * aviso anterior contava só os agentes encadeados nele — o efeito que a
 * operação sente (origem sem agente = lead vai direto para a roleta; lista de
 * remarketing sem agente = ninguém responde a quem responder o template) não
 * aparecia em lugar nenhum.
 */
export function efeitosDaExclusao(
  agentId: string,
  dados: {
    agents: Pick<Agent, "id" | "handoff_to_agent_id">[];
    sources: Pick<Source, "sdr_agent_id">[];
    lists: Pick<Rlist, "agent_id">[];
  },
): string[] {
  const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
  const encadeados = dados.agents.filter(a => a.id !== agentId && a.handoff_to_agent_id === agentId).length;
  const origens = dados.sources.filter(s => s.sdr_agent_id === agentId).length;
  const listas = dados.lists.filter(l => l.agent_id === agentId).length;
  const out: string[] = [];
  if (origens) out.push(plural(origens, "origem de lead", "origens de lead"));
  if (listas) out.push(plural(listas, "lista de remarketing", "listas de remarketing"));
  if (encadeados) out.push(plural(encadeados, "agente encadeado nele", "agentes encadeados nele"));
  return out;
}

/**
 * O que se solta ao excluir um template de WhatsApp.
 *
 * As FKs (`lead_sources.welcome_template_id`, `remarketing_lists.template_id`)
 * são ON DELETE SET NULL: a exclusão não falha, ela desliga em silêncio as
 * boas-vindas daquela origem e o disparo daquela lista. O aviso antigo era um
 * `confirm()` do navegador com um texto genérico ("as origens e listas que o
 * usam"), sem dizer QUANTAS — e o número é o que decide se dá para excluir.
 */
export function efeitosDaExclusaoTemplate(
  templateId: string,
  dados: {
    sources: Pick<Source, "welcome_template_id">[];
    lists: Pick<Rlist, "template_id">[];
  },
): string[] {
  const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
  const origens = dados.sources.filter(s => s.welcome_template_id === templateId).length;
  const listas = dados.lists.filter(l => l.template_id === templateId).length;
  const out: string[] = [];
  if (origens) out.push(plural(origens, "origem de lead", "origens de lead"));
  if (listas) out.push(plural(listas, "lista de remarketing", "listas de remarketing"));
  return out;
}

/**
 * Conversa parada: quanto tempo desde a última MENSAGEM.
 *
 * Uma conversa 'active' abandonada era indistinguível de uma em andamento — a
 * lista mostrava a data e cabia ao operador fazer a conta. O corte de 6 horas é
 * operacional, não técnico: a janela de atendimento da Meta é de 24 h, e uma
 * conversa sem resposta há mais de um turno de trabalho já precisa de gente.
 *
 * O relógio sai de `last_message_at` (mantido pelo trigger `sdr_messages_touch`
 * da 0008) e só cai em `updated_at` quando aquele é nulo. A diferença não é
 * cosmética: `updated_at` avança em QUALQUER gravação na conversa — clicar em
 * "Assumir conversa" gravava `status='human'` e o selo "parada há 3 dias"
 * desaparecia sem ninguém ter respondido ao lead, apagando justamente o sinal
 * que fez o operador assumir.
 */
export const HORAS_PARA_PARADA = 6;

export function conversaParada(
  conversa: { status: string; last_message_at?: string | null; updated_at: string | null },
  agora: number = Date.now(),
): { parada: boolean; horas: number; rotulo: string } | null {
  // Só conversa que alguém ainda espera resposta: qualificada, desqualificada e
  // entregue à roleta já terminaram, e marcá-las de "parada" viraria ruído.
  if (conversa.status !== "active" && conversa.status !== "human") return null;
  const desde = conversa.last_message_at ?? conversa.updated_at;
  const t = desde ? Date.parse(desde) : NaN;
  if (!Number.isFinite(t)) return null;
  const horas = Math.floor((agora - t) / 3_600_000);
  if (horas < HORAS_PARA_PARADA) return { parada: false, horas: Math.max(0, horas), rotulo: "" };
  const dias = Math.floor(horas / 24);
  return {
    parada: true,
    horas,
    rotulo: dias >= 1 ? `parada há ${dias} dia${dias > 1 ? "s" : ""}` : `parada há ${horas} h`,
  };
}

/**
 * Por quais agentes a conversa passou, na ordem, sem repetir o mesmo em
 * sequência. Sai de `sdr_messages.agent_id` (0082): `sdr_conversations.agent_id`
 * é sobrescrito a cada handoff e mostra só o último da cadeia.
 */
export function cadeiaDeAgentes(msgs: Pick<Message, "agent_id">[], nomePor: (id: string) => string): string[] {
  const out: string[] = [];
  for (const m of msgs) {
    if (!m.agent_id) continue;
    const nome = nomePor(m.agent_id);
    if (out[out.length - 1] !== nome) out.push(nome);
  }
  return out;
}

/** Linha de `remarketing_contacts` mostrada na tabela de contatos da lista. */
export type RemarketingContact = Pick<
  Database["public"]["Tables"]["remarketing_contacts"]["Row"],
  "id" | "full_name" | "phone" | "status" | "sent_at" | "replied_at" | "last_error"
>;

/**
 * Situação de um contato de remarketing em pt-BR. Os valores são os que o
 * `sdr-whatsapp-broadcast` e o `whatsapp-inbound-webhook` gravam: 'pending' na
 * importação, 'sent' no disparo aceito, 'failed' na recusa da Graph API,
 * 'replied' quando o contato responde. 'delivered' vem do status de entrega da
 * Meta, quando ele chega.
 */
export const SITUACAO_CONTATO: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Na fila", tone: "neutral" },
  sent: { label: "Enviado", tone: "info" },
  delivered: { label: "Entregue", tone: "info" },
  replied: { label: "Respondeu", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  // Está no CHECK da coluna desde a 0008: sem entrada aqui o selo mostrava
  // 'opted_out' cru, e quem pediu para não ser mais contatado é exatamente o
  // caso que não pode ficar ilegível numa lista de disparo.
  opted_out: { label: "Pediu para não receber", tone: "warning" },
};
