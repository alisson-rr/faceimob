import { describe, expect, it } from "vitest";
import type { LinhaDoPainel } from "./gestaoDeAnuncios";
import { simularVerba, verbaDoDegrau } from "./simuladorDeVerba";

/** Linha ativa de CBO com a verba e o CPL do período (null = sem lead). */
const linha = (id: string, verba: number, cpl: number | null, extra: Partial<LinhaDoPainel> = {}): LinhaDoPainel => ({
  id, externalId: `ext-${id}`, name: id, status: "ACTIVE", dailyBudget: verba, metaAccountId: "acc",
  metaChannel: "formulario", metaBudgetLevel: "campaign", ativa: true, canal: "formulario",
  investido: cpl === null ? 50 : cpl * 10, resultados: cpl === null ? 0 : 10, custoPorResultado: cpl, ctr: null,
  alerta: cpl === null ? "sem_lead" : "ok", ...extra,
});

const porId = (s: ReturnType<typeof simularVerba>) => Object.fromEntries(s.ajustes.map((a) => [a.id, a.para]));

describe("simulador de verba diária", () => {
  it("nenhuma campanha muda mais de 20%, nem para cima nem para baixo", () => {
    const linhas = [linha("a", 100, 5), linha("b", 100, 10), linha("c", 100, 30), linha("d", 37.33, null)];
    for (const alvo of [0, 150, 300, 337, 1000]) {
      for (const estrategia of ["mais_leads", "proporcional"] as const) {
        for (const a of simularVerba(linhas, alvo, estrategia).ajustes) {
          expect(Math.abs(a.variacao)).toBeLessThanOrEqual(0.2);
        }
      }
    }
  });

  it("mais leads: sobe primeiro o menor CPL e não dá verba a quem não gerou lead", () => {
    const s = simularVerba([linha("barata", 100, 5), linha("media", 100, 10), linha("semLead", 100, null)], 330, "mais_leads");
    // +30: a barata sobe os 20% dela e a média completa com 10; a sem lead fica.
    expect(porId(s)).toEqual({ barata: 120, media: 110 });
    expect(s.totalNovo).toBe(330);
    expect(s.leadsNovos ?? 0).toBeGreaterThan(s.leadsAtuais ?? 0);
  });

  it("mesmo total: tira de quem está acima do CPL médio e dá a quem está abaixo", () => {
    expect(porId(simularVerba([linha("boa", 100, 5), linha("semLead", 100, null)], 200, "mais_leads")))
      .toEqual({ boa: 120, semLead: 80 });
    const s = simularVerba([linha("boa", 100, 5), linha("ruim", 100, 20)], 200, "mais_leads");
    expect(porId(s)).toEqual({ boa: 120, ruim: 80 });
    expect(s.totalNovo).toBe(200);
    expect(s.cplNovo ?? 0).toBeLessThan(s.cplAtual ?? 0);
    // Corte antes da subida: a conta nunca passa do alvo no meio da execução.
    expect(s.ajustes.map((a) => a.id)).toEqual(["ruim", "boa"]);
  });

  it("campanha que ainda não gastou não é punida na realocação", () => {
    const s = simularVerba([linha("boa", 100, 5), linha("nova", 100, null, { investido: 0, alerta: "ok" })], 200, "mais_leads");
    expect(s.ajustes).toEqual([]);
  });

  it("alvo acima do teto: chega até onde dá hoje e informa o teto", () => {
    const s = simularVerba([linha("a", 100, 5), linha("b", 50, 8)], 1000, "mais_leads");
    expect(s.totalNovo).toBe(180);
    expect(s.teto).toBe(180);
    expect(s.piso).toBe(120);
  });

  it("proporcional: todas no mesmo percentual, presas aos 20%", () => {
    expect(porId(simularVerba([linha("a", 100, 5), linha("b", 50, 20)], 165, "proporcional"))).toEqual({ a: 110, b: 55 });
    expect(porId(simularVerba([linha("a", 100, 5), linha("b", 50, 20)], 1000, "proporcional"))).toEqual({ a: 120, b: 60 });
  });

  it("fora do simulador: pausada não conta; verba total e nível não sincronizado ficam de fora", () => {
    const s = simularVerba([
      linha("ok", 100, 5),
      linha("pausada", 100, 5, { ativa: false }),
      linha("total", 100, 5, { metaBudgetLevel: "lifetime" }),
      linha("semNivel", 100, 5, { metaBudgetLevel: null }),
    ], 120, "mais_leads");
    expect(s.campanhas).toBe(1);
    expect(s.foraDoSimulador).toBe(2);
    expect(porId(s)).toEqual({ ok: 120 });
  });

  it("verba quebrada não escapa dos 20% no arredondamento", () => {
    const s = simularVerba([linha("x", 33.33, 5)], 1000, "mais_leads");
    expect(s.ajustes[0].para).toBe(39.99);
  });

  it("degrau de ±20% dos botões nunca passa do limite", () => {
    expect(verbaDoDegrau(50, 1)).toBe(60);
    expect(verbaDoDegrau(50, -1)).toBe(40);
    expect(verbaDoDegrau(33.33, 1)).toBe(39.99);
    expect(verbaDoDegrau(33.33, -1)).toBe(26.67);
  });
});
