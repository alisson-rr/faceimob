import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "@/components/ui/sonner";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal } from "./data";
import type { PipelineStage } from "./stages";
import { useDealActions } from "./useDealActions";

/**
 * Avisos de etapa e de Status 2: o sucesso só depois do servidor, curto (gesto
 * repetido), fora da venda que ganha o card do `EngagementLayer` e, na recusa
 * do banco, erro traduzido — nunca sucesso.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ canEnterStage: () => true, isAdmin: true, can: () => true }),
}));
vi.mock("./data", () => ({
  updateDeal: vi.fn(),
  useCanExitStage: () => () => true,
  useInvalidateDeals: () => async () => undefined,
}));

const proposta: PipelineStage = { id: "s-proposal", code: "proposal", label: "Proposta", position: 2 };
const visita: PipelineStage = { id: "s-visit", code: "visit_scheduled", label: "Visita agendada", position: 3 };
const analise: PipelineStage = { id: "s-analysis", code: "under_analysis", label: "Em análise", position: 4 };
const fechado: PipelineStage = { id: "s-closed", code: "closed", label: "Fechado", position: 7 };

// Cast: o hook e `blockedMoveReason` só leem estes campos do negócio.
const negocio = {
  id: "d1", client: "Cliente", stage: "proposal", stage_id: "s-proposal", stage_label: "Proposta",
  month_base: "08/2026", document_review_status: "approved", broker1_id: "b1",
} as LegacyDealRecord;
// Sem corretor no rateio o banco não lança `venda` em `game_events`: não há card.
const soComGerente = { ...negocio, broker1_id: null, manager1_id: "g1" } as LegacyDealRecord;

let actions: ReturnType<typeof useDealActions>;
function Harness() {
  actions = useDealActions({
    stages: [proposta, visita, analise, fechado], closedMonths: [], onNeedsLossConfirmation: () => undefined,
  });
  return null;
}

let root: Root;
let container: HTMLElement;

describe("useDealActions · avisos de etapa e status", () => {
  beforeEach(async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(updateDeal).mockReset();
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("confirma com sucesso curto depois de gravar", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.moveDeal(negocio, visita); });

    expect(updateDeal).toHaveBeenCalledWith("d1", { stage_id: "s-visit" });
    expect(toast.success).toHaveBeenCalledWith("Negócio movido para Visita agendada", { duration: 2500 });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("não soma sucesso ao card de venda quando vai para Fechado com corretor", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.moveDeal(negocio, fechado); });

    expect(updateDeal).toHaveBeenCalledWith("d1", { stage_id: "s-closed" });
    expect(toast.success, "o toast de sucesso duplicou o card de venda").not.toHaveBeenCalled();
  });

  it("confirma Fechado sem corretor, porque essa venda não ganha card", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.moveDeal(soComGerente, fechado); });

    expect(toast.success, "a venda sem card ficou sem aviso nenhum")
      .toHaveBeenCalledWith("Negócio movido para Fechado", { duration: 2500 });
  });

  // O envio ao gerente exige mensagem e esteira (0150), que o arraste não pede:
  // chamar a RPC daqui só produzia a recusa "Escreva a mensagem do envio".
  it("arrastar para Em análise sem conferência orienta o envio pela aba Anexos e não grava", async () => {
    const semConferencia = { ...negocio, document_review_status: "draft" } as LegacyDealRecord;
    await act(async () => { await actions.moveDeal(semConferencia, analise); });

    expect(updateDeal, "o arraste não pode mover nem enviar").not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Envie pela aba Anexos", {
      description: expect.stringContaining("«Enviar ao gerente» na aba Anexos, com a mensagem do envio"),
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Com a conferência pendente a aba Anexos esconde o envio: mandar o corretor
  // usar «Enviar ao gerente» apontava para um botão que não está na tela.
  it("arrastar para Em análise com a conferência pendente diz que falta o gerente, sem mandar reenviar", async () => {
    const pendente = { ...negocio, document_review_status: "pending" } as LegacyDealRecord;
    await act(async () => { await actions.moveDeal(pendente, analise); });

    expect(updateDeal).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Aguardando o gerente", {
      description: expect.stringContaining("já aguarda conferência do gerente"),
    });
    expect(toast.info).not.toHaveBeenCalledWith("Envie pela aba Anexos", expect.anything());
  });

  it("na recusa do banco mostra erro traduzido e nenhum sucesso", async () => {
    vi.mocked(updateDeal).mockRejectedValue({ code: "P0001", message: "Seu perfil não pode alterar este negócio." });
    await act(async () => { await actions.moveDeal(negocio, visita); });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Não foi possível mover o negócio", {
      description: "Seu perfil não pode alterar este negócio.",
    });
  });

  it("marcar VENDA com corretor grava Fechado e deixa a confirmação para o card", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.changeStatus(negocio, "VENDA"); });

    expect(updateDeal).toHaveBeenCalledWith("d1", { status_detail: "VENDA", lost_reason: null, stage_id: "s-closed" });
    expect(toast.success, "o toast de sucesso duplicou o card de venda").not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("marcar VENDA sem corretor confirma com sucesso curto", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.changeStatus(soComGerente, "VENDA"); });

    expect(toast.success).toHaveBeenCalledWith("Status atualizado", { description: "VENDA", duration: 2500 });
  });

  it("trocar para um status comum confirma com sucesso curto e o status na descrição", async () => {
    vi.mocked(updateDeal).mockResolvedValue(undefined);
    await act(async () => { await actions.changeStatus(negocio, "PROPOSTA"); });

    expect(updateDeal).toHaveBeenCalledWith("d1", { status_detail: "PROPOSTA", lost_reason: null });
    expect(toast.success).toHaveBeenCalledWith("Status atualizado", { description: "PROPOSTA", duration: 2500 });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
