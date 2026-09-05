import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PipelineAnalytics } from "./PipelineAnalytics";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { PipelineStage } from "./stages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A taxa de fechamento somava os fechados duas vezes — uma dentro de `active`
 * (que é "não perdido nem cancelado", e portanto inclui os ganhos) e outra no
 * denominador. Com 9 vendas em 30 negócios não perdidos o painel dizia 23,1%
 * em vez de 30%. O denominador é uma população, não uma soma com duplicata.
 *
 * O FORMATO passou a ser o do `pct` de `filters.ts`, o mesmo do cartão e da
 * tabela: casa decimal só quando existe. O painel tinha `minimumFractionDigits:
 * 1` e por isso o mesmo 50% saía "50%" no cartão e "50,0%" aqui — duas
 * respostas para o número que define comissão.
 */
const STAGES: PipelineStage[] = [
  { id: "s1", code: "proposal", label: "Proposta", position: 1 },
  { id: "s2", code: "closed", label: "Fechado", position: 2 },
  { id: "s3", code: "lost", label: "Perdido", position: 3 },
];

/** Só os campos que o painel lê; o resto do registro não muda o cálculo. */
const deal = (stage: string, active: boolean): LegacyDealRecord =>
  ({
    id: `${stage}-${Math.random()}`,
    stage,
    active,
    deal_value: 100_000,
    days_in_pipeline: 10,
    broker1: "Corretor",
  }) as unknown as LegacyDealRecord;

async function taxaDeFechamento(deals: LegacyDealRecord[]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<PipelineAnalytics deals={deals} stages={STAGES} /> as ReactNode); });
  const indicadores = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
  await act(async () => { root.unmount(); });
  container.remove();
  const posicao = indicadores.indexOf("Taxa de fechamento");
  return indicadores[posicao + 1];
}

describe("PipelineAnalytics · taxa de fechamento", () => {
  it("é fechados sobre não perdidos, sem contar os fechados duas vezes", async () => {
    const deals = [
      ...Array.from({ length: 9 }, () => deal("closed", true)),
      ...Array.from({ length: 21 }, () => deal("proposal", true)),
      ...Array.from({ length: 2 }, () => deal("lost", false)),
    ];
    // 9 / 30 — e não 9 / (30 + 9).
    expect(await taxaDeFechamento(deals)).toBe("30%");
  });

  it("chega a 100% quando todo negócio aberto virou venda", async () => {
    expect(await taxaDeFechamento([deal("closed", true), deal("closed", true)])).toBe("100%");
  });

  it("sem negócio ativo não divide por zero", async () => {
    expect(await taxaDeFechamento([deal("lost", false)])).toBe("0%");
  });
});
