import { describe, expect, it } from "vitest";
import { gerarPlanilha, lerPlanilha, lerValor } from "./planilhaPrecos";

const imovel = {
  id: "a1", code: "FC-1", developer: "Construtora; Sul", title: "Solar \"Bosque\"", city: "Canoas",
  price: 213000, price_from: null,
};

describe("planilha de preços", () => {
  it("o que se baixa volta igual ao subir", () => {
    const csv = gerarPlanilha([imovel]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('a1;FC-1;"Construtora; Sul";"Solar ""Bosque""";Canoas;213000,00;');
    expect(lerPlanilha(csv)).toEqual({ linhas: [{ id: "a1", code: "FC-1", price: 213000, from: null }], erros: [] });
  });

  it("aceita os formatos de número do Excel e recusa texto", () => {
    expect(lerValor("R$ 213.000,50")).toBe(213000.5);
    expect(lerValor("213.000")).toBe(213000);
    expect(lerValor("213000.5")).toBe(213000.5);
    expect(lerValor("")).toBeNull();
    expect(() => lerValor("abc")).toThrow();
  });

  it("aponta a linha com valor inválido e recusa planilha sem as colunas", () => {
    const r = lerPlanilha("id;preco\nx;10\ny;dez\n");
    expect(r.linhas).toHaveLength(1);
    expect(r.erros).toEqual(['Linha 3: valor inválido "dez"']);
    expect(lerPlanilha("nome;valor\na;1").erros[0]).toMatch(/faltam as colunas/);
  });
});
