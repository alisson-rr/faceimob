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
 */
const bare = (s: string | null | undefined): string =>
  (s ?? "").toString().trim().toUpperCase().replace(/^\d+\.\s*/, "");

export const normalizeStatus = (s: string | null | undefined): Status1 | null => {
  const u = bare(s);
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

const LOSS_LABELS = new Set(LOSS_REASONS.map(bare));

/** Escolher este rótulo encerra o negócio? Compara sem o prefixo numerado:
 *  a tabela manda "18. QUEDA" e um `status_detail` importado pode vir "QUEDA". */
export const isLossStatus = (s: string | null | undefined): boolean => LOSS_LABELS.has(bare(s));

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
