import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dealStatusKeys } from "@/integrations/supabase/dealStatuses";
import { catalogoDeTeste } from "./statusCatalog.fixture";
import { DealStatusSettingsDialog } from "./DealStatusSettingsDialog";

/**
 * Foco de quem usa só o teclado no cadastro de status.
 *
 * Reordenar grava na hora (otimista). Quando a linha só muda de lugar, o próprio
 * React devolve o foco ao botão depois do commit (`restoreSelection`). Ele não
 * consegue quando o botão apertado fica desabilitado no limite da lista: o foco
 * caía e o `FocusScope` do Radix o levava ao topo do diálogo. Trocar o Status 1
 * de um Status 2 cai pelo mesmo caminho (a linha remonta em outra seção); ele
 * não tem caso aqui porque abrir o Select do Radix no jsdom não é confiável.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./data", () => ({ useInvalidateDeals: () => async () => undefined }));
// A releitura depois de gravar nunca responde: vale a ordem otimista, e o teste
// não vai à rede.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => new Promise(() => undefined) }) },
}));
vi.mock("@/integrations/supabase/dealStatuses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/dealStatuses")>()),
  updateDealStatusGroup: vi.fn(async () => undefined),
  updateDealStatus: vi.fn(async () => undefined),
}));

let root: Root;
let container: HTMLElement;
let queryClient: QueryClient;

beforeEach(async () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(dealStatusKeys.catalog, catalogoDeTeste);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DealStatusSettingsDialog onClose={() => undefined} />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  queryClient.clear();
});

const botao = (nome: string) => {
  const alvo = document.querySelector<HTMLButtonElement>(`button[aria-label="${nome}"]`);
  if (!alvo) throw new Error(`o botão "${nome}" sumiu do diálogo`);
  return alvo;
};

/** A gravação otimista passa por `await` e pelo agendador do TanStack Query. */
const esperarGravacao = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const ordemDosGrupos = () => [...document.querySelectorAll('[role="group"][aria-label^="Status 1 "]')]
  .map((linha) => linha.getAttribute("aria-label"));

describe("DealStatusSettingsDialog · foco ao reordenar", () => {
  it("Descer até o fim da lista desabilita o botão e o foco passa ao Subir da mesma linha", async () => {
    botao("Descer DISTRATO").focus();
    await act(async () => { botao("Descer DISTRATO").click(); });
    await esperarGravacao();

    expect(ordemDosGrupos().slice(-2), "a lista não reordenou: o teste não exercitou nada")
      .toEqual(["Status 1 OFF", "Status 1 DISTRATO"]);
    expect(botao("Descer DISTRATO").disabled).toBe(true);
    expect(document.activeElement, "o foco caiu no topo do diálogo").toBe(botao("Subir DISTRATO"));
  });
});
