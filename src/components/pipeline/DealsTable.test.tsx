import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DealsTable } from "./DealsTable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAdmin: false, roles: ["broker"], can: () => false }),
}));

vi.mock("@/integrations/supabase/dealStatuses", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/integrations/supabase/dealStatuses")>();
  return {
    ...original,
    useDealStatusCatalog: () => ({ data: original.EMPTY_STATUS_CATALOG }),
  };
});

const NEGOCIO = {
  id: "d1",
  client: "Cliente da Fila",
  stage: "proposal",
  stage_id: "s1",
  stage_label: "Em análise",
  month_base: "10/2026",
  project: "Residencial",
  developer: "Construtora",
  unit: "101",
  deal_value: 100_000,
  days_in_pipeline: 2,
  broker1: "Corretor",
  manager1: "Gerente",
  active: true,
  created_at: "2026-10-07T12:00:00Z",
  document_review_status: "approved",
  status: "ESTEIRA AGIL",
} as unknown as LegacyDealRecord;

async function render(queuePosition?: number) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DealsTable
        deals={[NEGOCIO]}
        ccaQueuePositions={queuePosition ? new Map([[NEGOCIO.id, queuePosition]]) : undefined}
        canWrite={false}
        closedMonths={[]}
        onOpen={() => undefined}
        onStatusChange={() => undefined}
        onScheduleVisit={() => undefined}
        onLose={() => undefined}
        onReopen={() => undefined}
      /> as ReactNode,
    );
  });
  const text = container.textContent ?? "";
  await act(async () => { root.unmount(); });
  container.remove();
  return text;
}

async function renderHistoricalOff() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const reactivated: string[] = [];
  await act(async () => {
    root.render(
      <DealsTable
        deals={[{ ...NEGOCIO, month_base: "09/2026", status: "OFF", status_detail: "OFF", active: false }]}
        canWrite={false}
        closedMonths={["09/2026"]}
        currentMonth="10/2026"
        onOpen={() => undefined}
        onStatusChange={() => undefined}
        onScheduleVisit={() => undefined}
        onLose={() => undefined}
        onReopen={() => undefined}
        onReactivate={(deal) => reactivated.push(deal.id)}
      /> as ReactNode,
    );
  });
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Reativar a proposta de Cliente da Fila no mês vigente"]',
  );
  await act(async () => { button?.click(); });
  const result = { text: container.textContent ?? "", reactivated };
  await act(async () => { root.unmount(); });
  container.remove();
  return result;
}

describe("DealsTable · posição da Esteira Ágil", () => {
  it("expõe a colocação do negócio na tabela usada pelo corretor", async () => {
    expect(await render(4)).toContain("4º na Esteira Ágil");
  });

  it("não inventa posição para negócio fora da fila", async () => {
    expect(await render()).not.toContain("na Esteira Ágil");
  });
});

describe("DealsTable · reativação de OFF histórico", () => {
  it("mostra a ação também na tabela e envia o negócio escolhido", async () => {
    const result = await renderHistoricalOff();
    expect(result.text).toContain("Reativar proposta");
    expect(result.reactivated).toEqual(["d1"]);
  });
});
