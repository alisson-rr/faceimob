import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { buildDealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { catalogoDeTeste, GRUPOS } from "./statusCatalog.fixture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ auth: { isAdmin: true, roles: ["admin"] as string[] } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));

import { StatusKanban } from "./StatusKanban";
import { ordemDeEvolucao } from "./statuses";

/**
 * Kanban pelo Status 2 (29/09/2026, 0164): as colunas são os Status 2 do
 * cadastro, a vazia vira faixa com o nome, e soltar o cartão troca só o
 * Status 2 — pela matriz por função.
 */
const deal = (id: string, status: string | null, value: number): LegacyDealRecord =>
  ({
    id, client: `Cliente ${id}`, status, stage: "proposal", stage_id: "st", deal_value: value,
    developer: "Construtora", project: "Empreendimento", broker1: "Corretor", month_base: "09/2026",
    days_in_pipeline: 1, active: true, created_at: new Date().toISOString(), document_review_status: "draft",
  }) as unknown as LegacyDealRecord;

async function montar(deals: LegacyDealRecord[], onMove = vi.fn(), catalog = catalogoDeTeste) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StatusKanban
        catalog={catalog} statusGroupId={GRUPOS.PROPOSTA.id} deals={deals}
        onOpen={() => undefined} onMoveStatus={onMove} onLose={() => undefined}
        canWrite closedMonths={[]}
      />,
    );
  });
  const coluna = (nome: string) => container.querySelector<HTMLElement>(`section[aria-label^="${nome}"]`)!;
  const soltar = async (cartao: string, destino: string) => {
    const artigo = [...container.querySelectorAll<HTMLElement>('[draggable="true"]')]
      .find((el) => el.textContent?.includes(cartao))!;
    await act(async () => { artigo.dispatchEvent(new Event("dragstart", { bubbles: true })); });
    await act(async () => { coluna(destino).dispatchEvent(new Event("drop", { bubbles: true })); });
  };
  return { container, coluna, soltar, sair: () => { act(() => root.unmount()); container.remove(); } };
}

describe("StatusKanban", () => {
  it("colunas são os Status 2 do Status 1 escolhido; a vazia vira faixa com o nome", async () => {
    h.auth = { isAdmin: true, roles: ["admin"] };
    const tela = await montar([
      deal("a", "16. PENDENTE", 250_000), deal("b", "16. PENDENTE", 188_000), deal("c", "13. ESTEIRA AGIL", 90_000),
    ]);
    const cabecalhos = [...tela.container.querySelectorAll("h3")].map((titulo) => titulo.textContent);
    expect(cabecalhos).toEqual(["ESTEIRA AGIL", "PENDENTE"]);
    expect(tela.coluna("PENDENTE").textContent).toMatch(/R\$\s438\.000,00 · 2/);
    // VIROU NEGÓCIO não tem negócio: não some, fica a faixa com o nome e o zero.
    expect(tela.coluna("VIROU NEGÓCIO").getAttribute("aria-label")).toBe("VIROU NEGÓCIO: nenhum negócio");
    expect(tela.coluna("VIROU NEGÓCIO").textContent).toContain("VIROU NEGÓCIO · 0");
    tela.sair();
  });

  it("negócio fora do cadastro não some: coluna própria no começo", async () => {
    h.auth = { isAdmin: true, roles: ["admin"] };
    const tela = await montar([deal("a", "TEXTO ANTIGO", 1), deal("b", "16. PENDENTE", 1)]);
    expect(tela.container.querySelector("h3")?.textContent).toBe("Em preparação (sem Status 2)");
    tela.sair();
  });

  it("soltar numa coluna move o Status 2, inclusive na faixa da vazia", async () => {
    h.auth = { isAdmin: true, roles: ["admin"] };
    const mover = vi.fn();
    const tela = await montar([deal("a", "16. PENDENTE", 1)], mover);
    await tela.soltar("Cliente a", "VIROU NEGÓCIO");
    expect(mover).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "08. VIROU NEGÓCIO");
    tela.sair();
  });

  it("a matriz recusa o destino ANTES de gravar: o solte não vira escrita", async () => {
    h.auth = { isAdmin: false, roles: ["broker"] };
    const pendente = catalogoDeTeste.statuses.find((status) => status.value === "16. PENDENTE")!;
    // Corretor tira de PENDENTE, mas não coloca em VIROU NEGÓCIO (só a CCA).
    const catalog = buildDealStatusCatalog(catalogoDeTeste.groups, catalogoDeTeste.statuses, [
      { status_id: pendente.id, role: "broker", can_enter: false, can_exit: true },
    ]);
    const mover = vi.fn();
    const tela = await montar([deal("a", "16. PENDENTE", 1)], mover, catalog);
    await tela.soltar("Cliente a", "VIROU NEGÓCIO");
    expect(mover).not.toHaveBeenCalled();
    expect(tela.container.querySelector('[role="status"]')?.textContent)
      .toBe('Seu perfil não coloca o negócio em "VIROU NEGÓCIO".');
    tela.sair();
  });
});

describe("ordemDeEvolucao", () => {
  it("põe as colunas da entrada na esteira até a venda, e o status novo no fim", () => {
    const status = (value: string) => ({ value });
    const ordem = ordemDeEvolucao([
      status("01. RC EMITIDA"), status("08. VIROU NEGÓCIO"), status("NOVO STATUS"), status("09. APROV. TOTAL"),
      status("04. EM CONTRATO"), status("13. ESTEIRA AGIL"), status("16. PENDENTE"), status("18. QUEDA"),
    ]).map((s) => s.value);
    expect(ordem).toEqual([
      "13. ESTEIRA AGIL", "16. PENDENTE", "09. APROV. TOTAL", "08. VIROU NEGÓCIO",
      "04. EM CONTRATO", "01. RC EMITIDA", "18. QUEDA", "NOVO STATUS",
    ]);
  });
});
