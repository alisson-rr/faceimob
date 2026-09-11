import { describe, expect, it } from "vitest";
import { type GraphAdset, type GraphInsight, hojeNoFuso, janelaPedida, montarConta, montarPayload } from "./montar.ts";

/**
 * O payload é o que apaga e regrava o livro do gasto. Cada caso trava um jeito
 * de o número sair errado sem ninguém ver: verba ABO somada com conjunto
 * pausado, centavo lido como real, gasto de campanha apagada descartado,
 * resultado contado pelo canal errado e métrica ilegível virando zero.
 */
const janela = { inicio: "2026-09-01", fim: "2026-09-11" };
const acao = (action_type: string, value: number) => ({ action_type, value: String(value) });

const base = {
  janelaPedida: janela,
  janelaBuscada: { inicio: "2026-08-01", fim: "2026-09-11" },
  conta: {},
  construtoras: [
    { id: "dev-casa-nova", name: "Casa Nova" },
    { id: "dev-casa-bella", name: "Casa Bella" },
  ],
};

const adsetsFixture: GraphAdset[] = [
  // CBO de WhatsApp: a verba é da campanha; o conjunto só diz o canal.
  { id: "s1", campaign_id: "c-cbo", status: "ACTIVE", destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS" },
  // ABO de formulário: 30 + 20 ativos; o pausado (99) fica fora da soma.
  { id: "s2", campaign_id: "c-abo", status: "ACTIVE", destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", daily_budget: "3000" },
  { id: "s3", campaign_id: "c-abo", status: "ACTIVE", destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", daily_budget: "2000" },
  { id: "s4", campaign_id: "c-abo", status: "PAUSED", destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", daily_budget: "9900" },
];

const insightsFixture: GraphInsight[] = [
  {
    campaign_id: "c-cbo", campaign_name: "CASA NOVA | WHATSAPP", date_start: "2026-09-10",
    spend: "123.45", impressions: "1000", reach: "800", clicks: "40", inline_link_clicks: "25",
    actions: [
      acao("onsite_conversion.messaging_conversation_started_7d", 4),
      acao("onsite_conversion.total_messaging_connection", 6),
      acao("onsite_conversion.lead_grouped", 9),
    ],
  },
  {
    campaign_id: "c-abo", campaign_name: "Sem padrão", date_start: "2026-09-10",
    spend: "50", impressions: "500", actions: [acao("onsite_conversion.lead_grouped", 3), acao("offsite_conversion.fb_pixel_lead", 7)],
  },
];

function montar(extra: Partial<Parameters<typeof montarPayload>[0]> = {}) {
  return montarPayload({
    ...base,
    campanhas: [
      { id: "c-cbo", name: "CASA NOVA | WHATSAPP", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: "5000" },
      { id: "c-abo", name: "Sem padrão", status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_LEADS" },
    ],
    adsets: adsetsFixture,
    insights: insightsFixture,
    ...extra,
  });
}

describe("montarPayload", () => {
  it("CBO usa a verba da campanha; ABO soma só os conjuntos ativos; centavos viram reais", () => {
    const { campanhas } = montar();
    const cbo = campanhas.find((c) => c.external_id === "c-cbo")!;
    const abo = campanhas.find((c) => c.external_id === "c-abo")!;
    expect(cbo).toMatchObject({ budget_level: "campaign", daily_budget: 50, lifetime_budget: null });
    expect(abo).toMatchObject({ budget_level: "adset", daily_budget: 50, lifetime_budget: null });
  });

  it("verba total (lifetime) na campanha fica como lifetime, sem verba diária", () => {
    const { campanhas } = montar({
      campanhas: [{ id: "c-life", name: "X", status: "ACTIVE", lifetime_budget: "150000" }],
      adsets: [],
      insights: [],
    });
    expect(campanhas[0]).toMatchObject({ budget_level: "lifetime", daily_budget: null, lifetime_budget: 1500 });
  });

  it("canal sai do destination_type e o resultado é o contador do canal", () => {
    const { campanhas, insights } = montar();
    expect(campanhas.find((c) => c.external_id === "c-cbo")!.channel).toBe("whatsapp");
    expect(campanhas.find((c) => c.external_id === "c-abo")!.channel).toBe("formulario");

    const zap = insights.find((i) => i.external_id === "c-cbo")!;
    // WhatsApp: o MAIOR dos dois contadores de conversa, nunca a soma; o lead de
    // formulário do mesmo dia fica gravado, mas não é o resultado desta campanha.
    expect(zap).toMatchObject({ conversations: 6, leads_form: 9, resultados: 6, spend: 123.45, link_clicks: 25, reach: 800 });
    const form = insights.find((i) => i.external_id === "c-abo")!;
    expect(form).toMatchObject({ leads_form: 3, lp_leads: 7, resultados: 3, clicks: 0, reach: 0 });
  });

  it("campanha que só aparece nos insights entra como ARCHIVED com o nome deles, e o gasto não é descartado", () => {
    const { campanhas, insights } = montar({
      insights: [...insightsFixture, { campaign_id: "c-apagada", campaign_name: "Casa Bella | LP", date_start: "2026-09-09", spend: "10.5" }],
    });
    expect(campanhas.find((c) => c.external_id === "c-apagada")).toMatchObject({
      name: "Casa Bella | LP", status: "ARCHIVED", budget_level: null, daily_budget: null,
    });
    expect(insights.find((i) => i.external_id === "c-apagada")).toMatchObject({ day: "2026-09-09", spend: 10.5 });
  });

  it("sugere a construtora só quando o nome está no padrão e casa com uma só", () => {
    const { campanhas } = montar();
    expect(campanhas.find((c) => c.external_id === "c-cbo")!.developer_suggested_id).toBe("dev-casa-nova");
    expect(campanhas.find((c) => c.external_id === "c-abo")!.developer_suggested_id).toBeNull();
  });

  it("leva as duas janelas e a conta no formato da meta_sync_apply", () => {
    const p = montar({ conta: { name: "Conta", timezone_name: "America/Sao_Paulo", account_status: 1, amount_spent: "12345", spend_cap: "0" } });
    expect(p.janela_pedida).toEqual(janela);
    expect(p.janela_buscada).toEqual({ inicio: "2026-08-01", fim: "2026-09-11" });
    expect(p.conta).toMatchObject({ account_status: 1, amount_spent: 123.45, spend_cap: 0, is_prepay: null, prepay_available: null });
  });

  it("métrica ilegível lança em vez de virar zero", () => {
    expect(() => montar({ insights: [{ campaign_id: "c-cbo", date_start: "2026-09-10", spend: "abc" }] })).toThrow(/ilegível/);
    expect(() => montar({ insights: [{ campaign_id: "c-cbo", date_start: "2026-09-10", impressions: "1.5" }] })).toThrow(/ilegível/);
    expect(() => montar({ insights: [{ campaign_id: "c-cbo", spend: "1" }] })).toThrow(/sem dia/);
  });
});

describe("montarConta", () => {
  it("pré-paga lê o saldo do display_string; pós-paga nunca tem saldo", () => {
    expect(montarConta({ is_prepay_account: true, funding_source_details: { display_string: "Saldo disponível (R$ 1.234,56 BRL)" } }))
      .toMatchObject({ is_prepay: true, prepay_available: 1234.56 });
    expect(montarConta({ is_prepay_account: false, funding_source_details: { display_string: "R$ 99,00" } }).prepay_available).toBeNull();
    expect(montarConta({ is_prepay_account: true, funding_source_details: { display_string: "Visa ****1234" } }).prepay_available).toBeNull();
  });
});

describe("janelaPedida", () => {
  it("com sincronização diária é min(hoje − dias, dia 1 do mês) até hoje", () => {
    expect(janelaPedida("2026-09-11", 7, "2026-09-10")).toEqual({ inicio: "2026-09-01", fim: "2026-09-11" });
    expect(janelaPedida("2026-09-03", 7, "2026-09-02")).toEqual({ inicio: "2026-08-27", fim: "2026-09-03" });
    expect(janelaPedida("2026-09-20", 90, "2026-09-19").inicio).toBe("2026-06-22");
  });

  it("a primeira sincronização da conta vai até o dia 1 do mês anterior, inclusive na virada do ano", () => {
    expect(janelaPedida("2026-09-11", 7, null).inicio).toBe("2026-08-01");
    expect(janelaPedida("2026-01-05", 7, null).inicio).toBe("2025-12-01");
  });

  it("na volta de uma parada começa no dia da última sincronização boa, no fuso da conta", () => {
    // Cenário da conferência: ok em 19/08, o token expira e volta em 11/09. A
    // janela era 01/09–11/09 e 20–31/08 nunca eram buscados (total 610, real 730).
    // 01:30 UTC de 20/08 = 22:30 de 19/08 em São Paulo, como o index.ts converte.
    const ultimaOk = hojeNoFuso("America/Sao_Paulo", new Date("2026-08-20T01:30:00+00:00"));
    expect(ultimaOk).toBe("2026-08-19");
    expect(janelaPedida("2026-09-11", 7, ultimaOk)).toEqual({ inicio: "2026-08-19", fim: "2026-09-11" });
  });

  it("parada maior que 90 dias volta só 90 dias", () => {
    expect(janelaPedida("2026-09-11", 7, "2026-01-10").inicio).toBe("2026-06-13");
  });
});

describe("hojeNoFuso", () => {
  it("usa o fuso da conta e cai em São Paulo quando o fuso é inválido", () => {
    const agora = new Date("2026-09-11T02:00:00Z"); // 23:00 de 10/09 em São Paulo
    expect(hojeNoFuso("America/Sao_Paulo", agora)).toBe("2026-09-10");
    expect(hojeNoFuso("Asia/Tokyo", agora)).toBe("2026-09-11");
    expect(hojeNoFuso("Fuso/Inexistente", agora)).toBe("2026-09-10");
    expect(hojeNoFuso(null, agora)).toBe("2026-09-10");
  });
});
