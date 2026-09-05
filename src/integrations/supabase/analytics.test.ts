import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: { from, rpc } }));

import {
  aportePayload,
  campaignStats,
  costPerLead,
  cplTone,
  createAdCampaign,
  deleteAdCampaign,
  developerSummary,
  monthOverMonth,
  previousMonth,
  roas,
  roasLabel,
  updateAdCampaign,
} from "./analytics";

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

/** Builder mínimo do PostgREST: `select` fecha a cadeia e resolve o resultado. */
function tabela(resultado: { data: unknown; error: unknown }) {
  const chamadas = { insert: null as unknown, upsert: null as unknown, onConflict: null as unknown, update: null as unknown, filtros: [] as [string, unknown][] };
  const chain = {
    insert: vi.fn((payload: unknown) => { chamadas.insert = payload; return Promise.resolve(resultado); }),
    upsert: vi.fn((payload: unknown, options?: unknown) => { chamadas.upsert = payload; chamadas.onConflict = options; return Promise.resolve(resultado); }),
    update: vi.fn((payload: unknown) => { chamadas.update = payload; return chain; }),
    delete: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => { chamadas.filtros.push([col, val]); return chain; }),
    select: vi.fn(() => Promise.resolve(resultado)),
  };
  from.mockReturnValue(chain);
  return { chain, chamadas };
}

describe("custo por lead", () => {
  it("divide gasto por leads", () => {
    expect(costPerLead(3000, 24)).toBe(125);
  });

  // O caso que trava a regressão de inverter a divisão: 24/3000 daria 0,008.
  it("não inverte a divisão", () => {
    expect(costPerLead(1000, 4)).toBe(250);
    expect(costPerLead(4, 1000)).not.toBe(250);
  });

  it("sem lead devolve null em vez de zero — R$ 0,00 por lead mentiria", () => {
    expect(costPerLead(3000, 0)).toBeNull();
  });
});

describe("roas", () => {
  it("é VGV ganho dividido pelo gasto da campanha", () => {
    expect(roas(600000, 12000)).toBe(50);
  });

  it("sem gasto não há retorno a medir (não vira infinito)", () => {
    expect(roas(600000, 0)).toBeNull();
    expect(roas(600000, -1)).toBeNull();
  });

  it("sem venda o zero é informação verdadeira", () => {
    expect(roas(0, 12000)).toBe(0);
  });

  it("o rótulo é uma casa decimal com × — e travessão quando não há ROAS", () => {
    expect(roasLabel(roas(794320, 12800))).toBe("62,1×");
    expect(roasLabel(roas(0, 12800))).toBe("0×");
    expect(roasLabel(null)).toBe("—");
  });
});

describe("cor do CPL", () => {
  // A escala fixa (verde < 15) nunca disparava: o CPL real é de centenas de
  // reais e 100% das linhas saíam vermelhas. A comparação é com a média.
  it("compara com a média do recorte, não com um número fixo", () => {
    expect(cplTone(500, 1000)).toBe("success");
    expect(cplTone(1000, 1000)).toBe("warning");
    expect(cplTone(1500, 1000)).toBe("danger");
  });

  it("as bordas de 80% e 120% da média são inclusivas no lado bom", () => {
    expect(cplTone(800, 1000)).toBe("success");
    expect(cplTone(801, 1000)).toBe("warning");
    expect(cplTone(1200, 1000)).toBe("warning");
    expect(cplTone(1201, 1000)).toBe("danger");
  });

  it("sem CPL ou sem média não há comparação", () => {
    expect(cplTone(null, 1000)).toBe("neutral");
    expect(cplTone(500, null)).toBe("neutral");
    expect(cplTone(500, 0)).toBe("neutral");
  });
});

/**
 * A regressão que este bloco trava: os dois formulários de aporte mandavam
 * `notes: form.notes.trim() || null` sempre. Salvar de novo com o campo Nota em
 * branco — que é o estado normal do formulário vazio — gravava `notes = null`
 * por cima de uma nota já lançada, com toast de sucesso e sem aviso. É o mesmo
 * apagão que a importação de planilha já evitava omitindo a coluna.
 */
