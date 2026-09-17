import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PodiumCards } from "./PodiumCards";
import type { PodiumEntry } from "./Podium";

// Sem @testing-library no projeto, o render é o do react-dom mesmo; a flag é o
// que faz `act` aceitar o jsdom como ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRIO: PodiumEntry[] = [
  { id: "a", name: "Kayteane Botelho Araujo", points: 360 },
  { id: "b", name: "Junior Moraes", points: 268 },
  { id: "c", name: "Marcelo Vergara", points: 255 },
];

async function render(entries: PodiumEntry[]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<PodiumCards entries={entries} />);
  });
  return { container, unmount: () => act(async () => root.unmount()) };
}

/**
 * O pódio do print do cliente (10/09/2026): prata à esquerda, OURO MAIOR NO
 * MEIO, bronze à direita — com o troféu do ranking do cabeçalho (17/09/2026).
 *
 * O que este arquivo trava é a parte que quebra em silêncio: a ordem visual e a
 * do DOM são diferentes de propósito, e trocar um `order-*` sem querer coroaria
 * o segundo colocado sem nenhum erro aparecer.
 */
describe("PodiumCards", () => {
  it("ouro fica no MEIO na tela e em PRIMEIRO no DOM", async () => {
    const { container, unmount } = await render(TRIO);
    const cartoes = Array.from(container.querySelectorAll("li"));

    // Leitor de tela e celular leem 1º, 2º, 3º.
    expect(cartoes.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Kayteane Botelho Araujo"),
      expect.stringContaining("Junior Moraes"),
      expect.stringContaining("Marcelo Vergara"),
    ]);
    // A grade de três colunas põe o ouro na do meio.
    expect(cartoes[0].className).toContain("sm:order-2");
    expect(cartoes[1].className).toContain("sm:order-1");
    expect(cartoes[2].className).toContain("sm:order-3");

    await unmount();
  });

  it("o cartão de ouro é o maior, e todos são neutros", async () => {
    const { container, unmount } = await render(TRIO);
    const cartoes = Array.from(container.querySelectorAll("li > div"));
    const [ouro, prata] = cartoes;

    // A medalha sumia porque tinha a cor do cartão: o fundo agora é `card`.
    cartoes.forEach((cartao) => {
      expect(cartao.className).toContain("bg-card");
      expect(cartao.className).not.toMatch(/bg-(gold|silver|bronze)|bg-gradient/);
    });
    // O crescimento do primeiro cartão só existe a partir do tablet.
    expect(ouro.className).toContain("sm:py-3.5");
    expect(prata.className).not.toContain("sm:py-3.5");

    await unmount();
  });

  it("o troféu é o do cabeçalho: colocação em primary e a cor do pódio", async () => {
    const { container, unmount } = await render(TRIO);
    const trofeus = Array.from(container.querySelectorAll("li svg.lucide-trophy"));

    expect(trofeus).toHaveLength(3);
    expect(trofeus.map((svg) => svg.getAttribute("class"))).toEqual([
      expect.stringContaining("text-gold"),
      expect.stringContaining("text-silver"),
      expect.stringContaining("text-bronze"),
    ]);
    expect(container.querySelector("li [aria-hidden] .text-primary")?.textContent).toBe("1º");

    await unmount();
  });

  it("a colocação aparece no troféu e também escrita, para o leitor de tela", async () => {
    const { container, unmount } = await render(TRIO);
    const ouro = container.querySelector("li");

    // O troféu é decorativo; quem anuncia a colocação é o texto `sr-only`.
    expect(ouro?.querySelector("[aria-hidden]")?.textContent).toBe("1º");
    expect(ouro?.querySelector(".sr-only")?.textContent).toBe("1º lugar: ");
    expect(ouro?.textContent).toContain("360 pontos");

    await unmount();
  });

  it("colocação congelada manda no troféu e na cor", async () => {
    // Temporada fechada vista por corretor: o primeiro do recorte pode ser o 5º
    // da casa, e coroá-lo de ouro brigaria com a tabela ao lado.
    const { container, unmount } = await render([{ ...TRIO[0], place: 5 }]);
    const trofeu = container.querySelector("li svg.lucide-trophy");

    // Fora do pódio o troféu fica apagado, como no cabeçalho.
    expect(trofeu?.getAttribute("class")).toContain("text-muted-foreground");
    expect(trofeu?.getAttribute("class")).not.toContain("text-gold");
    expect(container.querySelector("li [aria-hidden]")?.textContent).toBe("5º");
    expect(container.querySelector(".sr-only")?.textContent).toBe("5º lugar: ");

    await unmount();
  });
});
