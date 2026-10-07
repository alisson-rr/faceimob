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

describe("DealsTable · posição da Esteira Ágil", () => {
  it("expõe a colocação do negócio na tabela usada pelo corretor", async () => {
    expect(await render(4)).toContain("4º na Esteira Ágil");
  });

  it("não inventa posição para negócio fora da fila", async () => {
    expect(await render()).not.toContain("na Esteira Ágil");
  });
});
