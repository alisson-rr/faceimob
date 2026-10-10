import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  DealDeveloper, DealDocumentRecord, DealDocumentReview, DocumentTypeRecord,
} from "@/integrations/supabase/documents";
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
  tipos: [] as DocumentTypeRecord[],
  docs: [] as DealDocumentRecord[],
  caseStatus: null as string | null,
  podeEditar: false,
  upload: vi.fn(async () => ({ stored_name: "novo.pdf" })),
  revisar: vi.fn(async () => undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "eu" }, isAdmin: false, can: () => false, roles: [] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/components/pipeline/ccaData", () => ({
  loadCcaCase: async () => h.caseStatus ? ({ id: "case-1", status: h.caseStatus, analysis: {} }) : null,
}));
// O diálogo tem teste de fluxo próprio no banco; aqui importa só que ele abre
// para o negócio e a construtora certos.
vi.mock("@/components/DeveloperSubmissionDialog", () => ({
  default: (props: { dealId: string; developerName: string }) => (
    <div data-testid="dialogo-envio">{`${props.dealId} · ${props.developerName}`}</div>
  ),
}));
vi.mock("@/integrations/supabase/documents", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/documents")>()),
  listDocumentTypes: async () => h.tipos,
  listDealDocuments: async () => h.docs,
  uploadDealDocument: h.upload,
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
  canEditDeal: async () => h.podeEditar,
  dealParticipantNames: async () => ({}),
  missingStoragePaths: async () => new Set<string>(),
  getDealDeveloper: async () => h.construtora,
  reviewDealDocuments: h.revisar,
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
  h.tipos = [];
  h.docs = [];
  h.podeEditar = false;
  h.upload.mockClear();
  h.papeis = ["manager"];
  h.status = "approved";
  h.caseStatus = null;
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

// Pedidos de 29/09/2026: arrastar arquivo para anexar e baixar tudo num PDF só.
describe("DealDocumentUpload — arrastar e PDF único", () => {
  const tipo: DocumentTypeRecord = {
    id: "t-rg", code: "rg", label: "RG", category: "cliente", required_for_conversion: false,
    allows_multiple: true, naming_pattern: null, sort_order: 1,
  };
  const doc = (patch: Partial<DealDocumentRecord>): DealDocumentRecord => ({
    id: "d1", deal_id: "deal-1", document_type_id: "t-rg", storage_path: "deal-1/rg.pdf",
    original_name: "rg.pdf", stored_name: "rg.pdf", display_name: null, mime_type: "application/pdf",
    size_bytes: 10, version: 1, superseded_at: null, created_at: "2026-09-29T10:00:00Z", ...patch,
  });
  const soltar = async (alvo: Element, arquivos: File[]) => {
    const evento = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(evento, "dataTransfer", { value: { files: arquivos, types: ["Files"] } });
    await act(async () => { alvo.dispatchEvent(evento); });
  };
  const linhaDoTipo = () => container.querySelector('label[for$="-t-rg"]')!.closest("div.rounded-lg")!;

  it("soltar o arquivo na linha do tipo envia para aquele tipo", async () => {
    h.status = "draft";
    h.papeis = ["broker"];
    h.podeEditar = true;
    h.tipos = [tipo];
    await montar();
    const arquivo = new File(["%PDF-1.7"], "rg.pdf", { type: "application/pdf" });
    await soltar(linhaDoTipo(), [arquivo]);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload).toHaveBeenCalledWith(expect.objectContaining({ documentType: tipo, file: arquivo }));
  });

  it("o botão do PDF único aparece com versão vigente e some sem nenhuma", async () => {
    h.tipos = [tipo];
    h.docs = [doc({}), doc({ id: "d0", superseded_at: "2026-09-28T10:00:00Z" })];
    await montar();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Baixar tudo em PDF")).toBe(true);

    await act(async () => { root.unmount(); });
    container.remove();
    h.docs = [doc({ superseded_at: "2026-09-28T10:00:00Z" })];
    await montar();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Baixar tudo em PDF")).toBe(false);
  });
});

