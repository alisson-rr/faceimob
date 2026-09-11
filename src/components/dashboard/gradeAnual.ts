/**
 * A grade anual: uma linha por ano, um quadrado por mes, o total do ano na
 * ultima coluna.
 *
 * NAO abre consulta nova. Sai do mesmo `deals` que o painel inteiro ja carregou
 * (`useDashboardPayload`) e usa a MESMA `dealCategory` de `data.ts` — o dia em
 * que a grade tiver a propria regra de "o que e venda", ela e o KPI "Vendas"
 * vao discordar na mesma tela, que e o defeito que `data.ts` documenta ter
 * custado tres negocios sumidos em 08/2026.
 *
 * O VGV segue a convencao do painel: soma o `deal_value` das VENDAS, igual a
 * `statsOf`. Proposta em aberto nao e faturamento.
 */
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { currentMonthBase } from "@/lib/dealStatus";
import { dealCategory, type DealRow } from "./data";

/** Contagem de vendas ou faturamento (VGV) — a grade mostra os dois. */
export type GradeMetric = "vendas" | "vgv";

export type GradeCell = {
  /** "03/2024" — a chave da celula, no formato de `month_base`. */
  month: string;
  /** "Mar/24" — o rotulo pequeno do quadrado. */
  label: string;
  /**
   * `null` = mes que ainda nao chegou. Zero e "o mes passou e nao houve venda":
   * pintar os dois igual dizia que a empresa nao vendeu em dezembro de um ano
   * que ainda esta em marco.
   */
  value: number | null;
};

export type GradeRow = { year: string; cells: GradeCell[]; total: number };

/** "Mar" — o `MMM` do date-fns em pt-BR vem "mar.", minusculo e com ponto. */
const abbrev = (month: number): string => {
  const mmm = format(new Date(2000, month - 1, 1), "MMM", { locale: ptBR }).replace(".", "");
  return mmm.charAt(0).toUpperCase() + mmm.slice(1);
};

/** Jan…Dez — os cabecalhos de coluna da grade. */
export const MESES = Array.from({ length: 12 }, (_, index) => abbrev(index + 1));

/**
 * Monta a grade a partir dos negocios ja carregados.
 *
 * As LINHAS saem de todo negocio, nao so das vendas: um ano em que a operacao
 * so teve perda continua na grade, com zeros. Some-lo abriria buraco entre dois
 * anos e faria a leitura pular de 2023 para 2025 sem aviso.
 */
export function gradeAnual(
  deals: DealRow[],
  metric: GradeMetric,
  hoje: string = currentMonthBase(),
): GradeRow[] {
  const soma = new Map<string, number>();
  const anos = new Set<number>();

  for (const deal of deals) {
    const ano = Number(deal.month_base.split("/")[1]);
    if (Number.isFinite(ano)) anos.add(ano);
    if (dealCategory(deal) !== "venda") continue;
    const valor = metric === "vgv" ? deal.deal_value || 0 : 1;
    soma.set(deal.month_base, (soma.get(deal.month_base) ?? 0) + valor);
  }

  const [mesHoje, anoHoje] = hoje.split("/").map(Number);
  anos.add(anoHoje);

  const rows: GradeRow[] = [];
  for (let ano = Math.min(...anos); ano <= Math.max(...anos); ano += 1) {
    let total = 0;
    const cells = MESES.map((nome, index) => {
      const mes = index + 1;
      const month = `${String(mes).padStart(2, "0")}/${ano}`;
      const lancado = soma.get(month);
      // Com lancamento o valor manda, mesmo no futuro: negocio com `month_base`
      // a frente existe na base e nao pode desaparecer da grade.
      const futuro =
        lancado === undefined && (ano > anoHoje || (ano === anoHoje && mes > mesHoje));
      const value = futuro ? null : (lancado ?? 0);
      total += value ?? 0;
      return { month, label: `${nome}/${String(ano).slice(-2)}`, value };
    });
    rows.push({ year: String(ano), cells, total });
  }

  return rows;
}
