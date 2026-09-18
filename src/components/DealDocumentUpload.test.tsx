import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DealDeveloper, DealDocumentReview } from "@/integrations/supabase/documents";
import DealDocumentUpload from "./DealDocumentUpload";

/**
 * "Enviar à construtora" na conferência do gerente (17/09/2026, 0154).
 *
 * Saiu do cartão da CCA e passou a ser do gerente, depois de conferir. Três
 * regras cobradas aqui: só no fluxo EXTERNO; só para quem confere (gerente do
 * negócio ou admin); e, sem e-mail cadastrado, o botão fica desabilitado com o
 * motivo escrito ao lado — sumir sem explicação faria o gerente procurar a ação.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  papeis: ["manager"] as string[],
  status: "approved" as DealDocumentReview["document_review_status"],
  construtora: null as DealDeveloper | null,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "eu" }, isAdmin: false, can: () => false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/components/pipeline/ccaData", () => ({ loadCcaCase: async () => null }));
// O diálogo tem teste de fluxo próprio no banco; aqui importa só que ele abre
// para o negócio e a construtora certos.
vi.mock("@/components/DeveloperSubmissionDialog", () => ({
  default: (props: { dealId: string; developerName: string }) => (
    <div data-testid="dialogo-envio">{`${props.dealId} · ${props.developerName}`}</div>
  ),
}));
vi.mock("@/integrations/supabase/documents", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/documents")>()),
  listDocumentTypes: async () => [],
  listDealDocuments: async () => [],
  getDealDocumentReview: async (): Promise<DealDocumentReview> => ({
    review_esteira: "agil",
    document_review_status: h.status,
    document_review_requested_at: null,
    document_review_requested_by: null,
    document_reviewed_at: null,
    document_reviewed_by: null,
    document_review_reason: null,
  }),
  listMyDealRoles: async () => h.papeis,
  countDealManagers: async () => 1,
  canEditDeal: async () => false,
  dealParticipantNames: async () => ({}),
  missingStoragePaths: async () => new Set<string>(),
  getDealDeveloper: async () => h.construtora,
}));

let root: Root;
let container: HTMLDivElement;

async function montar() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root.render(<DealDocumentUpload dealId="deal-1" clientName="Cliente" dealCode="N-1" hasDeveloper />);
  });
}

const botaoEnviar = () => [...container.querySelectorAll("button")]
  .find((b) => /enviar à construtora/i.test(b.textContent ?? ""));

beforeEach(() => {
  h.papeis = ["manager"];
  h.status = "approved";
  h.construtora = { name: "Externa X", flow: "external", hasEmail: true };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("DealDocumentUpload — Enviar à construtora", () => {
  it("gerente, construtora externa com e-mail: o botão abre o envio do negócio", async () => {
    await montar();
    const botao = botaoEnviar();
    expect(botao, "o gerente vê o envio depois de conferir").toBeTruthy();
    expect(botao?.disabled).toBe(false);

    await act(async () => { botao?.click(); });
    expect(container.querySelector('[data-testid="dialogo-envio"]')?.textContent).toBe("deal-1 · Externa X");
  });

  it("construtora externa sem e-mail: desabilitado, com o motivo escrito e ligado ao botão", async () => {
    h.construtora = { name: "Externa X", flow: "external", hasEmail: false };
    await montar();
    const botao = botaoEnviar();
    expect(botao?.disabled).toBe(true);
    const motivo = document.getElementById(botao?.getAttribute("aria-describedby") ?? "");
    expect(motivo?.textContent).toMatch(/Construtora sem e-mail cadastrado\. Cadastre em Construtoras/);
  });

  it("construtora interna: o botão não existe", async () => {
    h.construtora = { name: "Interna Y", flow: "internal", hasEmail: false };
    await montar();
    expect(botaoEnviar()).toBeUndefined();
  });

  it("corretor não confere documento e não vê o envio", async () => {
    h.papeis = ["broker"];
    await montar();
    expect(botaoEnviar()).toBeUndefined();
  });

  it("antes da aprovação não há envio à mão: aprovar já enfileira e mandaria duas vezes", async () => {
    h.status = "pending";
    await montar();
    expect(botaoEnviar()).toBeUndefined();
  });
});
