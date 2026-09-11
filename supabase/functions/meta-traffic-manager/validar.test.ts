// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CampanhaDoGestor, MAX_CAMPANHAS_IA, montarPedidoGestor, periodosDoGestor, validarGestor,
} from "./validar.ts";

/**
 * O gestor de tráfego IA só PROPÕE. O que não pode voltar: ação da IA em
 * campanha que ela não recebeu (inventada ou de outra conta), tipo fora de
 * pausar/ativar/verba, verba fora de 0,5x a 2x ou em verba total, mais de 3
 * ações ou alertas, nota fora de 0-100 ou inventada sem números — e qualquer
 * caminho desta edge falando direto com a Meta.
 */

const campanha = (extra: Partial<CampanhaDoGestor> = {}): CampanhaDoGestor => ({
  id: "c-a",
  external_id: "120001",
  name: "CAMPANHA A",
  status: "ACTIVE",
  daily_budget: 100,
  meta_budget_level: "campaign",
  meta_channel: "formulario",
  ...extra,
});

const LISTA = [
  campanha(),
  campanha({ id: "c-b", external_id: "120002", name: "CAMPANHA B", meta_budget_level: "lifetime", daily_budget: null }),
  campanha({ id: "c-c", external_id: "120003", name: "CAMPANHA C", status: "PAUSED", meta_budget_level: "adset", daily_budget: 80 }),
  campanha({ id: "c-d", external_id: "120004", name: "CAMPANHA D", meta_budget_level: null }),
];

const saida = (acoes: unknown[], extra: Record<string, unknown> = {}) =>
  ({ nota: 70, resumo: "Conta estável.", alertas: [], acoes, ...extra });
const acao = (tipo: string, external: string, extra: Record<string, unknown> = {}) =>
  ({ acao: tipo, campaign_external_id: external, motivo: `motivo de ${tipo}`, ...extra });
const verba = (external: string, verba_nova: unknown) => acao("verba", external, { verba_nova });

describe("validarGestor", () => {
  it("descarta campanha fora da lista enviada e tipo desconhecido", () => {
    const v = validarGestor(saida([
      acao("pausar", "999999"),
      acao("duplicar", "120001"),
      acao("pausar", "120001", { motivo: "custo 2x a média do canal" }),
    ]), LISTA);
    expect(v.acoes).toEqual([{
      campaign_id: "c-a", campaign_external_id: "120001", campaign_name: "CAMPANHA A", acao: "pausar",
      motivo: "custo 2x a média do canal",
    }]);
    expect(v.descartadas).toBe(2);
  });

  it("verba só de 0,5x a 2x a atual, e nunca em verba total ou sem nível sincronizado", () => {
    const v = validarGestor(saida([
      verba("120001", 49.99),
      verba("120001", 200.01),
      verba("120002", 50),
      verba("120004", 120),
      verba("120001", "150"),
      verba("120003", 40),
      verba("120001", 200),
    ]), LISTA);
    expect(v.acoes.map((a) => [a.campaign_external_id, a.verba_nova])).toEqual([["120003", 40], ["120001", 200]]);
    expect(v.descartadas).toBe(5);
  });

  it("ação que não muda nada é descartada", () => {
    const v = validarGestor(saida([acao("pausar", "120003"), acao("ativar", "120001"), verba("120001", 100)]), LISTA);
    expect(v.acoes).toEqual([]);
    expect(v.descartadas).toBe(3);
  });

  it("mais de 3 ações ou alertas: ficam os 3 primeiros válidos, o resto é descartado", () => {
    const v = validarGestor(saida(
      [acao("pausar", "120001"), acao("ativar", "120003"), verba("120003", 100), verba("120001", 120), acao("pausar", "120001")],
      {
        alertas: [
          { severidade: "alta", texto: "a1" },
          { severidade: "urgente", texto: "severidade que não existe" },
          { severidade: "media", texto: "a2" },
          { severidade: "baixa", texto: "a3" },
          { severidade: "alta", texto: "a4" },
        ],
      },
    ), LISTA);
    expect(v.acoes.map((a) => `${a.acao}:${a.campaign_external_id}`)).toEqual(["pausar:120001", "ativar:120003", "verba:120003"]);
    expect(v.descartadas).toBe(2);
    expect(v.alertas).toEqual([
      { severidade: "alta", texto: "a1" },
      { severidade: "media", texto: "a2" },
      { severidade: "baixa", texto: "a3" },
    ]);
  });

  it("a nota vem limitada a 0-100; sem nota ou sem resumo, lança em vez de inventar", () => {
    expect(validarGestor(saida([], { nota: 150 }), LISTA).nota).toBe(100);
    expect(validarGestor(saida([], { nota: -5 }), LISTA).nota).toBe(0);
    expect(validarGestor(saida([], { nota: 71.6 }), LISTA).nota).toBe(72);
    expect(() => validarGestor(saida([], { nota: "80" }), LISTA)).toThrow(/nota/);
    expect(() => validarGestor(null, LISTA)).toThrow(/nota/);
    expect(() => validarGestor({ nota: 80, resumo: "  " }, LISTA)).toThrow(/resumo/);
  });
});

