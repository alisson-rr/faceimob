import { describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { PipelineStage } from "./stages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true, canEnterStage: () => true }) }));
vi.mock("./data", () => ({ useCanExitStage: () => () => true }));

import { DealsKanban } from "./DealsKanban";

/**
 * Kanban colorido do Pipeline (18/09/2026): a cor da coluna é o hex de
 * `pipeline_stages.color`, o cabeçalho soma o VGV (`deal_value`) da coluna, e
 * cada cartão repete a cor na borda. A etapa de perda continua fora do quadro.
 */
const STAGES: PipelineStage[] = [
  { id: "s1", code: "proposal", label: "Proposta", position: 1, color: "#818cf8" },
  { id: "s2", code: "approved", label: "Aprovado", position: 2 },
  { id: "s3", code: "lost", label: "Perdido", position: 3, color: "#f87171" },
];

const deal = (id: string, stage: string, value: number): LegacyDealRecord =>
  ({
    id, client: `Cliente ${id}`, stage, stage_id: stage, stage_label: stage, deal_value: value,
    developer: "Construtora", project: "Empreendimento", broker1: "Corretor",
    days_in_pipeline: 1, active: true, created_at: new Date().toISOString(), document_review_status: "draft",
  }) as unknown as LegacyDealRecord;

describe("DealsKanban · kanban colorido", () => {
  it("cabeçalho na cor da etapa com VGV e quantidade; cartão com a mesma cor", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DealsKanban
          stages={STAGES}
          deals={[deal("a", "proposal", 250_000), deal("b", "proposal", 188_000), deal("c", "approved", 90_000)]}
          onOpen={() => undefined}
          onMove={() => undefined}
          onLose={() => undefined}
          canWrite
          closedMonths={[]}
        /> as ReactNode,
      );
    });

    const cabecalhos = [...container.querySelectorAll("h3")].map((titulo) => titulo.parentElement as HTMLElement);
    expect(cabecalhos.map((cabecalho) => cabecalho.querySelector("h3")?.textContent)).toEqual(["Proposta", "Aprovado"]);
    // Hex do banco; sem ele, o tom da etapa (`approved` = TONE_HEX.success).
    expect(cabecalhos.map((cabecalho) => cabecalho.style.backgroundColor))
      .toEqual(["rgb(129, 140, 248)", "rgb(22, 163, 74)"]);
    expect(cabecalhos[0].textContent).toMatch(/R\$\s438\.000 · 2 negócios$/);
    expect(cabecalhos[1].textContent).toMatch(/R\$\s90\.000 · 1 negócio$/);

    const bordas = [...container.querySelectorAll<HTMLElement>("article")].map((cartao) => cartao.style.borderLeftColor);
    // O jsdom devolve a cor como foi escrita.
    expect(bordas).toEqual(["#818cf8", "#818cf8", "#16A34A"]);

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
