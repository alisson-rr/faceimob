import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "@/components/ui/sonner";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import {
  buildDealStatusCatalog, moveDealStatus, type DealStatusCatalog,
} from "@/integrations/supabase/dealStatuses";
import { catalogoDeTeste } from "./statusCatalog.fixture";
import { useDealActions } from "./useDealActions";

/**
 * Mover o Status 2 (0164): um caminho só para o kanban, o teclado e a tabela.
 * O destino decide o caminho (direto, observação, envio para análise, perda) e a
 * matriz por função decide se pode — antes da escrita, com a frase do banco.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  auth: { isAdmin: true, roles: ["admin"] as string[], can: (_code: string) => true },
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("./data", () => ({ useInvalidateDeals: () => async () => undefined }));
vi.mock("@/integrations/supabase/dealStatuses", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/dealStatuses")>()),
  moveDealStatus: vi.fn(),
}));

// Cast: o hook só lê estes campos do negócio.
const negocio = {
  id: "d1", client: "Cliente", status: "08. VIROU NEGÓCIO", month_base: "08/2026",
  document_review_status: "approved", broker1_id: "b1",
} as LegacyDealRecord;
// Sem corretor no rateio o banco não lança `venda` em `game_events`: não há card.
const soComGerente = { ...negocio, broker1_id: null, manager1_id: "g1" } as LegacyDealRecord;

const porValor = (catalog: DealStatusCatalog, value: string) =>
  catalog.statuses.find((status) => status.value === value)!;

let catalog = catalogoDeTeste;
const perda = vi.fn();
const texto = vi.fn();
let actions: ReturnType<typeof useDealActions>;
function Harness() {
  actions = useDealActions({ catalog, closedMonths: [], onNeedsLossConfirmation: perda, onNeedsText: texto });
  return null;
}

let root: Root;
let container: HTMLElement;

const montar = async () => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
};

describe("useDealActions · mover o Status 2", () => {
  beforeEach(async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(moveDealStatus).mockReset();
    perda.mockClear();
    texto.mockClear();
    catalog = catalogoDeTeste;
    h.auth = { isAdmin: true, roles: ["admin"], can: () => true };
    await montar();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("status comum grava pela RPC e confirma com o nome do status", async () => {
    vi.mocked(moveDealStatus).mockResolvedValue(undefined);
    await act(async () => { await actions.moveStatus(negocio, "16. PENDENTE"); });

    expect(moveDealStatus).toHaveBeenCalledWith("d1", "16. PENDENTE");
    expect(toast.success).toHaveBeenCalledWith("Negócio movido para PENDENTE", { duration: 2500 });
  });

  it("Status 1 VENDA com corretor deixa a confirmação para o card de venda; sem corretor confirma", async () => {
    vi.mocked(moveDealStatus).mockResolvedValue(undefined);
    await act(async () => { await actions.moveStatus(negocio, "02. ASS. BANCO"); });
    expect(toast.success, "o toast duplicou o card de venda").not.toHaveBeenCalled();

    await act(async () => { await actions.moveStatus(soComGerente, "02. ASS. BANCO"); });
    expect(toast.success).toHaveBeenCalledWith("Negócio movido para Assinado no banco", { duration: 2500 });
  });

  it("voltar à análise pede a mensagem do envio; com a conferência pendente, só avisa", async () => {
    await act(async () => { await actions.moveStatus(negocio, "RET. ESTEIRA AGIL"); });
    expect(texto).toHaveBeenCalledWith(negocio, porValor(catalog, "RET. ESTEIRA AGIL"), true);
    expect(moveDealStatus).not.toHaveBeenCalled();

    texto.mockClear();
    await act(async () => { await actions.moveStatus({ ...negocio, document_review_status: "pending" }, "13. ESTEIRA AGIL"); });
    expect(texto).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it("encerrar vai para o diálogo de perda, e observação obrigatória para o diálogo de texto", async () => {
    await act(async () => { await actions.moveStatus(negocio, "18. QUEDA"); });
    expect(perda).toHaveBeenCalledWith(negocio, "18. QUEDA");

    catalog = buildDealStatusCatalog(
      catalogoDeTeste.groups,
      catalogoDeTeste.statuses.map((status) => status.value === "16. PENDENTE" ? { ...status, requires_note: true } : status),
    );
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await actions.moveStatus(negocio, "16. PENDENTE"); });
    expect(texto).toHaveBeenCalledWith(negocio, porValor(catalog, "16. PENDENTE"), false);
    expect(moveDealStatus).not.toHaveBeenCalled();
  });

  it("a matriz recusa ANTES da escrita, com a frase do banco", async () => {
    h.auth = { isAdmin: false, roles: ["broker"], can: () => true };
    catalog = buildDealStatusCatalog(catalogoDeTeste.groups, catalogoDeTeste.statuses, [
      { status_id: porValor(catalogoDeTeste, "08. VIROU NEGÓCIO").id, role: "cca", can_enter: true, can_exit: true },
    ]);
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await actions.moveStatus(negocio, "16. PENDENTE"); });

    expect(moveDealStatus).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Não foi possível mover o negócio", {
      description: 'Seu perfil não tira o negócio de "VIROU NEGÓCIO".',
    });
  });

  it("na recusa do banco mostra erro traduzido e nenhum sucesso", async () => {
    vi.mocked(moveDealStatus).mockRejectedValue({ code: "P0001", message: "Mês fechado." });
    await act(async () => { await actions.moveStatus(negocio, "16. PENDENTE"); });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Não foi possível mover o negócio", { description: "Mês fechado." });
  });
});
