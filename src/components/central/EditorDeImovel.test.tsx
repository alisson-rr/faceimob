import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorDeImovel } from "./EditorDeImovel";

/**
 * Cadastro do imóvel no CRM (05/10/2026): o novo nasce com o próximo código e o
 * endereço do site sai do nome; sem nome não salva; book e fotos só depois de
 * criar.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ salvar: vi.fn(async () => "novo-id"), toast: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast }));
vi.mock("@/integrations/supabase/siteImoveis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/siteImoveis")>()),
  proximoCodigo: async () => "FI-042",
  salvarFicha: h.salvar,
}));

let root: Root;
let el: HTMLDivElement;

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  vi.clearAllMocks();
});

const digitar = (input: HTMLInputElement, valor: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function abrirNovo(onCriado = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <EditorDeImovel id={null} construtoras={["Sul"]} onFechar={vi.fn()} onCriado={onCriado} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return onCriado;
}

const campo = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`);
const botao = (texto: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(texto));

describe("cadastro de imóvel no CRM", () => {
  it("novo imóvel: código sugerido, endereço do site pelo nome e sem fotos antes de criar", async () => {
    await abrirNovo();
    expect(campo("im-code")?.value).toBe("FI-042");
    act(() => digitar(campo("im-title")!, "Solar do Bosque Ávila"));
    expect(campo("im-slug")?.value).toBe("solar-do-bosque-avila");
    expect(el.textContent).toContain("Fotos e book liberam depois de criar o imóvel.");
  });

  it("sem nome e cidade não salva; com eles cria e abre o imóvel criado", async () => {
    const onCriado = await abrirNovo();
    await act(async () => botao("Criar imóvel")?.click());
    expect(h.salvar).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));

    act(() => digitar(campo("im-title")!, "Solar"));
    act(() => digitar(campo("im-city")!, "Canoas"));
    await act(async () => botao("Criar imóvel")?.click());
    expect(h.salvar).toHaveBeenCalledWith(null, expect.objectContaining({ title: "Solar", city: "Canoas", code: "FI-042" }), expect.anything());
    expect(onCriado).toHaveBeenCalledWith("novo-id");
  });
});
