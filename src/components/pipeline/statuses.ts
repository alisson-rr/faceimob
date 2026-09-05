/**
 * "Status 2" — o vocabulário de 32 rótulos que a operação usa na planilha e que
 * o banco guarda em `deals.status_detail`.
 *
 * É lista de STATUS, não de etapa. Misturar as duas coisas foi o achado F10: a
 * tabela caía num rótulo de etapa (`"08. VIROU NEGOCIO"`, sem acento) quando o
 * negócio não tinha `status_detail`, o valor não batia com nenhum item daqui e o
 * Select abria vazio. Agora a etapa tem coluna própria e o que não está na lista
 * entra por `statusChoices()`.
 *
 * A semântica de resultado (VENDA/PROPOSTA/QUEDA/DISTRATO/OFF) é de
 * `@/lib/dealStatus` — `normalizeStatus` já tira o prefixo numerado.
 */
import type { StatusTone } from "@/components/shared";
import { isSystemStatus } from "@/lib/dealStatus";

export type FaceimobStatus = { label: string; tone: StatusTone };

export const FACEIMOB_STATUSES: FaceimobStatus[] = [
  { label: "PROPOSTA", tone: "info" },
  { label: "02. ASS. BANCO", tone: "info" },
  { label: "03. ASSINADO", tone: "success" },
  { label: "04. EM CONTRATO", tone: "info" },
  { label: "05. RP APROVADO", tone: "success" },
  { label: "06. ENVIO DE RP", tone: "info" },
  { label: "07. APROV. AG. CONT.", tone: "warning" },
  { label: "08. VIROU NEGÓCIO", tone: "highlight" },
  { label: "09. APROV. TOTAL", tone: "success" },
  { label: "10. APROV. COND.", tone: "warning" },
  { label: "11. AG. RET. AGENCIA", tone: "warning" },
  { label: "12. EM PROCESSAMENTO", tone: "info" },
  { label: "13. ESTEIRA AGIL", tone: "success" },
  { label: "14. PENDENTE P/ VIRAR NEGÓCIO", tone: "warning" },
  { label: "15. ANÁLISE P/ VIRAR NEGÓCIO", tone: "warning" },
  { label: "15. INTERNALIZADO", tone: "info" },
  { label: "16. PENDENTE", tone: "warning" },
  { label: "17. DISTRATO", tone: "danger" },
  { label: "18. QUEDA", tone: "danger" },
  { label: "19. REPROVADO", tone: "danger" },
  { label: "20. BACEN", tone: "warning" },
  { label: "21. RESTRIÇÃO", tone: "warning" },
  { label: "ANÁLISE P/ POTENCIAL", tone: "info" },
  { label: "ANÁLISE EXTERNA", tone: "info" },
  { label: "APROV. TOT. RESTRIÇÃO", tone: "danger" },
  { label: "APROV. COND. RESTRIÇÃO", tone: "danger" },
  { label: "APROVADO POTENCIAL", tone: "success" },
  { label: "COMPRA ASSISTIDA", tone: "success" },
  { label: "INCOMPLETO", tone: "danger" },
  { label: "MUDAR CONSTRUTORA P/ NEGÓCIO", tone: "warning" },
  { label: "PENDENTE C/ RESTRIÇÃO", tone: "warning" },
  { label: "RET. ESTEIRA AGIL", tone: "success" },
];

const TONE_BY_LABEL = new Map(FACEIMOB_STATUSES.map((s) => [s.label, s.tone]));

export const faceimobStatusTone = (label?: string | null): StatusTone =>
  (label && TONE_BY_LABEL.get(label)) || "neutral";

/** Ordem de exibição da tabela — a mesma do catálogo, desconhecido por último. */
export const faceimobStatusRank = (label?: string | null): number => {
  const index = FACEIMOB_STATUSES.findIndex((s) => s.label === label);
  return index === -1 ? FACEIMOB_STATUSES.length : index;
};

/**
 * Opções do Select garantindo que o valor atual sempre aparece.
 *
 * Um `status_detail` gravado por importação (ou por um rótulo antigo) que não
 * esteja no catálogo deixaria o Select em branco — e o primeiro clique
 * sobrescreveria o valor sem ninguém ver qual era.
 *
 * Os rótulos do sistema (`SYSTEM_STATUSES`) ficam de fora: o banco os escreve
 * quando o caso entra na esteira e recusa a escolha manual. O valor atual
 * continua aparecendo — senão o negócio que está na esteira abriria o Select
 * em branco, que é o achado F10 de novo.
 */
export const statusChoices = (current?: string | null): FaceimobStatus[] => {
  const choices = FACEIMOB_STATUSES.filter((s) => s.label === current || !isSystemStatus(s.label));
  return current && !TONE_BY_LABEL.has(current)
    ? [{ label: current, tone: "neutral" as StatusTone }, ...choices]
    : choices;
};

/** Classes do gatilho colorido na tabela. Literais, para o Tailwind enxergar. */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  highlight: "bg-highlight text-highlight-foreground",
};
