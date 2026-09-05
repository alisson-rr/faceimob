/**
 * Regras puras da tela de Leads: filtro, indicadores e o número do WhatsApp.
 *
 * Ficam fora dos componentes por dois motivos: são o que dá para exercitar sem
 * DOM (`model.test.ts`) e, num `.tsx`, exportar função junto de componente
 * quebra o fast refresh do Vite.
 */
import { parseBrl } from "@/lib/format";
import { isLeadOverdue, type LeadRecord } from "@/integrations/supabase/leads";

export type LeadFilterState = {
  search: string;
  status: string;
  source: string;
  /** `all` · id do corretor · `none` para lead sem dono (fila). */
  broker: string;
  /** `all` · id do grupo de distribuição · `none` para lead sem grupo. */
  group: string;
};

export const emptyLeadFilters: LeadFilterState = {
  search: "", status: "all", source: "all", broker: "all", group: "all",
};

export const hasActiveFilter = (filters: LeadFilterState) =>
  Boolean(filters.search.trim())
  || filters.status !== "all"
  || filters.source !== "all"
  || filters.broker !== "all"
  || filters.group !== "all";

/**
 * Um lead passa no filtro quando casa com a busca, o status e a origem.
 *
 * A busca cobre nome, e-mail, telefone e campanha — o corretor procura pelo que
 * tem na mão, e nem sempre é o nome. `"none"` na origem é o lead sem origem
 * cadastrada, que não é o mesmo que "todas".
 *
 * Telefone casa por DÍGITOS, e não pelo texto cru: `leads.phone` é gravado
 * normalizado por `normalize_phone` ("5511988770001") e digitar o número com
 * máscara — o caso que a busca no banco existe para resolver — fazia o banco
 * DEVOLVER o lead e a tela descartá-lo, com "Nenhum lead com esses filtros".
 */
export const matchesFilters = (lead: LeadRecord, filters: LeadFilterState): boolean => {
  const term = filters.search.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const matchSearch = !term
    || lead.name.toLowerCase().includes(term)
    || (lead.email || "").toLowerCase().includes(term)
    || (digits.length > 0 && (lead.phone || "").includes(digits))
    || (lead.campaign_name || "").toLowerCase().includes(term);
  const matchStatus = filters.status === "all" || lead.status === filters.status;
  const matchSource = filters.source === "all"
    || lead.source_id === filters.source
    || (filters.source === "none" && !lead.source_id);
  // Corretor e grupo: o gerente com 40 corretores só tinha busca livre, status e
  // origem — nenhum jeito de responder "o que está na mão do Rodrigo?" nem
  // "quantos leads do Parque das Flores estão parados?".
  const matchBroker = filters.broker === "all"
    || lead.assigned_to === filters.broker
    || (filters.broker === "none" && !lead.assigned_to);
  const matchGroup = filters.group === "all"
    || lead.distribution_group_id === filters.group
    || (filters.group === "none" && !lead.distribution_group_id);
  return matchSearch && matchStatus && matchSource && matchBroker && matchGroup;
};

export type LeadMetrics = {
  total: number;
  queued: number;
  /** Atribuídos a mim e ainda sem "Atender" — o que corre contra a trava. */
  awaiting: number;
  attending: number;
  converted: number;
  overdue: number;
};

/**
 * Indicadores da régua. "Atrasado" é `isLeadOverdue`, a mesma definição de
 * `overdue_lead_count` — é essa conta que bloqueia o check-in, e uma heurística
 * de tela diferente mentiria sobre o motivo do bloqueio.
 *
 * `awaiting` existe porque "Na fila" é estruturalmente 0 para corretor:
 * `leads_select` só mostra lead sem dono a quem tem `leads.view_queue`, que
 * nenhum corretor tem. O card ocupava 1/5 da régua e nunca saía de zero para o
 * papel que mais usa a tela — quem decide qual dos dois aparece é `LeadsSummary`.
 */
export const leadMetrics = (leads: LeadRecord[], now: number, profileId?: string | null): LeadMetrics => ({
  total: leads.length,
  queued: leads.filter((lead) => lead.status === "queued").length,
  awaiting: leads.filter(
    (lead) => lead.status === "assigned" && (!profileId || lead.assigned_to === profileId),
  ).length,
  attending: leads.filter((lead) => lead.status === "attending" || lead.status === "in_progress").length,
  converted: leads.filter((lead) => lead.status === "converted").length,
  overdue: leads.filter((lead) => isLeadOverdue(lead, now)).length,
});

