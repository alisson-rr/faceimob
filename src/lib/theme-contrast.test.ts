import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava de contraste da paleta.
 *
 * A regra "AA nos dois temas" e o unico motivo de os tokens terem os valores
 * que tem — sem esta verificacao, um ajuste de meio ponto de luminosidade em
 * `index.css` derruba a legibilidade e ninguem percebe ate a tela estar em
 * producao. Le o CSS de verdade, nao uma copia dos numeros.
 */

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/**
 * Corpo do bloco do seletor. Casa a ABERTURA do bloco (`^  .light {`), nao o
 * texto solto: o comentario do topo cita `.light` e um `indexOf` simples pegava
 * aquela mencao, media o `:root` duas vezes e dava tudo verde sem nunca ter
 * olhado para o tema claro.
 */
const bloco = (seletor: string) => {
  const abertura = new RegExp(`^\\s*${seletor.replace(".", "\\.")}\\s*\\{`, "m");
  const encontrado = abertura.exec(css);
  if (!encontrado) throw new Error(`bloco ${seletor} nao encontrado em index.css`);
  const abre = encontrado.index + encontrado[0].length - 1;
  const fecha = css.indexOf("}", abre);
  return css.slice(abre, fecha);
};

const tokens = (seletor: string): Record<string, string> => {
  const mapa: Record<string, string> = {};
  for (const [, nome, valor] of bloco(seletor).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    mapa[nome] = valor.trim();
  }
  return mapa;
};

/** Luminancia relativa (WCAG 2.x) de um token HSL no formato "H S% L%". */
const luminancia = (hsl: string): number => {
  const [h, s, l] = hsl.split(/\s+/).map((parte) => Number.parseFloat(parte));
  expect([h, s, l].every(Number.isFinite), `token invalido: "${hsl}"`).toBe(true);
  const sat = s / 100;
  const luz = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(luz, 1 - luz);
  const canal = (n: number) => luz - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(canal(0)) + 0.7152 * linear(canal(8)) + 0.0722 * linear(canal(4));
};

const razao = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** [frente, fundo, minimo] — 4,5 para texto, 3 para elemento de interface. */
const PARES: [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  // Bloco de codigo (`<pre>` do GoalCard e do MetaAdsSetup) e o unico lugar
  // onde `muted` e superficie de leitura, nao so preenchimento neutro.
  ["muted-foreground", "muted", 4.5],
  ["primary", "background", 4.5],
  ["primary", "card", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["destructive", "background", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["success", "background", 4.5],
  ["success-foreground", "success", 4.5],
  ["warning", "background", 4.5],
  ["warning-foreground", "warning", 4.5],
  ["info", "background", 4.5],
  ["info-foreground", "info", 4.5],
  // `highlight` e token de FUNDO: nao existe par "highlight sobre background"
  // de proposito — no claro daria 1,6:1. Amarelo em texto usa `warning`.
  ["highlight-foreground", "highlight", 4.5],
  ["gold", "card", 4.5],
  ["silver", "card", 4.5],
  ["bronze", "card", 4.5],
  ["gold-foreground", "gold", 4.5],
  ["silver-foreground", "silver", 4.5],
  ["bronze-foreground", "bronze", 4.5],
  ["sidebar-foreground", "sidebar-background", 4.5],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5],
  // Contorno de campo precisa ser identificavel (WCAG 1.4.11).
  ["input", "card", 3],
  ["input", "background", 3],
  // Serie de grafico e objeto grafico, nao texto.
  ["chart-1", "card", 3],
  ["chart-2", "card", 3],
  ["chart-3", "card", 3],
  ["chart-4", "card", 3],
  ["chart-5", "card", 3],
];

describe.each([
  ["escuro", ":root"],
  ["claro", ".light"],
])("paleta — tema %s", (_nome, seletor) => {
  const mapa = tokens(seletor);
  // O tema claro so redefine o que muda; o resto herda do :root.
  const base = seletor === ".light" ? { ...tokens(":root"), ...mapa } : mapa;

  it.each(PARES)("%s sobre %s tem pelo menos %s:1", (frente, fundo, minimo) => {
    expect(base[frente], `token --${frente} ausente`).toBeDefined();
    expect(base[fundo], `token --${fundo} ausente`).toBeDefined();
    const valor = razao(luminancia(base[frente]), luminancia(base[fundo]));
    expect(Number(valor.toFixed(2))).toBeGreaterThanOrEqual(minimo);
  });
});

describe("tokens", () => {
  it("todo token do tema escuro tem par no tailwind.config.ts", () => {
    const config = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
    // Achado T01: token no CSS sem espelho no Tailwind compila zero regras e a
    // classe some em silencio.
    const semEspelho = Object.keys(tokens(":root"))
      .filter((nome) => !nome.endsWith("-foreground") && nome !== "radius")
      .filter((nome) => !config.includes(`--${nome}`) && !config.includes(`"${nome.replace("sidebar-", "")}"`));
    expect(semEspelho).toEqual([]);
  });
});
