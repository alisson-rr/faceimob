import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * O cache que substituiu a carga manual de Links (e das outras telas da zona,
 * que seguem o mesmo molde) tem dois riscos que a carga manual não tinha: a
 * leitura de uma pessoa sobreviver ao logout, e uma releitura em voo — feita
 * antes de uma gravação — desfazer na tela o que acabou de ser gravado.
 */

type Linha = { id: string; label: string; url: string; category: string | null; sort_order: number; active: boolean };

const banco = vi.hoisted(() => ({
  linhas: [] as Linha[],
  /** Leituras em voo, na ordem em que saíram; cada uma fotografa o banco na saída. */
  leituras: [] as (() => void)[],
  userId: "admin",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => {
            const foto = banco.linhas.map((l) => ({ ...l }));
            return new Promise((resolve) => banco.leituras.push(() => resolve({ data: foto, error: null })));
          },
        }),
      }),
      update: (mudanca: Partial<Linha>) => ({
        eq: (_coluna: string, id: string) => ({
          select: async () => {
            banco.linhas = banco.linhas.map((l) => (l.id === id ? { ...l, ...mudanca } : l));
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: banco.userId } }),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const { default: Links } = await import("./Links");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

const linha = (over: Partial<Linha>): Linha => ({
  id: "l1", label: "Receita", url: "https://exemplo.com", category: "consultas", sort_order: 0, active: true, ...over,
});

/** O TanStack Query avisa a tela num `setTimeout(0)` depois de a leitura resolver: um ciclo só não basta. */
async function esperar() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

async function montar() {
  root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Links /></QueryClientProvider>);
  });
  await esperar();
}

/** Entrega as leituras em voo, na ordem em que saíram. */
async function liberarLeituras() {
  await esperar();
  while (banco.leituras.length) {
    banco.leituras.shift()!();
    await esperar();
  }
}

beforeEach(() => {
  banco.linhas = [];
  banco.leituras = [];
  banco.userId = "admin";
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
});

describe("Links · cache", () => {
  it("quem entra depois no mesmo navegador não vê a lista de quem saiu", async () => {
    banco.userId = "diretor";
    banco.linhas = [linha({ label: "Link do diretor" })];
    await montar();
    await liberarLeituras();
    expect(container.textContent).toContain("Link do diretor");

    act(() => root.unmount());
    banco.userId = "corretor";
    await montar();

    // A leitura do corretor ainda não voltou: nada de quem saiu na tela.
    expect(container.textContent).not.toContain("Link do diretor");
  });

  it("desativar com uma releitura em voo não volta a mostrar o link ativo", async () => {
    banco.linhas = [linha({ active: true })];
    await montar();
    await liberarLeituras();
    const chave = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(chave().getAttribute("aria-checked")).toBe("true");

    // Releitura saindo com o link ainda ativo (salvar outro link, voltar à tela…).
    await act(async () => { void client.invalidateQueries({ queryKey: ["links"] }); });
    await act(async () => { chave().click(); });
    await esperar();
    await liberarLeituras();

    expect(banco.linhas[0].active).toBe(false);
    expect(chave().getAttribute("aria-checked")).toBe("false");
  });
});
