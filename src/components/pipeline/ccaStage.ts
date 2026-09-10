/**
 * Estágio da esteira CCA — cor e desfecho.
 *
 * **Cor (achado T14).** `cca_stages.color` guardava uma CLASSE do Tailwind
 * (`text-amber-400`, depois `text-warning`): o banco passava a depender do nome
 * de uma classe de front, a classe montada em runtime não entrava no bundle
 * sem safelist, e um literal de paleta não acompanha a troca de tema. Agora a
 * coluna guarda uma CHAVE SEMÂNTICA (`warning`, `success`…) e a leitura tolera
 * os dois formatos antigos — não dá para migrar as linhas existentes daqui, e
 * uma tela que só entende o formato novo apagaria a cor de todas elas.
 *
 * **Desfecho (achado P10).** `cca_stages.status` mapeia o estágio para o enum
 * `cca_status`. Todo estágio criado pela tela nascia `under_review`, então um
 * "Aprovado" criado pelo usuário não aprovava nada nem movia o negócio.
 */
import type { StatusTone } from "@/components/shared";

export type CcaCaseStatus =
  | "pending_documents" | "under_review" | "sent_to_developer"
  | "sent_to_agency" | "approved" | "rejected" | "cancelled";

export const CCA_STATUS_OPTIONS: { value: CcaCaseStatus; label: string }[] = [
  { value: "pending_documents", label: "Aguardando documentos" },
  { value: "under_review", label: "Em análise" },
  { value: "sent_to_developer", label: "Enviado à construtora" },
  { value: "sent_to_agency", label: "Enviado à agência" },
  { value: "approved", label: "Aprovado" },
  { value: "rejected", label: "Reprovado" },
  { value: "cancelled", label: "Cancelado" },
];

export const ccaStatusLabel = (status: string): string =>
  CCA_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;

/** Estágio com este desfecho decide o caso: grava `decided_at`. */
export const isDecision = (status: string) => status === "approved" || status === "rejected";

export const CCA_TONE_OPTIONS: { value: StatusTone; label: string }[] = [
  { value: "info", label: "Azul — em andamento" },
  { value: "warning", label: "Amarelo — atenção" },
  { value: "success", label: "Verde — aprovado" },
  { value: "danger", label: "Vermelho — perda" },
  { value: "highlight", label: "Destaque" },
  { value: "neutral", label: "Neutro" },
];

const TONES: StatusTone[] = ["info", "warning", "success", "danger", "highlight", "neutral"];

/** Famílias da paleta literal que sobraram de antes da migração de tokens. */
const LEGACY: [RegExp, StatusTone][] = [
  [/(amber|yellow|orange)/, "warning"],
  [/(green|emerald|lime|teal)/, "success"],
  [/(blue|sky|cyan|indigo)/, "info"],
  [/(red|rose|pink)/, "danger"],
  [/(purple|violet|fuchsia|chart-5)/, "highlight"],
  [/(slate|gray|grey|zinc|neutral|stone|muted)/, "neutral"],
];

/**
 * Lê a cor gravada em qualquer um dos três formatos:
 * `warning` (novo) · `text-warning` (token) · `text-amber-400` (legado).
 */
export function ccaStageTone(color: string | null | undefined): StatusTone {
  const raw = (color || "").trim().toLowerCase();
  if (!raw) return "neutral";

  const key = raw.replace(/^(text|bg|border)-/, "");
  if (TONES.includes(key as StatusTone)) return key as StatusTone;
  if (key === "destructive") return "danger";
  if (key === "primary") return "info";

  for (const [pattern, tone] of LEGACY) {
    if (pattern.test(key)) return tone;
  }
  return "neutral";
}

/** Classes literais — o Tailwind não enxerga classe montada em runtime. */
export const CCA_TONE_CLASS: Record<StatusTone, { text: string; dot: string }> = {
  success: { text: "text-success", dot: "bg-success" },
  warning: { text: "text-warning", dot: "bg-warning" },
  info: { text: "text-info", dot: "bg-info" },
  danger: { text: "text-destructive", dot: "bg-destructive" },
  neutral: { text: "text-muted-foreground", dot: "bg-muted-foreground" },
  highlight: { text: "text-primary", dot: "bg-primary" },
};
