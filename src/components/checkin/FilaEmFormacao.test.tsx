import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Fila em formação: todo usuário autenticado vê; ordem e situação vêm do banco. */
const m = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, linhas: [] as unknown[], rpc: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/integrations/supabase/client", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      rpc: (...args: unknown[]) => { m.rpc(...args); return Promise.resolve({ data: m.linhas, error: null }); },
      channel: () => canal,
      removeChannel: () => Promise.resolve(),
    },
  };
});

import { FilaEmFormacao } from "./FilaEmFormacao";

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  m.rpc.mockClear();
});

function montar() {
  const el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
  root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <span data-pronto="" />
      <FilaEmFormacao />
    </QueryClientProvider>,
  );
  return el;
}

const linha = (nome: string, posicao: number | null, situacao: string, extra = {}) => ({
  group_id: "g1", group_name: "Roleta Centro", profile_id: nome, full_name: nome, posicao, situacao,
  checked_in_at: "2026-10-03T11:05:00Z", abre_as: "08:30", last_turn_at: null, atrasados: 0, ...extra,
});

describe("FilaEmFormacao", () => {
  it("mostra a hora em que a pessoa voltou à fila, não só o check-in (0263)", async () => {
    m.user = { id: "admin" };
    m.linhas = [
      linha("Angela", 1, "na_fila", { checked_in_at: "2026-10-10T12:28:00Z" }),
      linha("Julia", 2, "na_fila", { checked_in_at: "2026-10-10T12:04:00Z", last_turn_at: "2026-10-10T12:40:00Z" }),
    ];
    const el = montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Julia"));
    const itens = [...el.querySelectorAll("li")].map((li) => li.textContent);
    expect(itens[0]).toContain("09:28");
    expect(itens[1]).toContain("voltou 09:40");
  });

  it("mostra ao admin a ordem, quem aguarda a abertura e quem está bloqueado", async () => {
    m.user = { id: "admin" };
    m.linhas = [linha("Ana", 1, "aguardando"), linha("Bia", 2, "aguardando"), linha("Caio", null, "bloqueado", { atrasados: 3 })];
    const el = montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Ana"));
    expect(m.rpc).toHaveBeenCalledWith("fila_em_formacao");
    const itens = [...el.querySelectorAll("li")].map((li) => li.textContent);
    expect(itens[0]).toContain("1º");
    expect(itens[0]).toContain("abre 08:30");
    expect(itens[2]).toContain("3 atrasado(s)");
    expect(el.textContent).toContain("2 corretor(es) em check-in hoje");
  });

  it("também aparece e consulta para usuário autenticado que não é admin", async () => {
    m.user = { id: "corretor" };
    m.linhas = [linha("Corretor", 1, "na_fila")];
    const el = montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Corretor"));
    expect(m.rpc).toHaveBeenCalledWith("fila_em_formacao");
  });
});