describe("aportePayload", () => {
  const base = { period: "2026-09-01", developer_id: "d1", amount: 7500 };

  it("sem Editar e com a nota em branco, `notes` NÃO vai no payload", () => {
    const payload = aportePayload({ ...base, notes: "   ", editing: false });
    expect(payload).not.toHaveProperty("notes");
    expect(payload).toEqual(base);
  });

  it("nota preenchida vai aparada, mesmo sem Editar", () => {
    expect(aportePayload({ ...base, notes: "  campanha de setembro ", editing: false }))
      .toEqual({ ...base, notes: "campanha de setembro" });
  });

  // Editando, a nota estava no campo e o operador a limpou: aí o branco é ordem.
  it("editando, a nota em branco vira null — apagar é intenção explícita", () => {
    expect(aportePayload({ ...base, notes: "", editing: true }))
      .toEqual({ ...base, notes: null });
  });

  it("editando com nota preenchida, grava a nota nova", () => {
    expect(aportePayload({ ...base, notes: "corrigido", editing: true }))
      .toEqual({ ...base, notes: "corrigido" });
  });
});

describe("createAdCampaign", () => {
  it("recusa investimento negativo antes de bater no banco", async () => {
    await expect(
      createAdCampaign({ externalId: "x", platform: "meta", name: "N", totalSpend: -500 }),
    ).rejects.toThrow(/negativo/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("grava plataforma, construtora e status escolhidos", async () => {
    const { chamadas } = tabela({ data: null, error: null });

    await createAdCampaign({
      externalId: "ext-1",
      platform: "google",
      name: "Pesquisa",
      developerId: "dev-1",
      status: "PAUSED",
      totalSpend: 900,
    });

    expect(from).toHaveBeenCalledWith("ad_campaigns");
    expect(chamadas.insert).toEqual({
      external_id: "ext-1",
      platform: "google",
      name: "Pesquisa",
      developer_id: "dev-1",
      status: "PAUSED",
      daily_budget: null,
      total_spend: 900,
    });
  });

  // A trava da regressão que motivou a troca de `upsert` por `insert`: com
  // `upsert` em (platform, external_id), cadastrar um id externo que já existe
  // SOBRESCREVIA a campanha — zerava `daily_budget` — e o toast dizia
  // "Campanha registrada". Perda de dado sem rastro, no campo da verba.
  it("id externo repetido vira mensagem que diz o que fazer, não 23505 cru", async () => {
    tabela({ data: null, error: { code: "23505", message: "duplicate key" } });

    await expect(
      createAdCampaign({ externalId: "ext-1", platform: "meta", name: "Outra" }),
    ).rejects.toThrow(/já (existe|está)/i);
  });

  it("não manda total_spend quando o campo não foi preenchido", async () => {
    const { chamadas } = tabela({ data: null, error: null });

    await createAdCampaign({ externalId: "ext-2", platform: "meta", name: "Sem gasto" });

    expect(chamadas.insert).not.toHaveProperty("total_spend");
  });

  // O check `ad_campaigns_budget_not_negative` (0063) já recusaria; parar aqui
  // troca um 23514 genérico por uma frase que diz o que corrigir.
  it("recusa orçamento diário negativo antes de bater no banco", async () => {
    await expect(
      createAdCampaign({ externalId: "x", platform: "meta", name: "N", dailyBudget: -1 }),
    ).rejects.toThrow(/orçamento diário/i);
    expect(from).not.toHaveBeenCalled();
  });

  // O campo passou a existir no formulário: antes a coluna era sempre nula.
  it("grava o orçamento diário informado", async () => {
    const { chamadas } = tabela({ data: null, error: null });

    await createAdCampaign({ externalId: "ext-3", platform: "meta", name: "Com teto", dailyBudget: 150 });

    expect(chamadas.insert).toMatchObject({ daily_budget: 150 });
  });
});

describe("updateAdCampaign", () => {
  it("corrige o id externo pela chave `id` (o upsert criaria uma segunda linha)", async () => {
    const { chamadas } = tabela({ data: [{ id: "c1" }], error: null });

    await updateAdCampaign("c1", { externalId: "certo", platform: "meta", name: "N", totalSpend: 10 });

    expect(chamadas.filtros).toEqual([["id", "c1"]]);
    expect(chamadas.update).toMatchObject({ external_id: "certo", total_spend: 10 });
  });

  // O RLS não erra ao recusar: filtra a linha e o PostgREST devolve 204.
  it("update que não casa linha é falta de permissão, não sucesso", async () => {
    tabela({ data: [], error: null });
    await expect(
      updateAdCampaign("c1", { externalId: "e", platform: "meta", name: "N" }),
    ).rejects.toThrow(/permissão/i);
  });

  /**
   * O `update` não mandava `daily_budget` de jeito nenhum: com o campo novo no
   * formulário, corrigir a campanha precisa gravar o teto — e quem chamar sem
   * informar o campo não pode apagar o valor que a plataforma gravou.
   */
  it("grava o orçamento diário informado e omite a coluna quando ele não vem", async () => {
    const comTeto = tabela({ data: [{ id: "c1" }], error: null });
    await updateAdCampaign("c1", { externalId: "e", platform: "meta", name: "N", dailyBudget: 80 });
    expect(comTeto.chamadas.update).toMatchObject({ daily_budget: 80 });

    const semTeto = tabela({ data: [{ id: "c1" }], error: null });
    await updateAdCampaign("c1", { externalId: "e", platform: "meta", name: "N" });
    expect(semTeto.chamadas.update).not.toHaveProperty("daily_budget");
  });

  // Branco no formulário vira `null` explícito: "sem teto lançado", que é
  // diferente de "não mexa" (undefined) e de "teto de R$ 0,00".
  it("orçamento nulo é gravado como null, e não descartado", async () => {
    const { chamadas } = tabela({ data: [{ id: "c1" }], error: null });
    await updateAdCampaign("c1", { externalId: "e", platform: "meta", name: "N", dailyBudget: null });
    expect(chamadas.update).toMatchObject({ daily_budget: null });
  });
});

describe("deleteAdCampaign", () => {
  it("delete que não casa linha é falta de permissão, não sucesso", async () => {
    tabela({ data: [], error: null });
    await expect(deleteAdCampaign("c1")).rejects.toThrow(/permissão/i);
  });

  it("com linha casada, remove sem erro", async () => {
    const { chamadas } = tabela({ data: [{ id: "c1" }], error: null });
    await expect(deleteAdCampaign("c1")).resolves.toBeUndefined();
    expect(chamadas.filtros).toEqual([["id", "c1"]]);
  });
});

describe("leitura agregada", () => {
  // O PostgREST entrega `numeric` como string: sem o Number() a soma na tela
  // vira concatenação ("1000" + "500" = "1000500").
  it("campaignStats converte numeric de texto para número", async () => {
    rpc.mockResolvedValue({ data: [{ campaign_id: "c", leads: 3, conversions: 1, sales: 1, revenue: "200000.00" }], error: null });

    const [linha] = await campaignStats();

    expect(rpc).toHaveBeenCalledWith("marketing_campaign_stats");
    expect(linha.revenue).toBe(200000);
  });

  /**
   * `conversions` é lead com `converted_deal_id`: proposta em aberto e venda
   * PERDIDA entram. `sales` (0081) só conta negócio ganho. Custo/negócio e
   * custo/venda dividem o mesmo gasto por denominadores diferentes — quem lia
   * só o primeiro entendia "paguei X por uma venda" sem ter vendido nada.
   */
  it("campaignStats separa negócios de VENDAS, e o custo por venda usa o segundo", async () => {
    rpc.mockResolvedValue({ data: [{ campaign_id: "c", leads: 10, conversions: 4, sales: 1, revenue: "500000" }], error: null });

    const [linha] = await campaignStats();

    expect(linha.conversions).toBe(4);
    expect(linha.sales).toBe(1);
    expect(costPerLead(4000, linha.conversions)).toBe(1000);
    expect(costPerLead(4000, linha.sales)).toBe(4000);
  });

  // Campanha sem venda: o custo por venda é travessão, não R$ 0,00.
  it("sem venda, o custo por venda não existe (null), em vez de zero", async () => {
    rpc.mockResolvedValue({ data: [{ campaign_id: "c", leads: 10, conversions: 2, sales: 0, revenue: "0" }], error: null });

    const [linha] = await campaignStats();

    expect(linha.sales).toBe(0);
    expect(costPerLead(4000, linha.sales)).toBeNull();
  });

  /**
   * Retorno sobre APORTE, a coluna que só aparece com um mês escolhido: aporte
   * e VGV compartilham a janela mensal, então é a única divisão do mês que faz
   * sentido. O ROAS de campanha continua fora do mês porque
   * `ad_campaigns.total_spend` é acumulado da vida da campanha.
   */
  it("retorno sobre aporte é VGV do mês dividido pelo aporte do mês, e não existe sem aporte", async () => {
    rpc.mockResolvedValue({
      data: [
        { developer_id: "d1", developer_name: "Horizonte", active: true, investment: "37900", campaign_spend: "1000", campaigns: 1, leads: 4, deals: 2, sales: 1, vgv: "379000" },
        { developer_id: "d2", developer_name: "Sem aporte", active: true, investment: "0", campaign_spend: "500", campaigns: 1, leads: 1, deals: 0, sales: 0, vgv: "0" },
      ],
      error: null,
    });

    const [comAporte, semAporte] = await developerSummary("2026-09-01");

    expect(roas(comAporte.vgv, comAporte.investment)).toBe(10);
    expect(roas(semAporte.vgv, semAporte.investment)).toBeNull();
  });

  it("developerSummary manda o período e mantém o balde sem construtora", async () => {
    rpc.mockResolvedValue({
      data: [{ developer_id: null, developer_name: "Sem construtora", active: false, investment: "0", campaign_spend: "500", campaigns: 1, leads: 6, deals: 0, sales: 0, vgv: "0" }],
      error: null,
    });

    const [linha] = await developerSummary("2026-09-01");

    expect(rpc).toHaveBeenCalledWith("marketing_developer_summary", { p_period: "2026-09-01" });
    expect(linha.developer_id).toBeNull();
    expect(linha.campaign_spend).toBe(500);
    expect(linha.leads).toBe(6);
  });

  it("período nulo pede todo o acumulado", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await developerSummary(null);
    expect(rpc).toHaveBeenCalledWith("marketing_developer_summary", { p_period: null });
  });
});

describe("mês anterior", () => {
  it("volta um mês dentro do mesmo ano", () => {
    expect(previousMonth("2026-09-01")).toBe("2026-08-01");
    expect(previousMonth("2026-11-01")).toBe("2026-10-01");
  });

  // `new Date("2026-01-01")` é meia-noite UTC e no fuso do Brasil já é 31/12:
  // pela via do Date, o anterior de janeiro daria novembro.
  it("janeiro volta para dezembro do ano anterior", () => {
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
  });

  it("mantém dois dígitos no mês", () => {
    expect(previousMonth("2026-10-01")).toBe("2026-09-01");
  });
});

describe("comparação com o mês anterior", () => {
  it("sobe e desce com o sinal e a direção certos", () => {
    expect(monthOverMonth(120, 100)).toEqual({ label: "+20%", direction: "up" });
    expect(monthOverMonth(80, 100)).toEqual({ label: "-20%", direction: "down" });
  });

  // "+0%" com seta para cima seria sinal de movimento onde não houve movimento.
  it("variação abaixo de meio ponto é estável, não zero por cento", () => {
    expect(monthOverMonth(100.2, 100)).toEqual({ label: "estável", direction: "flat" });
    expect(monthOverMonth(100, 100)).toEqual({ label: "estável", direction: "flat" });
  });

  // 0 → 10 não é "+1000%": não havia base.
  it("mês anterior zerado não vira percentual", () => {
    expect(monthOverMonth(10, 0)).toEqual({ label: "sem base no mês anterior", direction: "flat" });
  });

  it("dois meses zerados não têm o que comparar", () => {
    expect(monthOverMonth(0, 0)).toBeNull();
  });

  it("valor ausente não inventa comparação", () => {
    expect(monthOverMonth(Number.NaN, 100)).toBeNull();
    expect(monthOverMonth(100, Number.NaN)).toBeNull();
  });
});
