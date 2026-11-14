import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiasSemTravaDeIp } from "./DiasSemTravaDeIp";

/** Os 7 dias a partir da data da operação, com o liberado marcado (0191). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/checkin", () => ({ getCurrentWorkDate: async () => "2026-10-02" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ gte: async () => ({ data: [{ dia: "2026-10-06" }], error: null }) }) }),
    // 0334: sábado e domingo chegam do banco como livres sozinhos.
    rpc: async () => ({
      data: [{ dia: "2026-10-03", motivo: "Fim de semana" }, { dia: "2026-10-04", motivo: "Fim de semana" }],
      error: null,
    }),
  },
}));

describe("DiasSemTravaDeIp", () => {
  it("mostra o fim de semana livre sozinho e o dia marcado à mão como botão", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}><DiasSemTravaDeIp podeEditar /></QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const botoes = Array.from(container.querySelectorAll("button[aria-pressed]"));
    expect(botoes).toHaveLength(5);
    expect(botoes[0].textContent).toContain("hoje");
    expect(botoes[0].textContent).toContain("02/10");
    expect(botoes[1].textContent).toContain("05/10");
    expect(botoes[2].textContent).toContain("06/10");
    expect(botoes[2].getAttribute("aria-pressed")).toBe("true");
    expect(botoes[1].getAttribute("aria-pressed")).toBe("false");
    const automaticos = Array.from(container.querySelectorAll("[title^='Liberado sozinho']"));
    expect(automaticos).toHaveLength(2);
    expect(automaticos[0].textContent).toMatch(/sáb.*03\/10.*Fim de semana/i);
    await act(async () => root.unmount());
  });
});
