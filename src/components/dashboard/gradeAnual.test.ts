import { describe, expect, it } from "vitest";
import { gradeAnual } from "./gradeAnual";
import type { DealRow } from "./data";

/**
 * A montagem da grade anual — o que a tela nao consegue provar sozinha:
 * agrupamento por ano/mes, total do ano e o ano corrente incompleto (mes que
 * ainda nao chegou nao pode virar "zero venda").
 */
const deal = (fields: Partial<DealRow>): DealRow =>
  ({
    id: "d1",
    outcome: "open",
    status: "",
    stage: "proposal",
    client: "",
    developer: "",
    month_base: "01/2026",
    deal_value: 0,
    broker1: "",
    manager1: "",
    ...fields,
  }) as DealRow;

const venda = (month_base: string, deal_value = 0, id = month_base) =>
  deal({ id, outcome: "won", stage: "closed", month_base, deal_value });

const HOJE = "03/2026";

const linha = (rows: ReturnType<typeof gradeAnual>, year: string) =>
  rows.find((row) => row.year === year)!;

describe("gradeAnual", () => {
  it("agrupa por ano e mes: contagem numa metrica, dinheiro na outra", () => {
    const deals = [venda("02/2025", 500_000, "a"), venda("02/2025", 300_000, "b")];

    const contagem = linha(gradeAnual(deals, "vendas", HOJE), "2025").cells[1];
    const dinheiro = linha(gradeAnual(deals, "vgv", HOJE), "2025").cells[1];

    expect(contagem).toMatchObject({ month: "02/2025", label: "Fev/25", value: 2 });
    expect(dinheiro.value).toBe(800_000);
  });

  it("o total da linha e a soma dos meses do ano — e nada do ano vizinho", () => {
    const deals = [venda("01/2025", 100, "a"), venda("12/2025", 50, "b"), venda("01/2026", 900, "c")];
    const rows = gradeAnual(deals, "vgv", HOJE);

    expect(linha(rows, "2025").total).toBe(150);
    expect(linha(rows, "2026").total).toBe(900);
  });

  it("so venda entra: proposta em aberto e perda nao somam", () => {
    const deals = [
      venda("02/2026", 1_000, "ganha"),
      deal({ id: "aberta", month_base: "02/2026", deal_value: 9_000 }),
      deal({ id: "perdida", outcome: "lost", month_base: "02/2026", deal_value: 9_000 }),
    ];

    expect(linha(gradeAnual(deals, "vgv", HOJE), "2026").total).toBe(1_000);
    expect(linha(gradeAnual(deals, "vendas", HOJE), "2026").total).toBe(1);
  });

  it("o ano corrente vem incompleto: mes futuro e vazio, mes passado sem venda e zero", () => {
    const rows = gradeAnual([venda("01/2026", 100)], "vgv", HOJE);
    const atual = linha(rows, "2026");

    expect(atual.cells[1].value).toBe(0); // fevereiro passou sem venda
    expect(atual.cells[2].value).toBe(0); // marco e o mes corrente: ja comecou
    expect(atual.cells[3].value).toBeNull(); // abril ainda nao chegou
    expect(atual.cells.filter((cell) => cell.value === null)).toHaveLength(9);
    // Vazio nao contamina o total do ano.
    expect(atual.total).toBe(100);
  });

  it("negocio lancado a frente aparece: o valor manda sobre o mes futuro", () => {
    const atual = linha(gradeAnual([venda("11/2026", 700)], "vgv", HOJE), "2026");

    expect(atual.cells[10].value).toBe(700);
    expect(atual.total).toBe(700);
  });

  it("nao abre buraco entre anos: ano sem venda continua na grade, zerado", () => {
    const rows = gradeAnual([venda("05/2023", 10, "a"), venda("05/2026", 20, "b")], "vgv", HOJE);

    expect(rows.map((row) => row.year)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(linha(rows, "2024").total).toBe(0);
    // Ano inteiro no passado nao tem celula vazia: os 12 meses aconteceram.
    expect(linha(rows, "2024").cells.every((cell) => cell.value === 0)).toBe(true);
  });

  it("sem negocio nenhum sobra so o ano corrente, zerado", () => {
    const rows = gradeAnual([], "vendas", HOJE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: "2026", total: 0 });
  });
});
