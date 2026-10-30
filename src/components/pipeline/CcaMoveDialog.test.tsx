import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { CcaDeal, CcaStage } from "./ccaData";
import type { PipelineStage } from "./stages";
import { CcaMoveDialog } from "./CcaMoveDialog";
import { supabase } from "@/integrations/supabase/client";
import { updateDeal } from "./data";
import { toast } from "@/components/ui/sonner";

/**
 * Antes de confirmar, o diálogo diz o efeito da coluna (0155): quem é avisado
 * e o que acontece com o status do negócio.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: { id: "cca-1" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user, canEnterStage: () => true }) }));
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
  vi.restoreAllMocks();
  localStorage.clear();
  auth.user = { id: "cca-1" };
});

async function abrir(stage: CcaStage, funil?: { approvedStage: PipelineStage; negocio: LegacyDealRecord }, callbacks?: { onClose: () => void; onMoved: () => void | Promise<void> }) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <CcaMoveDialog
        deal={deal} stage={stage} approvedStage={funil?.approvedStage} negocio={funil?.negocio}
        onClose={callbacks?.onClose ?? (() => undefined)} onMoved={callbacks?.onMoved ?? (() => undefined)}
      />,
    );
  });
  return document.body.textContent ?? "";
}

describe("CcaMoveDialog · o efeito da coluna antes de confirmar", () => {
  it("preserva o padrão, ajusta pelos controles e restaura a preferência ao reabrir", async () => {
    localStorage.setItem("faceimob-cca-message-font-size", "2");
    await abrir(coluna({ status: "pending_documents" }));
    const mensagem = document.querySelector("textarea")!;
    const reduzir = document.querySelector<HTMLButtonElement>('[aria-label="Reduzir fonte da mensagem"]')!;
    const aumentar = document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!;
    expect(mensagem.classList.contains("text-xs")).toBe(true);
    expect(reduzir.disabled).toBe(true);
    await act(async () => { aumentar.click(); });
    expect(mensagem.classList.contains("text-base")).toBe(true);
    expect(localStorage.getItem("faceimob-cca-message-font-size:cca-1")).toBe("1");
    await act(async () => { aumentar.click(); });
    expect(mensagem.classList.contains("text-xl")).toBe(true);
    expect(aumentar.disabled).toBe(true);
    await act(async () => { reduzir.click(); });
    expect(mensagem.classList.contains("text-base")).toBe(true);
    await act(async () => { root?.unmount(); });
    container.remove();
    await abrir(coluna({ status: "pending_documents" }));
    expect(document.querySelector("textarea")!.classList.contains("text-base")).toBe(true);
    expect(document.querySelector("textarea")!.value).toBe("");
  });

  it("ignora preferência inválida e mantém as regras e a mensagem enviada ao ajustar a fonte", async () => {
    localStorage.setItem("faceimob-cca-message-font-size:cca-1", "99");
    await abrir(coluna({ status: "pending_documents" }));
    const mensagem = document.querySelector("textarea")!;
    const confirmar = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Confirmar")!;
    expect(mensagem.classList.contains("text-xs")).toBe(true);
    expect(mensagem.required).toBe(true);
    expect(mensagem.maxLength).toBe(4000);
    expect(confirmar.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(mensagem, "  Enviar comprovante  ");
      mensagem.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!.click(); });
    expect(mensagem.value).toBe("  Enviar comprovante  ");
    expect(confirmar.disabled).toBe(false);
    const { supabase } = await import("@/integrations/supabase/client");
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: null, count: null, status: 200, statusText: "OK", success: true });
    await act(async () => { confirmar.click(); });
    expect(supabase.rpc).toHaveBeenCalledWith("move_cca_case", {
      p_case_id: deal.caseId, p_stage_id: "s1", p_message: "Enviar comprovante",
    });
  });

  it("permite ajustar a fonte mesmo com armazenamento indisponível", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await abrir(coluna({}));
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!.click(); });
    expect(document.querySelector("textarea")!.classList.contains("text-base")).toBe(true);
  });

  it("isola a preferência entre dois CCAs no mesmo aparelho, inclusive ao trocar o perfil aberto", async () => {
    await abrir(coluna({}));
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!.click(); });
    auth.user = { id: "cca-2" };
    await act(async () => {
      root?.render(<CcaMoveDialog deal={deal} stage={coluna({})} onClose={() => undefined} onMoved={() => undefined} />);
    });
    expect(document.querySelector("textarea")!.classList.contains("text-xs")).toBe(true);
    expect(localStorage.getItem("faceimob-cca-message-font-size:cca-2")).toBeNull();
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Aumentar fonte da mensagem"]')!.click(); });
    expect(localStorage.getItem("faceimob-cca-message-font-size:cca-2")).toBe("2");
    auth.user = { id: "cca-1" };
    await act(async () => {
      root?.render(<CcaMoveDialog deal={deal} stage={coluna({})} onClose={() => undefined} onMoved={() => undefined} />);
    });
    expect(document.querySelector("textarea")!.classList.contains("text-base")).toBe(true);
    expect(localStorage.getItem("faceimob-cca-message-font-size:cca-1")).toBe("1");
  });


  it.each([false, true])("pendência mantém comercial, fecha sem aguardar recarga e trata repetição=%s", async (repeated) => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { already_moved: repeated }, error: null } as never);
    const onClose = vi.fn();
    const onMoved = vi.fn(() => new Promise<void>(() => {}));
    const texto = await abrir(coluna({ name: "RESOLVER P/ ASSINAR BANCO", status: "approved", deal_status_id: null }), {
      approvedStage: { id: "p1", code: "approved", label: "Aprovado", position: 5 } as PipelineStage,
      negocio: { id: "d1", active: true, stage_position: 3, stage_id: "p0", stage_label: "Em contrato" } as LegacyDealRecord,
    }, { onClose, onMoved });
    expect(texto).toContain("O comercial mantém seu status");
    const campo = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, "Falta assinatura");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botao = [...document.querySelectorAll("button")].find((b) => b.textContent === "Confirmar")!;
    await act(async () => botao.click());
    expect(updateDeal).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onMoved).toHaveBeenCalledOnce();
    if (repeated) expect(toast.info).toHaveBeenCalledWith("Essa pendência já foi registrada", expect.anything());
    else expect(toast.success).toHaveBeenCalled();
  });
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
