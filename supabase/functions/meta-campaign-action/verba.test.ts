// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { conjuntosComVerba, escalarConjuntos, verbaDaCampanha } from "./verba.ts";

/**
 * Verba de campanha na Meta, que é dinheiro de verdade.
 *
 * O que não pode voltar: o erro do sistema antigo, que gravava o valor cheio em
 * cada conjunto de ABO (2 conjuntos com R$ 100 viravam R$ 200 por dia); um
 * centavo que some no arredondamento; e o executor mexendo numa campanha antes
 * de conferir, na Meta, de que conta ela é.
 */

const c = (id: string, centavos: number) => ({ id, daily_budget_centavos: centavos });
const soma = (r: { para: number }[]) => r.reduce((s, x) => s + x.para, 0);

describe("escalarConjuntos", () => {
  it("mantém a proporção: conjuntos de R$ 60 e R$ 40 para R$ 150 viram R$ 90 e R$ 60", () => {
    expect(escalarConjuntos([c("a", 6000), c("b", 4000)], 15000)).toEqual([
      { id: "a", de: 6000, para: 9000 },
      { id: "b", de: 4000, para: 6000 },
    ]);
  });

  it("o arredondamento fecha o total: o centavo que sobra vai para a maior fração", () => {
    const iguais = escalarConjuntos([c("a", 1000), c("b", 1000), c("c", 1000)], 10000);
    expect(iguais.map((x) => x.para)).toEqual([3334, 3333, 3333]);
    expect(soma(iguais)).toBe(10000);

    // 333,3 e 666,7: o centavo vai para o de fração ,7 — não para o primeiro da lista.
    const desiguais = escalarConjuntos([c("a", 3333), c("b", 6667)], 1000);
    expect(desiguais.map((x) => x.para)).toEqual([333, 667]);
  });

  it("nenhum conjunto fica abaixo de 100 centavos, e a soma continua fechando", () => {
    expect(escalarConjuntos([c("a", 9900), c("b", 100)], 1000)).toEqual([
      { id: "a", de: 9900, para: 900 },
      { id: "b", de: 100, para: 100 },
    ]);
  });

  it("recusa em vez de devolver um valor perto do pedido", () => {
    expect(() => escalarConjuntos([c("a", 500), c("b", 500)], 150)).toThrow(/mínimo de R\$ 1,00/);
    expect(() => escalarConjuntos([], 1000)).toThrow(RangeError);
    expect(() => escalarConjuntos([c("a", 500)], 99.5)).toThrow(RangeError);
  });
});

describe("verba lida ao vivo", () => {
  it("CBO, verba total ou ABO pelo que a Meta devolveu agora", () => {
    expect(verbaDaCampanha({ daily_budget: "10000" })).toEqual({ nivel: "campaign", centavos: 10000 });
    expect(verbaDaCampanha({ lifetime_budget: "500000" })).toEqual({ nivel: "lifetime" });
    expect(verbaDaCampanha({ daily_budget: "0" })).toEqual({ nivel: "adset" });
  });

  it("em ABO só entram conjuntos ativos com verba diária; ativo com verba total é recusado", () => {
    expect(
      conjuntosComVerba([
        { id: "1", name: "Conjunto A", status: "ACTIVE", daily_budget: "6000" },
        { id: "2", name: "Conjunto B", status: "PAUSED", daily_budget: "4000" },
      ]),
    ).toEqual([{ id: "1", nome: "Conjunto A", daily_budget_centavos: 6000 }]);
    expect(() => conjuntosComVerba([{ id: "1", status: "ACTIVE", lifetime_budget: "90000" }])).toThrow(/verba total/);
  });
});

describe("executor (leitura do fonte de index.ts)", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

  it("lê account_id na Meta e confere o dono antes de qualquer metaPost", () => {
    const posts = [...fonte.matchAll(/metaPost\(/g)].map((m) => m.index ?? -1);
    const leitura = fonte.indexOf('fields: "account_id');
    const dono = fonte.indexOf("await conferirDono(");
    expect(posts.length).toBeGreaterThan(0);
    expect(leitura).toBeGreaterThan(-1);
    expect(dono).toBeGreaterThan(leitura);
    expect(Math.min(...posts)).toBeGreaterThan(dono);
  });

  it("só fala com a Meta pelo cliente compartilhado (token no header, nunca na URL)", () => {
    expect(fonte).not.toMatch(/access_token|fetch\(|graph\.facebook\.com/);
  });
});
