import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LeadRecord } from "@/integrations/supabase/leads";
import { VincularNegocioDialog } from "./VincularNegocioDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  achar: vi.fn(),
  vincular: vi.fn(async () => undefined),
  promover: vi.fn(async () => undefined),
  invalidar: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast, useToast: () => ({ toast: h.toast }) }));
vi.mock("./data", () => ({ useInvalidateLeads: () => h.invalidar }));
vi.mock("@/integrations/supabase/batidaCpf", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/batidaCpf")>()),
  negocioDoCpf: h.achar,
}));
vi.mock("@/integrations/supabase/leads", async (original) => ({
  ...(await original<typeof import("@/integrations/supabase/leads")>()),
  vincularLeadAoNegocio: h.vincular,
  promoteLeadAttachments: h.promover,
}));

const lead = { id: "lead-1", name: "Maria Lead" } as LeadRecord;
const negocio = {
  deal_id: "deal-1", codigo: "N-10", cliente: "Maria Cliente", situacao: "ativo" as const,
  status2: "INCOMPLETO", corretor: "Caio", gerente: "Gil", ultimo_comentario: null, ultimo_comentario_em: null,
};

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
const onVinculado = vi.fn();

const corpo = () => document.body.textContent ?? "";
const botao = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(texto));
async function digitarCpf(valor: string) {
  const campo = document.getElementById("vincular-cpf") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => { root.render(<VincularNegocioDialog lead={lead} onClose={onClose} onVinculado={onVinculado} />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });

describe("VincularNegocioDialog", () => {
  it("só busca com o CPF completo e mostra o negócio achado", async () => {
    expect(botao("Buscar")?.hasAttribute("disabled")).toBe(true);
    await digitarCpf("123.456.789-09");
    h.achar.mockResolvedValueOnce(negocio);
    await act(async () => { botao("Buscar")?.click(); });
    expect(h.achar).toHaveBeenCalledWith(["12345678909"]);
    expect(corpo()).toContain("Maria Cliente · N-10");
    expect(botao("Vincular e converter lead")?.hasAttribute("disabled")).toBe(false);
  });

  it("sem negócio com o CPF, avisa e não deixa vincular", async () => {
    await digitarCpf("12345678909");
    h.achar.mockResolvedValueOnce(null);
    await act(async () => { botao("Buscar")?.click(); });
    expect(corpo()).toContain("Nenhum negócio com esse CPF");
    expect(botao("Vincular e converter lead")?.hasAttribute("disabled")).toBe(true);
  });

  it("vincular liga o lead, copia os anexos, avisa e fecha", async () => {
    await digitarCpf("123.456.789-09");
    h.achar.mockResolvedValueOnce(negocio);
    await act(async () => { botao("Buscar")?.click(); });
    await act(async () => { botao("Vincular e converter lead")?.click(); });
    expect(h.vincular).toHaveBeenCalledWith("lead-1", "deal-1", "12345678909");
    expect(h.promover).toHaveBeenCalledWith("lead-1");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success", title: "Lead vinculado ao negócio" }));
    expect(onVinculado).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("recusa do banco mostra o erro e não fecha", async () => {
    await digitarCpf("12345678909");
    h.achar.mockResolvedValueOnce(negocio);
    await act(async () => { botao("Buscar")?.click(); });
    h.vincular.mockRejectedValueOnce(new Error("recusado"));
    await act(async () => { botao("Vincular e converter lead")?.click(); });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", title: "Não foi possível vincular" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