describe("DealDocumentUpload — grava a ficha antes de decidir", () => {
  // PIS digitado em Detalhes sumia: aprovar ou enviar pela aba Anexos não
  // gravava a ficha (06/10/2026). A decisão só sai depois de gravar.
  async function aprovar(salvarFicha: () => Promise<boolean>) {
    h.status = "pending";
    h.revisar.mockClear();
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root.render(
        <DealDocumentUpload dealId="deal-1" clientName="Cliente" dealCode="N-1" hasDeveloper salvarFicha={salvarFicha} />,
      );
    });
    const botao = [...container.querySelectorAll("button")].find((b) => /aprovar/i.test(b.textContent ?? ""));
    await act(async () => { botao?.click(); });
    return Boolean(botao);
  }

  it("não aprova quando a ficha não gravou", async () => {
    const salvar = vi.fn(async () => false);
    expect(await aprovar(salvar)).toBe(true);
    expect(salvar).toHaveBeenCalledOnce();
    expect(h.revisar).not.toHaveBeenCalled();
  });

  it("grava a ficha e então aprova", async () => {
    const salvar = vi.fn(async () => true);
    expect(await aprovar(salvar)).toBe(true);
    expect(salvar).toHaveBeenCalledOnce();
    expect(h.revisar).toHaveBeenCalledOnce();
  });

  it("diretor vinculado também recebe os comandos de aprovação", async () => {
    h.status = "pending";
    h.papeis = ["director"];
    await montar();

    const aprovar = [...container.querySelectorAll("button")]
      .find((button) => /aprovar e enviar ao cca/i.test(button.textContent ?? ""));
    const devolver = [...container.querySelectorAll("button")]
      .find((button) => /^devolver$/i.test(button.textContent?.trim() ?? ""));

    expect(aprovar, "o diretor vinculado não recebeu a ação de aprovar").toBeTruthy();
    expect(devolver, "o diretor vinculado não recebeu a ação de devolver").toBeTruthy();
  });
});

describe("DealDocumentUpload — análise p/ virar negócio", () => {
  it("oferece ao corretor o segundo envio após aprovação da CCA, inclusive se a conferência antiga ficou devolvida", async () => {
    h.status = "returned";
    h.caseStatus = "approved";
    h.papeis = ["broker"];
    h.tipos = [{
      id: "opcional", code: "opcional", label: "Opcional", category: "cliente",
      required_for_conversion: false, allows_multiple: true, naming_pattern: null, sort_order: 1,
    }];
    await montar();

    // Aba Negócio (10/10/2026): o 2º envio é um toggle numerado.
    expect(container.textContent, "o corretor não recebeu o segundo envio").toContain("Enviar análise p/ virar negócio · 1º envio");
    expect(container.textContent).toContain("Análise p/ virar negócio");
  });
});

describe("DealDocumentUpload — aba Negócio (10/10/2026)", () => {
  async function montarParte(parte: "acoes" | "arquivos", extra: { statusDetail?: string } = {}) {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root.render(
        <DealDocumentUpload dealId="deal-1" clientName="Cliente" dealCode="N-1" hasDeveloper parte={parte} {...extra} />,
      );
    });
    return container.textContent ?? "";
  }

  it("ações na aba Negócio, arquivos na aba Anexos; virar negócio só depois da aprovação", async () => {
    h.status = "draft";
    h.papeis = ["broker"];
    h.caseStatus = null;
    const acoes = await montarParte("acoes");
    expect(acoes).toContain("Enviar à Esteira Ágil · 1º envio");
    expect(acoes).not.toContain("Próximo passo");
    expect(acoes).not.toContain("Anexar Documentos");
    expect(acoes, "virar negócio aparece antes da aprovação").not.toContain("Análise p/ virar negócio");
    await act(async () => { root.unmount(); });
    container.remove();
    const arquivos = await montarParte("arquivos");
    expect(arquivos).toContain("Anexar Documentos");
    expect(arquivos).not.toContain("Enviar à Esteira Ágil");
  });

  it("o toggle da Esteira Ágil abre o comentário e o Enviar ao gerente", async () => {
    h.status = "draft";
    h.papeis = ["broker"];
    h.caseStatus = null;
    await montarParte("acoes");
    expect(container.textContent).not.toContain("Enviar ao gerente");
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(toggle).toBeTruthy();
    await act(async () => { toggle?.click(); });
    expect(container.textContent).toContain("Comentário do envio");
    expect(container.textContent).toContain("Enviar ao gerente");
  });

  it("o gerente do negócio também envia a análise p/ virar negócio", async () => {
    h.status = "approved";
    h.papeis = ["manager"];
    h.caseStatus = "approved";
    expect(await montarParte("acoes")).toContain("Enviar análise p/ virar negócio");
  });

  it("em INCOMPLETO com caso aberto, o caminho é reenviar pela Esteira Ágil", async () => {
    h.status = "approved";
    h.papeis = ["broker"];
    h.caseStatus = "under_review";
    expect(await montarParte("acoes", { statusDetail: "INCOMPLETO" })).toContain("Reenviar (encerra o envio anterior)");
  });
});
