import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Troca do mês-base pelo gerente: sem mês novo e motivo, nada vai ao banco (0201). */
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MesBaseComMotivo } from "./MesBaseComMotivo";

let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; });

describe("MesBaseComMotivo", () => {
  it("abre o pedido e só libera a troca com mês novo e motivo", async () => {
    const el = document.body.appendChild(document.createElement("div"));
    root = createRoot(el);
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MesBaseComMotivo dealId="d1" atual="10/2026" opcoes={[{ value: "10/2026", label: "outubro/2026" }, { value: "11/2026", label: "novembro/2026" }]} onTrocado={vi.fn()} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(el.textContent).toContain("Alterar com motivo"));
    el.querySelector("button")?.click();
    const confirmar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Alterar mês-base");
    await vi.waitFor(() => expect(confirmar()).toBeTruthy());
    expect(confirmar()?.disabled).toBe(true);
    expect(document.body.textContent).toContain("O motivo fica registrado nos comentários");
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
