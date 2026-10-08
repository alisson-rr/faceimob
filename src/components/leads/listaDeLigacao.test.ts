import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { embaralhar, intercalarCampanhas, lerLinhas, montarListaPdf, paraPdf } from "./listaDeLigacao";

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

  it("embaralha sem perder nem repetir ninguém", () => {
    const itens = Array.from({ length: 20 }, (_, i) => i);
    let semente = 7;
    const sorteio = () => ((semente = (semente * 9301 + 49297) % 233280) / 233280);
    const misturado = embaralhar(itens, sorteio);
    expect(misturado).not.toEqual(itens);
    expect([...misturado].sort((a, b) => a - b)).toEqual(itens);
  });

  it("intercala campanhas em vez de gerar blocos contínuos", () => {
    const linhas = [
      ...Array.from({ length: 4 }, (_, i) => ({ campanha: "Bella Citta", cliente: `B${i}`, telefone: `51${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ campanha: "Park", cliente: `P${i}`, telefone: `52${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ campanha: "Solar", cliente: `S${i}`, telefone: `53${i}` })),
    ];
    const resultado = intercalarCampanhas(linhas, () => 0.4);
    expect(resultado).toHaveLength(linhas.length);
    expect(new Set(resultado.map((item) => item.cliente)).size).toBe(linhas.length);
    expect(resultado.slice(0, 6).map((item) => item.campanha)).not.toEqual([
      "Bella Citta", "Bella Citta", "Bella Citta", "Bella Citta", "Park", "Park",
    ]);
    for (let i = 1; i < 6; i += 1) {
      expect(resultado[i].campanha).not.toBe(resultado[i - 1].campanha);
    }
  });
});
