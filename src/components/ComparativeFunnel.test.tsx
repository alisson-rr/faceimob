import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ComparativeFunnel from "./ComparativeFunnel";
import type { FunnelCounts } from "@/lib/metrics";

// Sem @testing-library no projeto, o render é o do react-dom mesmo; a flag é o
// que faz `act` aceitar o jsdom como ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZERADO: FunnelCounts = { leads: 0, analises: 0, aprovados: 0, vendas: 0 };

/**
 * Devolve o rótulo de aderência de cada cartão "Declarado × medido" e o HTML
 * inteiro. Só esses cartões terminam em `<p>` direto sob o `<li>` — os funis e
 * a lista etapa a etapa não —, então o seletor isola o bloco que mentia.
 */
async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  const html = container.innerHTML;
  const aderencias = Array.from(container.querySelectorAll("li > p:last-child")).map((p) => p.textContent);
  await act(async () => { root.unmount(); });
  container.remove();
  return { html, aderencias };
}

describe("ComparativeFunnel · Declarado × medido", () => {
  it("sem dado de nenhum lado, os quatro cartões dizem 'sem dados' e nenhum fica verde", async () => {
    const { html, aderencias } = await render(<ComparativeFunnel daily={ZERADO} pipeline={ZERADO} />);

    expect(aderencias).toEqual(Array(4).fill("sem dados no período"));
    // A barra de aderência some inteira; o trilho `bg-muted` fica. Nenhum outro
    // bloco pinta `bg-success` com tudo zerado, então qualquer ocorrência seria
    // a barra afirmando 100% a partir do nada.
    expect(html).not.toContain("100% de aderência");
    expect(html).not.toContain("bg-success");
  });

  it("declarado sem nada medido é 0%; com medida é a proporção, com teto em 100", async () => {
    const { aderencias } = await render(
      <ComparativeFunnel
        daily={{ leads: 5, analises: 9, aprovados: 12, vendas: 0 }}
        pipeline={{ leads: 0, analises: 10, aprovados: 10, vendas: 0 }}
      />,
    );

    expect(aderencias).toEqual([
      "0% de aderência",
      "90% de aderência",
      "100% de aderência",
      "sem dados no período",
    ]);
  });
});
