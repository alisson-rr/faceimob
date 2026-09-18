import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { CcaDeal, CcaStage } from "./ccaData";
import type { PipelineStage } from "./stages";
import { CcaMoveDialog } from "./CcaMoveDialog";

/**
 * Antes de confirmar, o diálogo diz o efeito da coluna (0155): quem é avisado
 * e o que acontece com o status do negócio.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ canEnterStage: () => true }) }));
vi.mock("./data", () => ({ updateDeal: vi.fn(), useCanExitStage: () => () => true }));

const deal: CcaDeal = {
  caseId: "k1", dealId: "d1", client: "Maria Souza", developer: "", project: "", broker: "",
  value: 0, stageId: "s0", notes: "", status: "under_review",
};

const coluna = (extra: Partial<CcaStage>): CcaStage => ({
  id: "s1", name: "COLUNA", color: "#2563EB", position: 1, status: "under_review", ...extra,
});

let root: Root | null = null;
let container: HTMLElement;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
  root = null;
});

async function abrir(stage: CcaStage, funil?: { approvedStage: PipelineStage; negocio: LegacyDealRecord }) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <CcaMoveDialog
        deal={deal} stage={stage} approvedStage={funil?.approvedStage} negocio={funil?.negocio}
        onClose={() => undefined} onMoved={() => undefined}
      />,
    );
  });
  return document.body.textContent ?? "";
}

describe("CcaMoveDialog · o efeito da coluna antes de confirmar", () => {
  it("coluna que avisa e grava status: diz quem recebe e qual status", async () => {
    const texto = await abrir(coluna({
      notify_sales: true, deal_status_id: "ds1", deal_status: { label: "09. APROV. TOTAL" },
    }));
    expect(texto).toContain("O corretor e o gerente do negócio recebem o aviso com a sua mensagem.");
    expect(texto).toContain("O status do negócio passa a ser 09. APROV. TOTAL.");
    expect(texto).not.toContain("Movimento interno");
  });

  it("coluna sem o campo (front antes da 0155) conta como avisando", async () => {
    const texto = await abrir(coluna({ deal_status_id: null }));
    expect(texto).toContain("O corretor e o gerente do negócio recebem o aviso com a sua mensagem.");
    expect(texto).toContain("O status do negócio não muda.");
  });

  it("movimento interno: diz que o comercial não é avisado e que o status não muda", async () => {
    const texto = await abrir(coluna({ notify_sales: false, deal_status_id: null }));
    expect(texto).toContain("Movimento interno: o comercial não é avisado.");
    expect(texto).toContain("O status do negócio não muda.");
    expect(texto).not.toContain("recebem o aviso com a sua mensagem");
  });

  it("coluna interna de aprovação: avisa que o negócio anda no funil, mesmo sem aviso ao comercial", async () => {
    const funil = {
      approvedStage: { id: "p-aprov", code: "approved", label: "Aprovado", position: 5 } as PipelineStage,
      negocio: { id: "d1", active: true, stage_position: 3, stage_id: "p-analise", stage_label: "Em análise" } as LegacyDealRecord,
    };
    const texto = await abrir(coluna({ status: "approved", notify_sales: false, deal_status_id: null }), funil);
    expect(texto).toContain("Movimento interno: o comercial não é avisado.");
    expect(texto).toContain("O status do negócio não muda.");
    expect(texto).toContain("O negócio vai para a etapa Aprovado do funil do Pipeline.");
  });

  it("negócio já em Aprovado ou adiante: não promete mover o funil", async () => {
    const funil = {
      approvedStage: { id: "p-aprov", code: "approved", label: "Aprovado", position: 5 } as PipelineStage,
      negocio: { id: "d1", active: true, stage_position: 6, stage_id: "p-contrato", stage_label: "Contrato" } as LegacyDealRecord,
    };
    const texto = await abrir(coluna({ status: "approved", notify_sales: false, deal_status_id: null }), funil);
    expect(texto).not.toContain("do funil do Pipeline");
  });
});
