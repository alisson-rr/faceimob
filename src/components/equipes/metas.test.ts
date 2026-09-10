import { describe, expect, it } from "vitest";
import { goalPeriods, goalsByProfile, otherMetricsByProfile, parseGoal } from "./metas";

describe("goalPeriods", () => {
  it("devolve o primeiro dia do mês e do ano, como goals.period guarda", () => {
    expect(goalPeriods(new Date(2026, 8, 17))).toEqual({ month: "2026-09-01", year: "2026-01-01" });
  });

  it("acerta as bordas do ano — é onde um mês montado à mão erra", () => {
    expect(goalPeriods(new Date(2026, 0, 1))).toEqual({ month: "2026-01-01", year: "2026-01-01" });
    expect(goalPeriods(new Date(2026, 11, 31))).toEqual({ month: "2026-12-01", year: "2026-01-01" });
  });
});

describe("parseGoal", () => {
  it("campo vazio conta como zero", () => {
    expect(parseGoal("")).toBe(0);
    expect(parseGoal("   ")).toBe(0);
  });

  it("aceita número não negativo, com espaço em volta", () => {
    expect(parseGoal("300000")).toBe(300000);
    expect(parseGoal(" 250.5 ")).toBe(250.5);
    expect(parseGoal("0")).toBe(0);
  });

  it("recusa negativo e lixo em vez de mandar ao banco e colher 23514", () => {
    expect(parseGoal("-1")).toBeNull();
    expect(parseGoal("abc")).toBeNull();
    expect(parseGoal("1e999")).toBeNull();
  });
});

describe("goalsByProfile", () => {
  const periods = goalPeriods(new Date(2026, 8, 17)); // setembro/2026

  it("separa mês e ano do mesmo perfil", () => {
    const map = goalsByProfile(
      [
        { profile_id: "p1", period_type: "month", period: "2026-09-01", target: 300000 },
        { profile_id: "p1", period_type: "year", period: "2026-01-01", target: 3600000 },
      ],
      periods,
    );
    expect(map.get("p1")).toEqual({ monthly: 300000, yearly: 3600000 });
  });

  it("ignora a meta MENSAL de janeiro — ela tem o mesmo period do ano", () => {
    const map = goalsByProfile(
      [
        { profile_id: "p1", period_type: "month", period: "2026-01-01", target: 999 },
        { profile_id: "p1", period_type: "month", period: "2026-09-01", target: 300000 },
        { profile_id: "p1", period_type: "year", period: "2026-01-01", target: 3600000 },
      ],
      periods,
    );
    expect(map.get("p1")).toEqual({ monthly: 300000, yearly: 3600000 });
  });

  it("descarta linha sem perfil e período de outro mês", () => {
    const map = goalsByProfile(
      [
        { profile_id: null, period_type: "month", period: "2026-09-01", target: 1 },
        { profile_id: "p2", period_type: "month", period: "2026-08-01", target: 2 },
      ],
      periods,
    );
    expect(map.size).toBe(0);
  });
});

/**
 * A tela filtrava `metric = 'vgv'` na CONSULTA e escrevia R$ 0,00 por cima de
 * quem tinha meta: na homologação existem 7 metas de vendas e 3 de visitas, e
 * nenhuma tela as mostrava. Agora a consulta traz tudo e quem separa é o mapa.
 */
describe("goalsByProfile por métrica", () => {
  const periods = { month: "2026-09-01", year: "2026-01-01" };
  const linhas = [
    { profile_id: "p1", period_type: "month", period: "2026-09-01", target: 300000, metric: "vgv" },
    { profile_id: "p1", period_type: "month", period: "2026-09-01", target: 3, metric: "sales" },
    { profile_id: "p1", period_type: "month", period: "2026-09-01", target: 10, metric: "visits" },
    { profile_id: "p2", period_type: "month", period: "2026-09-01", target: 5, metric: "sales" },
  ];

  it("a meta de vendas não é lida como VGV", () => {
    expect(goalsByProfile(linhas, periods).get("p1")).toEqual({ monthly: 300000, yearly: 0 });
    expect(goalsByProfile(linhas, periods).has("p2")).toBe(false);
  });

  it("linha sem métrica continua sendo VGV (dado antigo)", () => {
    expect(goalsByProfile([{ profile_id: "p3", period_type: "month", period: "2026-09-01", target: 7 }], periods)
      .get("p3")).toEqual({ monthly: 7, yearly: 0 });
  });

  it("as metas que não são de VGV viram uma linha legível, sem sumir da tela", () => {
    const outras = otherMetricsByProfile(linhas, periods);
    expect(outras.get("p1")).toBe("Vendas 3 · Visitas 10");
    expect(outras.get("p2")).toBe("Vendas 5");
    // VGV não se repete ali: ele já tem o próprio campo.
    expect(outras.get("p1")).not.toMatch(/VGV/);
  });

  it("só o mês corrente entra na linha de leitura", () => {
    const outras = otherMetricsByProfile(
      [{ profile_id: "p1", period_type: "month", period: "2026-08-01", target: 9, metric: "sales" }],
      periods,
    );
    expect(outras.size).toBe(0);
  });
});
