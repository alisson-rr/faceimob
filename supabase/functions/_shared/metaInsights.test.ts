import { describe, expect, it } from "vitest";
import {
  canalDaCampanha, contarResultados, deCentavos, lerSaldoPrePago, paraCentavos, resultadoDoCanal,
} from "./metaInsights.ts";

/**
 * A regra de contagem decide o "custo por resultado" de cada canal. O sistema
 * antigo errava de três jeitos, e cada caso aqui trava um deles: pixel somado
 * com formulário, conversa contada duas vezes e gasto de WhatsApp dividido por
 * lead de formulário.
 */
const acao = (action_type: string, value: number) => ({ action_type, value: String(value) });

describe("contarResultados", () => {
  it("formulário e pixel nunca se somam, e o 'lead' agregado não entra", () => {
    const c = contarResultados([
      acao("onsite_conversion.lead_grouped", 3),
      acao("offsite_conversion.fb_pixel_lead", 5),
      acao("lead", 8), // soma pixel, formulário e offline
    ]);
    expect(c.leads_form).toBe(3);
    expect(c.lp_leads).toBe(5);
    expect(resultadoDoCanal("formulario", c)).toBe(3);
    expect(resultadoDoCanal("landing_page", c)).toBe(5);
  });

  it("conversa no WhatsApp é o MAIOR dos dois contadores, nunca a soma", () => {
    const started = "onsite_conversion.messaging_conversation_started_7d";
    const conexao = "onsite_conversion.total_messaging_connection";
    expect(contarResultados([acao(started, 4), acao(conexao, 6)]).conversations).toBe(6);
    expect(contarResultados([acao(started, 9), acao(conexao, 2)]).conversations).toBe(9);
  });

  it("visita na landing page é apoio: gravada, mas nunca vira resultado", () => {
    const c = contarResultados([acao("landing_page_view", 120)]);
    expect(c.lp_views).toBe(120);
    expect(resultadoDoCanal("landing_page", c)).toBe(0);
  });

  it("dia sem ações é zero em tudo, não erro", () => {
    expect(contarResultados(undefined)).toEqual({ leads_form: 0, conversations: 0, lp_leads: 0, lp_views: 0 });
  });
});

describe("canalDaCampanha", () => {
  it("decide pelo destino e pela otimização dos conjuntos, não pelo nome", () => {
    expect(canalDaCampanha([{ destination_type: "WHATSAPP" }])).toBe("whatsapp");
    expect(canalDaCampanha([{ destination_type: "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP" }])).toBe("whatsapp");
    expect(canalDaCampanha([{ destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION" }])).toBe("formulario");
    expect(canalDaCampanha([{ destination_type: "ON_AD", optimization_goal: "QUALITY_LEAD" }])).toBe("formulario");
    expect(canalDaCampanha([{ destination_type: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS" }])).toBe("landing_page");
    expect(canalDaCampanha([{ optimization_goal: "REACH" }])).toBe("outro");
  });

  it("conjuntos divergentes fazem a campanha 'misto'", () => {
    expect(
      canalDaCampanha([{ destination_type: "WHATSAPP" }, { destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION" }]),
    ).toBe("misto");
    expect(canalDaCampanha([{ destination_type: "WEBSITE" }, { destination_type: "WEBSITE" }])).toBe("landing_page");
  });

  it("sem conjuntos, só o objetivo antigo decide; o novo e ambíguo vira 'outro'", () => {
    expect(canalDaCampanha([], "MESSAGES")).toBe("whatsapp");
    expect(canalDaCampanha([], "LEAD_GENERATION")).toBe("formulario");
    expect(canalDaCampanha([], "OUTCOME_LEADS")).toBe("outro");
    expect(canalDaCampanha([])).toBe("outro");
  });
});

describe("resultadoDoCanal", () => {
  it("é o contador do canal; misto soma os três; outro não tem resultado", () => {
    const c = { leads_form: 2, conversations: 3, lp_leads: 4 };
    expect(resultadoDoCanal("whatsapp", c)).toBe(3);
    expect(resultadoDoCanal("misto", c)).toBe(9);
    expect(resultadoDoCanal("outro", c)).toBe(0);
  });
});

describe("centavos", () => {
  it("'12345' em centavos vira 123,45", () => {
    expect(deCentavos("12345")).toBe(123.45);
    expect(deCentavos(12345)).toBe(123.45);
    expect(deCentavos("0")).toBe(0);
  });

  it("valor que não é centavo inteiro fica nulo, nunca zero", () => {
    for (const v of ["", " ", "12.5", "-300", "abc", null, undefined, {}]) expect(deCentavos(v), String(v)).toBeNull();
  });

  it("reais viram centavos inteiros e voltam iguais", () => {
    expect(paraCentavos(19.99)).toBe(1999);
    expect(paraCentavos(123.45)).toBe(12345);
    expect(paraCentavos(deCentavos("15000") ?? Number.NaN)).toBe(15000);
  });

  it("verba negativa ou não numérica é recusada, não arredondada", () => {
    expect(() => paraCentavos(-1)).toThrow(RangeError);
    expect(() => paraCentavos(Number.NaN)).toThrow(RangeError);
  });
});

describe("lerSaldoPrePago", () => {
  it("lê o saldo em R$ nos dois formatos que a Meta usa", () => {
    expect(lerSaldoPrePago("R$ 1.234,56")).toBe(1234.56);
    expect(lerSaldoPrePago("Saldo disponível (R$ 1.234,56 BRL)")).toBe(1234.56);
    expect(lerSaldoPrePago("Available balance (R$1,234.56 BRL)")).toBe(1234.56);
    expect(lerSaldoPrePago("R$ 0,00")).toBe(0);
  });

  it("texto estranho vira nulo em vez de um saldo adivinhado", () => {
    for (const t of ["Visa ****1234", "R$ 1.234", "R$ 10,00 e R$ 5,00", "$1,234.56 USD", "R$ abc", "", null, undefined]) {
      expect(lerSaldoPrePago(t), String(t)).toBeNull();
    }
  });
});
