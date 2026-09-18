import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ccaKeys, type CcaStage } from "./ccaData";
import { CcaStageSettingsDialog } from "./CcaStageSettingsDialog";

/**
 * "Avisar o comercial" e "Muda o status do negócio" (0155): o formulário grava
 * as duas opções e a lista diz, coluna a coluna, o que cada uma faz.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: async (payload: unknown) => { h.insert(payload); return { error: null }; },
      update: (payload: unknown) => {
        h.update(payload);
        return { eq: () => ({ select: async () => ({ data: [{ id: "x" }], error: null }) }) };
      },
    }),
  },
}));

const aprovado: CcaStage = {
  id: "s-aprovado", name: "APROVADO TOTAL", color: "#16A34A", position: 1, status: "approved",
  deal_status_id: "ds-aprov", notify_sales: true,
};
const controle: CcaStage = {
  id: "s-controle", name: "CONFERÊNCIA INTERNA", color: "#2563EB", position: 2, status: "under_review",
  deal_status_id: null, notify_sales: false,
};
// Ligada a um status que o catálogo filtrado não traz: o rótulo vem do quadro.
const esteira: CcaStage = {
  id: "s-esteira", name: "ESTEIRA ÁGIL", color: "#F59E0B", position: 3, status: "under_review",
  deal_status_id: "ds-esteira", deal_status: { label: "13. ESTEIRA AGIL" }, notify_sales: true,
};

let root: Root;
let container: HTMLElement;
let queryClient: QueryClient;

beforeEach(async () => {
  h.insert.mockClear();
  h.update.mockClear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(ccaKeys.statusOptions, [{ id: "ds-aprov", label: "09. APROV. TOTAL", active: true }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CcaStageSettingsDialog stages={[aprovado, controle, esteira]} onClose={() => undefined} onChanged={() => undefined} />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  queryClient.clear();
});

const el = <T extends Element>(seletor: string) => {
  const alvo = document.querySelector<T>(seletor);
  if (!alvo) throw new Error(`"${seletor}" sumiu do diálogo`);
  return alvo;
};
const clicar = (alvo: Element) => act(async () => { (alvo as HTMLElement).click(); });
const botaoComTexto = (texto: string) => {
  const alvo = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(texto));
  if (!alvo) throw new Error(`botão "${texto}" sumiu do diálogo`);
  return alvo;
};
const digitar = (input: HTMLInputElement, valor: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const linha = (nome: string) => {
  const item = [...document.querySelectorAll("li")].find((li) => li.textContent?.includes(nome));
  if (!item) throw new Error(`a coluna "${nome}" sumiu da lista`);
  return item.textContent ?? "";
};

describe("CcaStageSettingsDialog · avisa ou não, muda ou não o status", () => {
  it("a lista diz se a coluna avisa o comercial e o que grava", () => {
    expect(linha("APROVADO TOTAL")).toContain("Avisa o comercial");
    expect(linha("APROVADO TOTAL")).toContain("Grava: 09. APROV. TOTAL");
    expect(linha("CONFERÊNCIA INTERNA")).toContain("Movimento interno");
    expect(linha("CONFERÊNCIA INTERNA")).toContain("Não muda o status");
    expect(linha("CONFERÊNCIA INTERNA")).not.toContain("Avisa o comercial");
  });

  it("status fora do catálogo carregado: mostra o rótulo do quadro, não reticências", () => {
    expect(linha("ESTEIRA ÁGIL")).toContain("Grava: 13. ESTEIRA AGIL");
    expect(linha("ESTEIRA ÁGIL")).not.toContain("…");
  });

  it("coluna nova de movimento interno grava notify_sales false e nenhum status", async () => {
    // Nasce avisando e sem mudar o status, como as colunas de hoje.
    expect(el('[id="cca-stage-notify"]').getAttribute("aria-checked")).toBe("true");
    expect(el('[id="cca-stage-muda-status"]').getAttribute("aria-checked")).toBe("false");
    expect(document.getElementById("cca-stage-deal-status")).toBeNull();

    await digitar(el<HTMLInputElement>("#cca-stage-name"), "Conferência final");
    await clicar(el('[id="cca-stage-notify"]'));
    await clicar(botaoComTexto("Criar estágio"));

    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: "Conferência final", notify_sales: false, deal_status_id: null,
    }));
  });

  it("editar: mantém o status ligado e grava o aviso desligado; desligar o status grava null", async () => {
    await clicar(el('button[aria-label="Editar o estágio APROVADO TOTAL"]'));
    expect(el('[id="cca-stage-muda-status"]').getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("cca-stage-deal-status")).not.toBeNull();

    await clicar(el('[id="cca-stage-notify"]'));
    await clicar(botaoComTexto("Salvar"));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({
      notify_sales: false, deal_status_id: "ds-aprov",
    }));

    await clicar(el('button[aria-label="Editar o estágio APROVADO TOTAL"]'));
    await clicar(el('[id="cca-stage-muda-status"]'));
    await clicar(botaoComTexto("Salvar"));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({
      notify_sales: true, deal_status_id: null,
    }));
  });

  it("ligar 'Muda o status' sem escolher qual não deixa salvar", async () => {
    await digitar(el<HTMLInputElement>("#cca-stage-name"), "Sem status escolhido");
    await clicar(el('[id="cca-stage-muda-status"]'));
    expect(botaoComTexto("Criar estágio").disabled).toBe(true);
    expect(document.body.textContent).toContain("Escolha o status ou desligue a opção.");
  });
});
