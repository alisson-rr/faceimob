import { describe, expect, it, vi } from "vitest";

// A tela importa o cliente do Supabase no topo; o parser não fala com o banco.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { rowsToAportes } from "./DataManagement";

const DEVS = [
  { id: "d1", name: "Horizonte Urbanismo", active: true },
  { id: "d2", name: "Viva Lar Incorporadora", active: true },
];

/**
 * A regra de negócio da planilha de aportes só passava pelo caminho feliz do
 * e2e. O que se prova aqui é o que quebra em produção: cabeçalho com acento e
 * caixa diferentes, valor em pt-BR, linha repetida e — o caso que fazia a
 * coluna errada vencer — "Data de cadastro" ao lado de "Mês".
 */
describe("rowsToAportes", () => {
  it("casa cabeçalho sem acento e sem caixa, e valor em pt-BR", () => {
    const { rows, hasNotes } = rowsToAportes(
      [
        ["MÊS", "Construtora", "Valor", "Nota"],
        ["07/2026", "  horizonte urbanismo ", "R$ 7.500,00", "campanha"],
      ],
      DEVS,
    );

    expect(hasNotes).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line: 2,
      period: "2026-07-01",
      developer_id: "d1",
      amount: 7500,
      notes: "campanha",
      error: null,
    });
  });

  // "data" casaria com "Data de cadastro"; quem tem uma coluna "Mês" na mesma
  // planilha esperava que ela ganhasse — daí a busca ser da mais específica
  // para a mais genérica.
  it("prefere a coluna Mês quando a planilha também tem Data de cadastro", () => {
    const { rows } = rowsToAportes(
      [
        ["Data de cadastro", "Construtora", "Valor", "Mês"],
        ["01/01/2020", "Horizonte Urbanismo", "100", "09/2026"],
      ],
      DEVS,
    );
    expect(rows[0].period).toBe("2026-09-01");
    expect(rows[0].error).toBeNull();
  });

  it("nomeia cada motivo de recusa, sem derrubar as outras linhas", () => {
    const { rows } = rowsToAportes(
      [
        ["Mês", "Construtora", "Valor"],
        ["mês que não existe", "Horizonte Urbanismo", "100"],
        ["07/2026", "Construtora Fantasma", "100"],
        ["07/2026", "Viva Lar Incorporadora", "abc"],
        ["07/2026", "Viva Lar Incorporadora", "-50"],
        ["07/2026", "Horizonte Urbanismo", "100"],
        ["07/2026", "Horizonte Urbanismo", "200"],
      ],
      DEVS,
    );

    expect(rows.map((r) => r.error)).toEqual([
      "mês inválido",
      "construtora não cadastrada",
      "valor inválido",
      "valor inválido",
      null,
      "repetida na planilha",
    ]);
    // A linha repetida é a SEGUNDA ocorrência: a primeira continua válida.
    expect(rows[4].amount).toBe(100);
  });

  it("sem coluna Nota, avisa quem chama para não apagar a nota já gravada", () => {
    const { rows, hasNotes } = rowsToAportes(
      [["Mês", "Construtora", "Valor"], ["07/2026", "Horizonte Urbanismo", "100"]],
      DEVS,
    );
    expect(hasNotes).toBe(false);
    expect(rows[0].notes).toBeNull();
  });

  it("planilha sem as três colunas obrigatórias é recusada com motivo", () => {
    expect(() => rowsToAportes([["Construtora", "Valor"], ["Horizonte Urbanismo", "100"]], DEVS))
      .toThrow(/Mês, Construtora e Valor/);
  });
});
