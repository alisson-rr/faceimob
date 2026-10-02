import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiasSemTravaDeIp } from "./DiasSemTravaDeIp";

/** Os 14 dias a partir da data da operação, com o liberado marcado (0191). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/checkin", () => ({ getCurrentWorkDate: async () => "2026-10-02" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ gte: async () => ({ data: [{ dia: "2026-10-03" }], error: null }) }) }),
  },
}));

describe("DiasSemTravaDeIp", () => {
  it("mostra hoje e os próximos 13 dias, com sábado liberado", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}><DiasSemTravaDeIp podeEditar /></QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const dias = Array.from(container.querySelectorAll("button[aria-pressed]"));
    expect(dias).toHaveLength(14);
    expect(dias[0].textContent).toContain("hoje");
    expect(dias[0].textContent).toContain("02/10");
    expect(dias[1].textContent).toMatch(/sáb/i);
    expect(dias[1].getAttribute("aria-pressed")).toBe("true");
    expect(dias[2].getAttribute("aria-pressed")).toBe("false");
    expect(dias[13].textContent).toContain("15/10");
    await act(async () => root.unmount());
  });
});
