import { describe, expect, it } from "vitest";
import type { MetaMetricaRow } from "@/integrations/supabase/analytics";
import { alertaDaCampanha, linhasDoPainel, resumoDoPainel, type CampanhaDaConta } from "./gestaoDeAnuncios";

const campanha = (id: string, extra: Partial<CampanhaDaConta> = {}): CampanhaDaConta => ({
  id, externalId: `ext-${id}`, name: id, status: "ACTIVE", dailyBudget: 50,
  metaAccountId: "acc", metaChannel: "formulario", metaBudgetLevel: "campaign", ...extra,
});
const metrica = (id: string, spend: number, resultados: number, channel: MetaMetricaRow["channel"] = "formulario") =>
  ({ campaign_id: id, channel, spend, resultados, ctr: 0.03 }) as MetaMetricaRow;

describe("gestão de anúncios", () => {
  it("vermelho = gastou sem lead; amarelo = custo acima do limite", () => {
    expect(alertaDaCampanha(30, 0, null, 12)).toBe("sem_lead");
    expect(alertaDaCampanha(43, 1, 43, 12)).toBe("cpl_alto");
    expect(alertaDaCampanha(36, 4, 9, 12)).toBe("ok");
    expect(alertaDaCampanha(0, 0, null, 12)).toBe("ok");
    expect(alertaDaCampanha(43, 1, 43, null)).toBe("ok");
  });

  it("ordena ativas saudáveis pelo menor custo, alertas e pausadas no fim; ignora campanha não sincronizada", () => {
    const linhas = linhasDoPainel(
      [campanha("cara"), campanha("barata"), campanha("zerada"), campanha("pausada", { status: "PAUSED" }),
        campanha("manual", { metaAccountId: null })],
      [metrica("cara", 40, 2), metrica("barata", 20, 4), metrica("zerada", 15, 0), metrica("pausada", 5, 1)],
      12,
    );
    expect(linhas.map((l) => l.id)).toEqual(["barata", "cara", "zerada", "pausada"]);
    expect(linhas.map((l) => l.alerta)).toEqual(["ok", "cpl_alto", "sem_lead", "ok"]);
  });

  it("resume ativas, verba, cadastros, conversas e investimento", () => {
    const linhas = linhasDoPainel(
      [campanha("f"), campanha("w", { metaChannel: "whatsapp", dailyBudget: 20 }), campanha("p", { status: "PAUSED" })],
      [metrica("f", 60, 5), metrica("w", 10, 4, "whatsapp"), metrica("p", 30, 0)],
      12,
    );
    expect(resumoDoPainel(linhas)).toMatchObject({
      ativas: 2, verbaDiaria: 70, cadastros: 5, custoPorCadastro: 18, conversas: 4, custoPorConversa: 2.5,
      investido: 100, cpl: 100 / 9, semLead: 1,
    });
  });
});
