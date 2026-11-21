import { describe, expect, it } from "vitest";
import { periodoAnteriorMeta } from "@/integrations/supabase/analytics";
import { resumoDoGrafico, serieDeCusto, totaisDaConta, variacao } from "./contasDaConta";

const dia = (day: string, spend: number, leads: number, extra: Partial<{ spend_conversa: number; conversas: number }> = {}) => ({
  day, spend, impressions: 1000, link_clicks: 20, resultados: leads, spend_lead: spend, resultados_lead: leads,
  spend_cadastro: spend, cadastros: leads, spend_conversa: 0, conversas: 0, ...extra,
});

describe("contas do painel da conta Meta", () => {
  it("totais: custo por resultado, CTR, CPM e CPC do período somado", () => {
    const t = totaisDaConta([dia("2026-11-01", 100, 10), dia("2026-11-02", 50, 5)]);
    expect(t.custoPorResultado).toBe(10);
    expect(t.ctr).toBeCloseTo(0.02);
    expect(t.cpm).toBe(75);
    expect(t.cpc).toBe(3.75);
  });

  it("variação sem base anterior não tem seta", () => {
    expect(variacao(120, 100)).toBeCloseTo(0.2);
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(null, 5)).toBeNull();
  });

  it("cadastro e conversa em linhas separadas; dia sem resultado fica sem ponto", () => {
    const dias = [dia("2026-11-03", 80, 4, { spend_conversa: 30, conversas: 6 }), dia("2026-11-04", 30, 0)];
    expect(serieDeCusto(dias, "cadastro")).toEqual([{ dia: "2026-11-03", rotulo: "03", cpl: 20 }, { dia: "2026-11-04", rotulo: "04", cpl: null }]);
    expect(serieDeCusto(dias, "conversa").map((d) => d.cpl)).toEqual([5, null]);
    expect(resumoDoGrafico(dias, "conversa")).toMatchObject({ resultados: 6, investido: 30, media: 5 });
  });

  it("média é gasto ÷ leads e a semana só compara com 14 dias", () => {
    const quinze = Array.from({ length: 15 }, (_, i) => dia(`2026-11-${String(i + 1).padStart(2, "0")}`, i < 7 ? 20 : 10, 1));
    const r = resumoDoGrafico(quinze, "cadastro");
    expect(r.media).toBeCloseTo((7 * 20 + 8 * 10) / 15);
    expect(r.primeiraParaUltima).toBeCloseTo(-0.5);
    expect(resumoDoGrafico(quinze.slice(0, 10), "cadastro").primeiraParaUltima).toBeNull();
  });

  it("período anterior: mesmos dias do mês passado, ou a mesma janela logo antes", () => {
    const hoje = new Date(2026, 10, 21);
    expect(periodoAnteriorMeta("mes_atual", hoje)).toEqual({ from: "2026-10-01", to: "2026-10-21" });
    expect(periodoAnteriorMeta("mes_anterior", hoje)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodoAnteriorMeta("7d", hoje)).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(periodoAnteriorMeta("mes_atual", new Date(2026, 2, 31))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
