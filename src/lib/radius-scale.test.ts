import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava da escala de raio (pedido de 17/09/2026, "cantos menos arredondados").
 *
 * Existe porque a escala e feita de `calc()` sobre um token: baixar o
 * `--radius` sem mexer nos degraus derruba o menor deles para zero (canto vivo)
 * ou para negativo (o navegador descarta a regra e o canto volta a ser quadrado)
 * — e ninguem percebe, porque nada quebra em build. O mesmo token ainda paga o
 * recuo do `.gold-hairline`, que precisa ser o raio do cartao, senao o filete
 * dourado passa por cima da curva do canto.
 *
 * Le o CSS e o config de verdade, nao uma copia dos numeros — mesmo feitio do
 * `theme-contrast.test.ts`.
 */

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const config = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
/** Onde vivem os estilos que o Recharts pede em `style` e nao em classe. */
const toneTs = readFileSync(resolve(__dirname, "./tone.ts"), "utf8");

/** `--radius` do `:root`, em px. */
const raiz = (() => {
  const achado = /--radius:\s*([\d.]+)rem;/.exec(css);
  if (!achado) throw new Error("--radius nao encontrado em index.css");
  return Number(achado[1]) * 16;
})();

/** `var(--radius)` ou `calc(var(--radius) +- Npx)` resolvido em px. */
const emPx = (expressao: string): number => {
  const achado = /^calc\(var\(--radius\)\s*([+-])\s*(\d+)px\)$|^var\(--radius\)$/.exec(expressao.trim());
  if (!achado) throw new Error(`degrau fora do padrao calc(var(--radius) +- Npx): ${expressao}`);
  const [, sinal, valor] = achado;
  return sinal ? raiz + (sinal === "-" ? -Number(valor) : Number(valor)) : raiz;
};

const escala = (() => {
  const bloco = /borderRadius:\s*\{([\s\S]*?)\n\s*\},/.exec(config);
  if (!bloco) throw new Error("borderRadius nao encontrado em tailwind.config.ts");
  return [...bloco[1].matchAll(/"?([\da-z]+)"?:\s*"([^"]+)"/g)].map(([, nome, valor]) => [nome, emPx(valor)] as const);
})();

describe("escala de raio", () => {
  it("tem os seis degraus na ordem esperada", () => {
    expect(escala.map(([nome]) => nome)).toEqual(["sm", "md", "lg", "xl", "2xl", "3xl"]);
  });

  it("cresce a cada degrau e nunca chega a canto vivo", () => {
    let anterior = 0;
    for (const [nome, px] of escala) {
      expect(px, `${nome} precisa ser maior que o degrau anterior`).toBeGreaterThan(anterior);
      anterior = px;
    }
    expect(escala[0][1], "o menor degrau nao pode zerar").toBeGreaterThanOrEqual(2);
  });

  it("mantem o cartao mais arredondado que o campo, e os dois discretos", () => {
    const px = Object.fromEntries(escala);
    // `rounded-2xl` = cartao, `rounded-xl` = campo e cartao interno.
    expect(px.xl).toBeLessThan(px["2xl"]);
    expect(px["2xl"]).toBeLessThanOrEqual(8);
  });

  it("nao deixa raio literal no estilo dos graficos", () => {
    // O tooltip do Recharts nao aceita classe: o raio dele e `style`. Escrito
    // como numero (era `0.75rem`), ficou parado em 12 px quando a escala desceu
    // e virou a superficie MAIS arredondada do app, flutuando sobre cartoes de
    // 8 px. Tem de sair do mesmo token que todo o resto.
    const literais = [...toneTs.matchAll(/borderRadius:\s*"([^"]+)"/g)]
      .map(([, valor]) => valor)
      .filter((valor) => !valor.includes("var(--radius)"));
    expect(literais).toEqual([]);
  });

  it("recua o filete dourado exatamente pelo raio do cartao", () => {
    const filete = /\.gold-hairline::before\s*\{[\s\S]*?inset:\s*0\s+([^;]+?)\s+auto;/.exec(css);
    if (!filete) throw new Error(".gold-hairline::before sem inset em index.css");
    expect(emPx(filete[1])).toBe(Object.fromEntries(escala)["2xl"]);
  });
});
