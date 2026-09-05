/**
 * Semântica oficial do "Status 1" (coluna `deals.status`).
 *
 * VENDA    → Resultado (venda concretizada no mês de `month_base`)
 * PROPOSTA → Produção  (proposta ativa; migra para o próximo mês ao fechar)
 * QUEDA    → Perda     (queda no MESMO mês da venda)
 * DISTRATO → Perda     (distrato em mês POSTERIOR ao da venda)
 * OFF      → Ignorado  (descartado, não conta em nenhuma categoria)
 */

export type Status1 = "VENDA" | "PROPOSTA" | "QUEDA" | "DISTRATO" | "OFF";

/**
 * Rótulo sem o prefixo numerado, aparado e em caixa alta.
 *
 * A tabela do Pipeline usa o rótulo numerado ("17. DISTRATO") e o modal usa o
 * rótulo puro ("DISTRATO"). Sem tirar o prefixo só o modal marcava perda: o
 * negócio seguia somando VGV e ranking depois de um distrato.
 *
 * Exportado porque o gravador (`legacyDealFields`) compara o rótulo escolhido
 * com o `lost_reason` já gravado, e `startsWith` cru só casava um dos formatos:
 * "18. QUEDA" não é prefixo de "QUEDA — cliente desistiu", então o motivo era
 * reescrito por cima e a observação sumia. A normalização é a MESMA que o banco
 * aplica em `deal_status_bare`; ter duas seria ter duas respostas.
 */
export const bareStatus = (s: string | null | undefined): string =>
  (s ?? "").toString().trim().toUpperCase().replace(/^\d+\.\s*/, "");

export const normalizeStatus = (s: string | null | undefined): Status1 | null => {
  const u = bareStatus(s);
  if (u === "VENDA" || u === "PROPOSTA" || u === "QUEDA" || u === "DISTRATO" || u === "OFF") {
    return u as Status1;
  }
  return null;
};

export const isResultado = (s: string | null | undefined) => normalizeStatus(s) === "VENDA";
export const isProducao = (s: string | null | undefined) => normalizeStatus(s) === "PROPOSTA";
export const isPerda = (s: string | null | undefined) => {
  const n = normalizeStatus(s);
  return n === "QUEDA" || n === "DISTRATO";
};

/**
 * Os rótulos do Status 2 que **encerram** o negócio: os motivos que o diálogo
 * de perda oferece e os que o Select da tabela precisa desviar para a
 * confirmação, em vez de gravar direto.
 *
 * Lista única, e não duas. Enquanto o diálogo tinha a sua e o `changeStatus`
 * comparava contra três constantes soltas, "19. REPROVADO" encerrava o negócio
 * quando escolhido no diálogo e não encerrava nada quando escolhido na tabela —
 * o mesmo motivo com dois resultados.
 *
 * Encerrar ≠ contar como perda: `isPerda` é a semântica do relatório (só QUEDA
 * e DISTRATO viram perda no dashboard) e continua intocada. "19. REPROVADO"
 * e "OFF" tiram o negócio do funil sem entrar na conta de perdas.
 */
export const LOSS_REASONS = ["17. DISTRATO", "18. QUEDA", "19. REPROVADO", "OFF"];

const LOSS_LABELS = new Set(LOSS_REASONS.map(bareStatus));

/** Escolher este rótulo encerra o negócio? Compara sem o prefixo numerado:
 *  a tabela manda "18. QUEDA" e um `status_detail` importado pode vir "QUEDA". */
export const isLossStatus = (s: string | null | undefined): boolean => LOSS_LABELS.has(bareStatus(s));

/**
 * Os rótulos do Status 2 que o **sistema** escreve e ninguém escolhe.
 *
 * "Esteira Ágil" é a entrada do negócio na análise de crédito — o mesmo evento
 * que a aprovação da conferência do gerente dispara. Enquanto o Select oferecia
 * os dois, qualquer pessoa marcava "13. ESTEIRA AGIL" em verde num negócio que
 * nunca foi conferido e não tem caso no CCA. Agora o banco grava o rótulo
 * quando o caso entra na esteira (`under_review`) e quando volta dela
 * (`pending_documents`), e recusa a escrita manual (migration 0037). Aqui eles
 * só saem das opções; continuam no catálogo para exibir, colorir e ordenar.
 * Decisão de 01/09/2026, caminho (a).
 */
export const SYSTEM_STATUSES = ["13. ESTEIRA AGIL", "RET. ESTEIRA AGIL"];

const SYSTEM_LABELS = new Set(SYSTEM_STATUSES.map(bareStatus));

/** Este rótulo é escrito pelo sistema? Compara sem o prefixo numerado, como
 *  `isLossStatus` — o banco (`deal_status_bare`) normaliza do mesmo jeito. */
export const isSystemStatus = (s: string | null | undefined): boolean => SYSTEM_LABELS.has(bareStatus(s));

/** Ordena "MM/AAAA" ascendente. */
export const compareMonth = (a: string, b: string) => {
  const [ma, ya] = a.split("/").map(Number);
  const [mb, yb] = b.split("/").map(Number);
  return ya - yb || ma - mb;
};

/** Retorna o próximo mês no formato "MM/AAAA". */
export const nextMonthBase = (month: string): string => {
  const [mm, yyyy] = month.split("/").map(Number);
  const nm = mm === 12 ? 1 : mm + 1;
  const ny = mm === 12 ? yyyy + 1 : yyyy;
  return `${String(nm).padStart(2, "0")}/${ny}`;
};

/** Mês corrente (hoje) em "MM/AAAA". */
export const currentMonthBase = (): string => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/**
 * Meses que o "Fechar mês" pode congelar, do mais novo para o mais antigo.
 *
 * Enquanto o período era fixado na temporada aberta do game, o botão só sabia
 * fechar UM mês — e os dois relógios saem de fase sozinhos: a Gamificação
 * encerra a temporada sem fechar o mês, e o mês que ficou para trás não tinha
 * como ser congelado por tela nenhuma. Medido na homologação em 02/09/2026: a
 * temporada aberta era 09/2026 (zero negócios) e 26 dos 32 negócios estavam em
 * 08/2026, que ficaria aberto para sempre.
 *
 * Entram os meses com negócio e o mês da temporada aberta (ele pode não ter
 * negócio nenhum e ainda assim precisar ser fechado para o ciclo andar); saem
 * os que já estão em `closed_months`.
 */
export const closableMonths = (
  monthsWithDeals: string[],
  closedMonths: string[],
  seasonMonth?: string | null,
): string[] => {
  const closed = new Set(closedMonths);
  const all = new Set(monthsWithDeals.filter(Boolean));
  if (seasonMonth) all.add(seasonMonth);
  return [...all].filter((month) => !closed.has(month)).sort((a, b) => compareMonth(b, a));
};

/**
 * Escolhe o "mês aberto" a exibir por padrão no dashboard:
 * o mais recente presente nos deals que NÃO esteja fechado.
 * Se todos estiverem fechados, volta para o mês corrente do calendário.
 */
export const pickOpenMonth = (
  availableMonths: string[],
  closedMonths: string[]
): string => {
  const closed = new Set(closedMonths);
  const open = [...availableMonths].filter((m) => !closed.has(m));
  if (open.length === 0) return currentMonthBase();
  open.sort((a, b) => compareMonth(b, a)); // desc
  return open[0];
};