describe("montarPedidoGestor", () => {
  const conta = {
    name: "Conta A", balance_state: "rodando", is_prepay: false, prepay_available: null,
    last_sync_ok_at: "2026-09-11T09:02:00.000Z",
  };
  // 12:00 UTC = 09:00 em São Paulo: hoje é 11/09 e fica de fora.
  const { atual, anterior } = periodosDoGestor(new Date("2026-09-11T12:00:00Z"), "America/Sao_Paulo");
  const metrica = (campaign_id: string, spend: number) =>
    ({ campaign_id, spend, impressions: spend * 10, ctr: 0.0123, resultados: 2, custo_por_resultado: spend / 2 });

  it("usa os 7 dias até ontem e os 7 antes deles, no fuso da conta", () => {
    expect(atual).toEqual({ inicio: "2026-09-04", fim: "2026-09-10", dias: 7 });
    expect(anterior).toEqual({ inicio: "2026-08-28", fim: "2026-09-03", dias: 7 });
  });

  it("envia só campanhas com gasto ou ativas, as de maior gasto primeiro; a validação usa a mesma lista", () => {
    const campanhas = [
      campanha({ id: "x1", external_id: "1", status: "PAUSED" }),
      campanha({ id: "x2", external_id: "2", status: "PAUSED" }),
      campanha({ id: "x3", external_id: "3" }),
      campanha({ id: "x4", external_id: "4" }),
    ];
    const p = montarPedidoGestor({
      conta, atual, anterior, campanhas, metricas: [metrica("x4", 300)], metricasAnterior: [metrica("x2", 50)],
    });
    expect(p.enviadas.map((c) => c.external_id)).toEqual(["4", "2", "3"]);

    const pedido = JSON.parse(p.user);
    expect(pedido.campanhas[0]).toMatchObject({
      campaign_external_id: "4", verba_editavel: true, ultimos_7_dias: { gasto: 300, ctr_pct: 1.23, resultados: 2 },
    });
    expect(pedido.campanhas.map((c: { campaign_external_id: string }) => c.campaign_external_id)).not.toContain("1");
    // A IA não age em campanha que não recebeu.
    expect(validarGestor(saida([acao("ativar", "1")]), p.enviadas).acoes).toEqual([]);
  });

  it(`no máximo ${MAX_CAMPANHAS_IA} campanhas no pedido`, () => {
    const campanhas = Array.from({ length: MAX_CAMPANHAS_IA + 5 }, (_, i) => campanha({ id: `k${i}`, external_id: `${i}` }));
    const p = montarPedidoGestor({ conta, atual, anterior, campanhas, metricas: [metrica("k0", 10)], metricasAnterior: [] });
    expect(p.enviadas).toHaveLength(MAX_CAMPANHAS_IA);
  });

  it("sem entrega no período, lança com o período e a última sincronização boa (nada de nota inventada)", () => {
    expect(() =>
      montarPedidoGestor({
        conta, atual, anterior, campanhas: [campanha()], metricas: [], metricasAnterior: [metrica("c-a", 90)],
      })
    ).toThrow(/Sem entrega registrada na Meta de 04\/09\/2026 a 10\/09\/2026 \(última sincronização boa: 11\/09\/2026/);
  });
});

describe("edge meta-traffic-manager (leitura do fonte)", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  const puro = readFileSync(fileURLToPath(new URL("./validar.ts", import.meta.url)), "utf8");

  it("nenhum caminho fala com a Meta nem executa: a ação só vira proposta na fila", () => {
    for (const arquivo of [fonte, puro]) {
      expect(arquivo).not.toMatch(/metaPost|metaGet|metaAds|graph\.facebook\.com|fetch\(/);
    }
    expect(fonte).toContain('rpc("meta_action_propose"');
    expect(fonte).not.toMatch(/meta_action_(create|decide|claim|finish)/);
  });

  it("uma chamada de IA por execução, com teto de tokens, depois do reuso e da checagem da chave", () => {
    const chamadas = [...fonte.matchAll(/chatJson[<(]/g)];
    expect(chamadas).toHaveLength(1);
    expect(fonte).toContain("maxTokens: TETO_TOKENS_GESTOR");
    const reuso = fonte.indexOf("if (aberta.reused)");
    const chave = fonte.indexOf('getSecret("OPENAI_API_KEY")');
    const analise = fonte.indexOf("await analisar(");
    expect(reuso).toBeGreaterThan(-1);
    expect(chave).toBeGreaterThan(reuso);
    expect(analise).toBeGreaterThan(chave);
  });
});