/**
 * Agrupa os atrasados por corretor.
 *
 * O card mostrava "Check-in bloqueado" para o diretor que via 29 atrasados da
 * equipe inteira somados contra um limite que é INDIVIDUAL — ninguém estava
 * bloqueado. Agrupado, cada corretor é comparado com o próprio limite, que é o
 * que `checkin_eligibility` faz.
 */
export type OverdueByBroker = {
  brokerId: string | null;
  brokerName: string;
  leads: LeadRecord[];
  blocked: boolean;
};

export const overdueByBroker = (leads: LeadRecord[], threshold: number): OverdueByBroker[] => {
  const groups = new Map<string, OverdueByBroker>();
  for (const lead of leads) {
    const key = lead.assigned_to ?? "sem-corretor";
    const group = groups.get(key) ?? {
      brokerId: lead.assigned_to,
      brokerName: lead.broker_name || "Sem corretor",
      leads: [],
      blocked: false,
    };
    group.leads.push(lead);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .map((group) => ({ ...group, blocked: group.leads.length >= threshold }))
    .sort((a, b) => b.leads.length - a.leads.length);
};

/**
 * Valor de um `<input type="datetime-local">` a partir de uma data.
 *
 * O input trabalha em hora local sem fuso; `toISOString()` devolveria UTC e a
 * próxima ação nasceria três horas fora do lugar.
 */
export const toDateTimeInput = (value: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    + `T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

/** Atalhos da próxima ação. "amanhã" e "3 dias" caem às 9h, início do expediente. */
export const nextActionPreset = (key: "2h" | "amanha" | "3d", from: Date = new Date()): Date => {
  const when = new Date(from);
  if (key === "2h") {
    when.setHours(when.getHours() + 2);
    return when;
  }
  when.setDate(when.getDate() + (key === "amanha" ? 1 : 3));
  when.setHours(9, 0, 0, 0);
  return when;
};

/** Qual diálogo da tela de Leads está aberto e sobre qual lead. */
export type LeadDialogState = {
  /** `open` separado do lead porque "novo lead" abre o formulário sem lead. */
  form: { open: boolean; lead: LeadRecord | null };
  reassign: LeadRecord | null;
  convert: LeadRecord | null;
  whatsapp: LeadRecord | null;
  email: LeadRecord | null;
  nextAction: LeadRecord | null;
  /** Encerrar como perdido/descartado com motivo (`close_lead`). */
  close: LeadRecord | null;
  remove: LeadRecord | null;
  import: boolean;
};

export const noLeadDialogs: LeadDialogState = {
  form: { open: false, lead: null },
  reassign: null, convert: null, whatsapp: null, email: null,
  nextAction: null, close: null, remove: null, import: false,
};

/** `wa.me` exige o número só com dígitos e com DDI; sem telefone, string vazia. */
export const waNumber = (phone?: string | null): string => {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
};

/**
 * Corpo de `whatsapp_templates` com os `{{n}}` preenchidos.
 *
 * O corpo é posicional por contrato: no envio pela Meta quem troca `{{1}}` é o
 * provedor, e `variables` diz o nome de cada posição. Pelo `wa.me` a troca é
 * aqui. Posição sem valor conhecido fica como `{{n}}`, visível, para o
 * corretor preencher — nunca vira vazio em silêncio.
 */
export const fillWhatsappTemplate = (
  body: string,
  variables: string[],
  values: Record<string, string>,
): string =>
  body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => values[variables[Number(n) - 1]] ?? match);

/**
 * Campo de VGV: o valor digitado ou "isso não é número".
 *
 * Quem lê o dinheiro é o `parseBrl` de `format.ts` — fonte única no app, a
 * mesma da importação de aportes. Ele devolve `null` para campo vazio e para
 * texto inválido, e a tela precisa separar os dois: VGV é opcional (negócio
 * nasce sem valor), mas "1.5 mi" é erro de digitação e não pode virar `null`
 * em silêncio, porque VGV é a base do rateio de comissão.
 */
export const parseVgvInput = (raw: string): { value: number | null; invalid: boolean } => {
  const value = parseBrl(raw);
  // "R$ " e espaços contam como campo vazio, não como texto inválido.
  const typed = raw.replace(/[R$\s]/gi, "") !== "";
  return { value, invalid: typed && value === null };
};
