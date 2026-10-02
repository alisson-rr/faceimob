import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { lerLinhas, montarListaPdf, paraPdf } from "./listaDeLigacao";

describe("lista de ligação", () => {
  it("valida as linhas da RPC e descarta quem não tem telefone", () => {
    expect(lerLinhas([
      { campanha: "[FORM] GERAL", cliente: "Ana", telefone: "51999990000" },
      { campanha: null, cliente: "", telefone: "51988880000" },
      { campanha: "X", cliente: "Sem fone", telefone: null },
    ])).toEqual([
      { campanha: "[FORM] GERAL", cliente: "Ana", telefone: "51999990000" },
      { campanha: "Sem campanha", cliente: "Sem nome", telefone: "51988880000" },
    ]);
    expect(lerLinhas(null)).toEqual([]);
  });

  it("PDF aceita acento e troca emoji, e quebra página na lista longa", async () => {
    expect(paraPdf("João Conceição 🏠")).toBe("João Conceição ?");
    const linhas = Array.from({ length: 120 }, (_, i) => ({
      campanha: `[FORM] CAMPANHA COM NOME BEM COMPRIDO QUE NÃO CABE ${i}`, cliente: `Cliente ${i}`, telefone: "51999990000",
    }));
    const pdf = await PDFDocument.load(await montarListaPdf(linhas));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
