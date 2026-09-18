/**
 * Estágio da esteira CCA — cor e desfecho.
 *
 * **Cor (achado T14, depois 0153).** `cca_stages.color` guardava uma CLASSE
 * do Tailwind (`text-amber-400`, depois `text-warning`), e virou CHAVE
 * SEMÂNTICA (`warning`, `success`…). Desde o kanban colorido (18/09/2026) a
 * coluna guarda `#RRGGBB`, que é o que o seletor de cor devolve e o que pinta
 * o cabeçalho sólido. A leitura continua tolerando os formatos antigos
 * (`ccaStageColor` traduz a chave para um hex fixo): uma tela que só
 * entendesse o formato novo apagaria a cor da linha que ainda não foi
 * recolorida.
 *
 * **Desfecho (achado P10).** `cca_stages.status` mapeia o estágio para o enum
 * `cca_status`. Todo estágio criado pela tela nascia `under_review`, então um
 * "Aprovado" criado pelo usuário não aprovava nada nem movia o negócio.
 */
import type { StatusTone } from "@/components/shared";
import { TONE_HEX, isHexColor } from "@/lib/tone";

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

/**
 * Cor da coluna como `#RRGGBB`, pronta para o `style`: o hex gravado, ou o hex
 * fixo do tom quando a linha ainda guarda chave ou classe antiga. Nulo, vazio
 * ou lixo viram o cinza neutro — nunca uma coluna sem cor.
 */
export const ccaStageColor = (color: string | null | undefined): string =>
  isHexColor(color) ? color : TONE_HEX[ccaStageTone(color)];
