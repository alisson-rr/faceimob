import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Diretoria no Dashboard do gerente: totais e equipes vêm da RPC (0202). */
const m = vi.hoisted(() => ({ roles: ["manager"] as string[], linhas: [] as unknown[], rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ roles: m.roles }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => { m.rpc(...a); return Promise.resolve({ data: m.linhas, error: null }); } },
}));

import { ResumoDaDiretoria } from "./ResumoDaDiretoria";

let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; m.rpc.mockClear(); });

function montar() {
  const el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <span data-pronto="" />
      <ResumoDaDiretoria month="10/2026" />
    </QueryClientProvider>,
  );
  return el;
}

const linha = (team: string, vendas: number) => ({
  director_id: "d1", director_name: "Diretora Ana", team_id: team, team_name: team, manager_name: `Gerente ${team}`,
  vendas, vgv: vendas * 100000, total_vendas: 5, total_vgv: 500000,
});

describe("ResumoDaDiretoria", () => {
  it("mostra ao gerente o total da diretoria e cada equipe", async () => {
    m.roles = ["manager"];
    m.linhas = [linha("Equipe A", 3), linha("Equipe B", 2)];
    const el = montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Diretoria · Diretora Ana"));
    expect(m.rpc).toHaveBeenCalledWith("resumo_da_diretoria", { p_mes: "2026-10-01" });
    expect(el.textContent).toContain("Vendas da diretoria5");
    expect(el.querySelectorAll("li")).toHaveLength(2);
  });

  it("corretor não vê nem consulta", async () => {
    m.roles = ["broker"];
    const el = montar();
    await vi.waitFor(() => expect(el.querySelector("[data-pronto]")).not.toBeNull());
    expect(el.textContent).toBe("");
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
