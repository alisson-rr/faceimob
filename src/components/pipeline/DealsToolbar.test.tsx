import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DealsToolbar } from "./DealsToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A régua de contadores não afirma sobre o banco antes de ler o banco.
 *
 * Com a listagem ainda em voo, `activeCount`/`listedCount`/`pendingReviews`
 * chegam em 0 — e a régua escrevia "0 ativos · 0 na listagem · 0 aguardando
 * gerente", que é uma afirmação, não um estado de espera. É o mesmo achado que
 * o `DealsBoard` corrigiu um nível abaixo: dado ausente vira travessão.
 */
async function render(countsUnknown: boolean) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DealsToolbar
        search=""
        onSearch={() => undefined}
        view="table"
        onView={() => undefined}
        analyticsOpen={false}
        onToggleAnalytics={() => undefined}
        activeCount={0}
        listedCount={0}
        pendingReviews={0}
        onFilterPendingReviews={() => undefined}
        countsUnknown={countsUnknown}
      /> as ReactNode,
    );
  });
  const filtrar = container.querySelector<HTMLButtonElement>("button:not([aria-label])");
  const resultado = {
    texto: (container.textContent ?? "").replace(/\s+/g, " "),
    filtroDesabilitado: Boolean(filtrar?.disabled),
  };
  await act(async () => { root.unmount(); });
  container.remove();
  return resultado;
}

describe("DealsToolbar · contadores antes da resposta", () => {
  it("com a consulta em voo (ou falhada) os contadores viram travessão", async () => {
    const { texto } = await render(true);
    expect(texto).toContain("— ativos");
    expect(texto).toContain("— na listagem");
    expect(texto).toContain("— aguardando gerente");
    expect(texto, "zero é afirmação, não espera").not.toContain("0 ativos");
  });

  it("filtrar por 'aguardando gerente' espera a resposta", async () => {
    expect((await render(true)).filtroDesabilitado).toBe(true);
    expect((await render(false)).filtroDesabilitado).toBe(false);
  });

  it("com a resposta na mão, zero volta a ser zero", async () => {
    const { texto } = await render(false);
    expect(texto).toContain("0 ativos");
    expect(texto).toContain("0 aguardando gerente");
  });
});
