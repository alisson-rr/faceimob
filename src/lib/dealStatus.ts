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

export const normalizeStatus = (s: string | null | undefined): Status1 | null => {
  if (!s) return null;
  const u = s.toString().trim().toUpperCase();
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
