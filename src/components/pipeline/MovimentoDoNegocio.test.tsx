import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SaveLegacyDealInput } from "@/integrations/supabase/newSchema";
import { MovimentoDoNegocio } from "./MovimentoDoNegocio";

/**
 * Aba Negócio (14/10/2026): toda ação segue o mesmo molde — toggle à esquerda
 * com a ação descrita à direita; as opções (comentário obrigatório) só abrem
 * com o toggle ligado; e confirmar move pela RPC, avisa e fecha o card.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  mover: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "eu" }, isAdmin: true, can: () => true, roles: ["admin"] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }), toast: h.toast }));
vi.mock("@/integrations/supabase/documents", () => ({
  getDealDeveloper: async () => ({ name: "TENDA", flow: "internal" }),
  getDealDocumentReview: async () => ({ document_review_status: "approved" }),
}));
vi.mock("@/integrations/supabase/leads", () => ({ listDeveloperProjects: async () => [] }));
vi.mock("@/integrations/supabase/central", () => ({
  chaveDaConstrutora: (nome: string) => nome.toLowerCase(),
  construtorasDoCcaProprio: async () => new Set(["tenda"]),
}));
vi.mock("./data", () => ({ useDevelopers: () => ({ data: [] }), usePeople: () => ({ data: [] }) }));
vi.mock("./DealOffToggle", () => ({ DealOffToggle: () => null }));
vi.mock("@/integrations/supabase/dealStatuses", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/dealStatuses")>()),
  useDealStatusCatalog: () => ({
    data: {
      statuses: ["VIROU NEGÓCIO", "EM CONTRATO", "ASSINADO"].map((value) => ({ id: value, value, label: value })),
      indexByKey: new Map(), permissions: [],
    },
  }),
  moveDealStatus: h.mover,
}));

let root: Root;
let container: HTMLDivElement;
const onGravar = vi.fn(async () => true);
const onMovido = vi.fn(async () => undefined);
const onConcluido = vi.fn();

async function montar(status: string, vgv: number | null = 196302.86) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const form = { status, vgv_bruto: vgv, desconto: 0, project: "LUSA SINTRA", unit: "03 | 408", developer_id: "d1" } as unknown as SaveLegacyDealInput;
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MovimentoDoNegocio dealId="deal-1" form={form} readOnly={false} onPatch={vi.fn()} onAplicarOff={vi.fn()}
          onGravar={onGravar} onMovido={onMovido} onConcluido={onConcluido} />
      </QueryClientProvider>,
    );
  });
}

const alternarDe = (titulo: string) => {
  const rotulo = [...container.querySelectorAll("label")].find((l) => l.textContent === titulo);
  return container.querySelector<HTMLButtonElement>(`button[role="switch"][id="${rotulo?.getAttribute("for")}"]`);
};
const botao = (texto: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(texto));
async function digitar(texto: string) {
  const campo = container.querySelector<HTMLTextAreaElement>("textarea");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(campo, texto);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("MovimentoDoNegocio — um molde para toda ação", () => {
  it("as opções só abrem com o toggle ligado", async () => {
    await montar("VIROU NEGÓCIO");
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => { alternarDe("Colocar em contrato")?.click(); });
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("colocar em contrato pede comentário, grava a ficha, move pela RPC, avisa e fecha o card", async () => {
    await montar("VIROU NEGÓCIO");
    await act(async () => { alternarDe("Colocar em contrato")?.click(); });
    expect(botao("Colocar em contrato")?.hasAttribute("disabled")).toBe(true);
    await digitar("Contrato emitido, VGV conferido");
    await act(async () => { botao("Colocar em contrato")?.click(); });
    expect(onGravar).toHaveBeenCalledWith(undefined, true);
    expect(h.mover).toHaveBeenCalledWith("deal-1", "EM CONTRATO", "Contrato emitido, VGV conferido");
    expect(onMovido).toHaveBeenCalledWith("EM CONTRATO");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: "Negócio em contrato" }));
    expect(onConcluido).toHaveBeenCalled();
  });

  it("sem VGV bruto o contrato não liga e diz o porquê", async () => {
    await montar("VIROU NEGÓCIO", null);
    expect(alternarDe("Colocar em contrato")?.disabled).toBe(true);
    expect(container.textContent).toContain("Informe o VGV bruto.");
  });

  it("confirmar assinado só vale em EM CONTRATO e também pede comentário", async () => {
    await montar("VIROU NEGÓCIO");
    expect(alternarDe("Confirmar contrato assinado")?.disabled).toBe(true);
    await act(async () => { root.unmount(); });
    container.remove();
    await montar("EM CONTRATO");
    await act(async () => { alternarDe("Confirmar contrato assinado")?.click(); });
    await digitar("Assinado em cartório");
    await act(async () => { botao("Confirmar assinado")?.click(); });
    expect(h.mover).toHaveBeenCalledWith("deal-1", "ASSINADO", "Assinado em cartório");
    expect(onConcluido).toHaveBeenCalled();
  });

  it("falha da RPC não fecha o card e mostra o erro", async () => {
    h.mover.mockRejectedValueOnce(new Error("recusado"));
    await montar("VIROU NEGÓCIO");
    await act(async () => { alternarDe("Colocar em contrato")?.click(); });
    await digitar("Contrato emitido");
    await act(async () => { botao("Colocar em contrato")?.click(); });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(onConcluido).not.toHaveBeenCalled();
  });
});
