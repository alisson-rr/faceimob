import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DealCard } from "./DealCard";
import type { PipelineStage } from "./stages";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O selo de visita do cartão — e ONDE ele mora.
 *
 * `listLegacyDeals` passou a ler a tabela `visits` (a coluna saiu de `deals`), e
 * o E2E que cobria isso procurava o selo DENTRO do `role="button"` do cartão:
 * escopo em que ele não pode estar, porque descendente de `button` é
 * presentacional na especificação ARIA e o `aria-label` sumiria do leitor de
 * tela. Este teste fixa as duas metades: o selo acende com `visit_date` e fica
 * fora do botão, que é o motivo de o E2E ancorar no `<article>`.
 */
const deal = (visitDate?: string, share?: number | null): LegacyDealRecord =>
  ({
    id: "d1",
    client: "Cliente Teste",
    stage: "proposal",
    stage_id: "s1",
    stage_label: "Proposta",
    project: "Empreendimento",
    developer: "Construtora",
    unit: "101",
    deal_value: 100_000,
    days_in_pipeline: 3,
    broker1: "Corretor",
    active: true,
    created_at: new Date().toISOString(),
    document_review_status: "draft",
    visit_date: visitDate,
    broker1_share: share ?? null,
  }) as unknown as LegacyDealRecord;

const PROXIMA: PipelineStage = { id: "s2", code: "approved", label: "Aprovado", position: 2 };

async function renderCard(
  visitDate?: string,
  opcoes: {
    locked?: boolean;
    share?: number | null;
    /** Motivo devolvido por `blockedMove` — `null` libera o destino. */
    recusa?: string | null;
  } = {},
) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const perdidos: string[] = [];
  const movidos: string[] = [];
  const recusas: string[] = [];
  await act(async () => {
    root.render(
      <DealCard
        deal={deal(visitDate, opcoes.share)}
        onOpen={() => undefined}
        onMove={(_alvo, stage) => movidos.push(stage.label)}
        onLose={(alvo) => perdidos.push(alvo.id)}
        lock={{ locked: Boolean(opcoes.locked), reason: "", monthClosed: false }}
        canExit
        blockedMove={() => opcoes.recusa ?? null}
        onBlockedMove={(motivo) => recusas.push(motivo)}
        nextStage={PROXIMA}
        dragging={false}
        onDragStart={() => undefined}
        onDragEnd={() => undefined}
      /> as ReactNode,
    );
  });
  const selo = container.querySelector('[aria-label="Visita agendada"]');
  const botao = container.querySelector('[role="button"]');
  const perder = container.querySelector<HTMLButtonElement>(
    '[aria-label="Perder o negócio de Cliente Teste"]',
  );
  if (perder) await act(async () => { perder.click(); });
  const corpo = container.querySelector<HTMLElement>('[role="button"]');
  await act(async () => {
    corpo?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }),
    );
  });
  const resultado = {
    movidos: [...movidos],
    recusas: [...recusas],
    temSelo: Boolean(selo),
    seloDentroDoBotao: Boolean(selo && botao?.contains(selo)),
    seloNoCartao: Boolean(selo && container.querySelector("article")?.contains(selo)),
    temPerder: Boolean(perder),
    perdidos: [...perdidos],
    texto: container.textContent ?? "",
    // O cartão já mostra a probabilidade em "%": contar é o que separa
    // "tem rateio" de "só tem a probabilidade".
    percentuais: (container.textContent ?? "").match(/%/g)?.length ?? 0,
  };
  await act(async () => { root.unmount(); });
  container.remove();
  return resultado;
}

describe("DealCard · indicador de visita", () => {
  it("acende quando o negócio tem visita agendada", async () => {
    const { temSelo, seloNoCartao } = await renderCard("2031-07-15T14:00:00+00:00");
    expect(temSelo, "visita gravada precisa acender o selo").toBe(true);
    expect(seloNoCartao, "o selo é do cartão").toBe(true);
  });

  it("fica fora do `role=\"button\"`, senão o leitor de tela não o anuncia", async () => {
    const { seloDentroDoBotao } = await renderCard("2031-07-15T14:00:00+00:00");
    expect(seloDentroDoBotao).toBe(false);
  });

  it("continua apagado sem visita", async () => {
    expect((await renderCard()).temSelo).toBe(false);
  });
});

/**
 * Perder pelo kanban e o rateio no cartão.
 *
 * Encerrar um negócio só existia na visão de TABELA: pelo kanban era preciso
 * trocar de visão. E o percentual do corretor (`share_pct`, que define
 * comissão) só aparecia dentro do modal, na aba Detalhes.
 */
describe("DealCard · perder e rateio", () => {
  it("oferece perder o negócio e chama o diálogo com o negócio certo", async () => {
    const { temPerder, perdidos } = await renderCard();
    expect(temPerder, "o kanban precisa encerrar sem trocar de visão").toBe(true);
    expect(perdidos).toEqual(["d1"]);
  });

  it("não oferece perder quando a linha está travada", async () => {
    expect((await renderCard(undefined, { locked: true })).temPerder).toBe(false);
  });

  it("mostra o rateio do corretor no cartão", async () => {
    expect((await renderCard(undefined, { share: 33.334 })).texto).toContain("33,3%");
  });

  it("sem rateio calculado não inventa 0%", async () => {
    const semRateio = await renderCard();
    const comRateio = await renderCard(undefined, { share: 50 });
    // Só a probabilidade do cartão; o rateio acrescentaria o segundo "%".
    expect(semRateio.percentuais).toBe(1);
    expect(comRateio.percentuais).toBe(2);
  });
});

/**
 * Shift+seta recusado não pode ser MUDO.
 *
 * O nome acessível do cartão anuncia "Shift com seta move de etapa" e o gesto
 * recusado simplesmente não acontecia: sem toast, sem foco, sem anúncio. O
 * botão de mover ao lado já põe o motivo no nome acessível — quem usa teclado
 * ficava sem nada. A frase sobe para o `role="status"` do quadro.
 */
describe("DealCard · Shift+seta", () => {
  it("move quando o destino é permitido", async () => {
    const { movidos, recusas } = await renderCard();
    expect(movidos).toEqual(["Aprovado"]);
    expect(recusas).toEqual([]);
  });

  it("não move e ANUNCIA o motivo quando o destino é recusado", async () => {
    const motivo = 'Seu perfil não pode mover negócios para "Aprovado".';
    const { movidos, recusas } = await renderCard(undefined, { recusa: motivo });
    expect(movidos, "gesto recusado não vira escrita").toEqual([]);
    expect(recusas, "e não vira silêncio").toEqual([motivo]);
  });
});
