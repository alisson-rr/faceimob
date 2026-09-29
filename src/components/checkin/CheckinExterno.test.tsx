import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinExterno } from "./CheckinExterno";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/pipeline/data", () => ({
  usePeople: () => ({
    isPending: false, error: null,
    data: [
      { id: "dirce", name: "Dirce Diretora", roles: ["director"], active: true },
      { id: "caio", name: "Caio Corretor", roles: ["broker"], active: true },
    ],
  }),
}));
vi.mock("@/integrations/supabase/checkin", () => ({
  directorExternalCheckin: vi.fn(async () => undefined),
  listTodayExternalCheckins: async () => [{
    id: "c1", profile_id: "caio", checked_in_at: "2026-09-29T12:00:00Z",
    external_reason: "Plantão no estande do Jardim", external_by: "dirce",
  }],
}));

let root: Root;
let container: HTMLDivElement;

async function montar() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><CheckinExterno selfId="dirce" /></QueryClientProvider>);
  });
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const digitar = async (campo: HTMLTextAreaElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// Pedido de 29/09/2026: o diretor faz o ponto do plantão, com motivo registrado.
describe("CheckinExterno", () => {
  it("lista o check-in externo do dia com quem fez e o motivo", async () => {
    await montar();
    await vi.waitFor(() => expect(container.textContent).toContain("Plantão no estande do Jardim"));
    expect(container.textContent).toContain("Caio Corretor");
    expect(container.textContent).toContain("por Dirce Diretora");
  });

  it("sem corretor e motivo o botão não envia; motivo curto diz o que falta", async () => {
    await montar();
    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent === "Fazer check-in externo")!;
    expect(botao.disabled).toBe(true);
    await digitar(container.querySelector<HTMLTextAreaElement>("#checkin-externo-motivo")!, "abc");
    expect(container.textContent).toContain("pelo menos 5 letras");
    expect(botao.disabled).toBe(true);
  });
});
