import { describe, expect, it } from "vitest";
import { PlanilhaLeadfyInvalida, dataLeadfy, emLotes, linhasDaLeadfy, resumoDaLeadfy } from "./importacaoLeadfy";

const CAB = ["Mês", "Criado em", "Corretor", "Gerente", "Status", "Cliente", "Telefone", "Email", "Identificador", "Data atividade", "Neighborhood", "Neighborhood"];
const linha = (criado: string, corretor: string, status: string, id: string) =>
  ["01/26", criado, corretor, "Ger", status, `Cliente ${id}`, "(51) 99999 0000", "", id, "", "", ""];

describe("importação da Leadfy", () => {
  it("lê as datas da Leadfy no horário de Brasília", () => {
    expect(dataLeadfy("01/01/26 00:54")).toBe("2026-01-01T00:54:00-03:00");
    expect(dataLeadfy("06/01/26 18:12:00")).toBe("2026-01-06T18:12:00-03:00");
    expect(dataLeadfy("")).toBeNull();
  });

  it("mapeia as colunas e põe em negociação e os mais novos primeiro", () => {
    const linhas = linhasDaLeadfy([
      CAB,
      linha("01/01/26 10:00", "Ana", "Arquivado", "a"),
      linha("05/01/26 10:00", "Ana", "Arquivado", "b"),
      linha("02/01/26 10:00", "Bia", "Em negociação", "c"),
      ["", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    expect(linhas.map((l) => l.id)).toEqual(["c", "b", "a"]);
    expect(linhas[0]).toMatchObject({ corretor: "Bia", status: "Em negociação", cliente: "Cliente c", telefone: "(51) 99999 0000", email: null });
    expect(resumoDaLeadfy(linhas)).toEqual({
      total: 3, porStatus: { "Em negociação": 1, Arquivado: 2 }, corretoresEmNegociacao: { Bia: 1 }, corretores: ["Ana", "Bia"],
    });
  });

  it("recusa planilha que não é da Leadfy", () => {
    expect(() => linhasDaLeadfy([["Nome", "Telefone"], ["a", "b"]])).toThrow(PlanilhaLeadfyInvalida);
  });

  it("divide em lotes", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
