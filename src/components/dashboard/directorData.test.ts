import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directorPipeline, monthRange, pickFunnelRuler } from "./directorData";
import { buildTargetsMap, directorTargetKey } from "@/components/checkpoint/funnel";
import type { DealRow } from "./data";
import type { PipelineStageRecord } from "@/integrations/supabase/permissions";
import type { Lead } from "@/types/crm";

/**
 * O lado "medido" do comparativo da diretoria.
 *
 * Era uma consulta que baixava TODOS os negocios e TODOS os leads a cada troca
 * de mes ou de equipe para filtrar no navegador — os mesmos dados que o painel
 * ao lado ja tinha. Virou funcao pura sobre o que o Dashboard carregou, e com
 * isso deu para testar as regras que mais erravam: a travessia dos
 * participantes, a etapa ALCANCADA e o recorte do mes dos leads.
 */

/**
 * O fuso da operacao, fixado.
 *
 * O recorte de mes dos leads e feito em hora LOCAL (`leadsInMonth`), entao um
 * teste de virada de mes so e deterministico com o fuso preso — em UTC o
 * instante da virada cai no mes seguinte e o caso perde o sentido. Node aplica
 * a troca de `TZ` as datas criadas depois dela; restaurar no fim evita vazar
 * para outros arquivos da suite.
 */
const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});

/** O catalogo REAL de `pipeline_stages` (posicoes conferidas no banco). */
const STAGES: PipelineStageRecord[] = [
  { id: "1", code: "lead", label: "Lead", position: 2 },
  { id: "2", code: "proposal", label: "Proposta", position: 3 },
  { id: "3", code: "under_analysis", label: "Em Análise", position: 5 },
  { id: "4", code: "approved", label: "Aprovado", position: 6 },
  { id: "5", code: "contract", label: "Contrato", position: 7 },
  { id: "6", code: "closed", label: "Fechado", position: 8 },
  { id: "7", code: "lost", label: "Perdido", position: 9 },
];

const POSICAO = Object.fromEntries(STAGES.map((stage) => [stage.code, stage.position]));

/**
 * `stage` entra como texto livre de proposito: `DealStage` deixa a etapa de
 * desfecho `lost` de fora (ela e resultado, nao coluna de funil), mas o
 * catalogo do banco TEM a linha `lost` na posicao 9 e `listLegacyDeals` copia o
 * codigo que vier de la — e e justamente esse negocio que o teste precisa
 * montar.
 */
const deal = (fields: Partial<Omit<DealRow, "stage">> & { stage?: string }): DealRow => {
  const stage = fields.stage ?? "proposal";
  return {
    id: "d1",
    outcome: "open",
    status: "",
    stage,
    // A posicao acompanha a etapa, como em `listLegacyDeals`: e ela que diz se
    // o negocio ALCANCOU a etapa comparada.
    stage_position: POSICAO[stage] ?? 0,
    client: "",
    developer: "",
    month_base: "09/2026",
    deal_value: 0,
    broker1: "",
    manager1: "",
    ...fields,
  } as DealRow;
};

const lead = (fields: Partial<Lead>): Lead =>
  ({
    id: "l1",
    name: "Lead",
    phone: "",
    whatsapp: "",
    email: "",
    source: "",
    broker_id: "b1",
    // A forma que o PostgREST devolve: instante em UTC, sempre.
    created_at: "2026-09-10T13:00:00+00:00",
    status: "new",
    notes: "",
    ...fields,
  }) as Lead;

describe("directorPipeline", () => {
  it("conta o negocio em que o corretor da diretoria e o SEGUNDO participante", () => {
    // Achado do ranking, mesmo motivo aqui: filtrar so por `broker1_id` sumia
    // com o negocio dividido cujo ordinal 1 e de outra equipe, e o painel
    // chegava a negar movimento que existia.
    const dividido = deal({
      id: "d2",
      stage: "under_analysis",
      broker1_id: "de-fora",
      broker2_id: "b1",
    });
    expect(directorPipeline([dividido], [], ["b1"], "09/2026", STAGES).analises).toBe(1);
  });

  it("respeita o mes: negocio de outro mes nao entra", () => {
    const outroMes = deal({ id: "d3", stage: "approved", broker1_id: "b1", month_base: "08/2026" });
    expect(directorPipeline([outroMes], [], ["b1"], "09/2026", STAGES).aprovados).toBe(0);
  });

  it("negocio que avancou continua contando na etapa que ALCANCOU", () => {
    // O declarado (`analyses_sent`, `analyses_approved`) e cumulativo no mes.
    // Enquanto o medido era a fotografia da etapa atual, a venda saia de
    // "Em Análise" e o comparativo dizia "2 vs 0 · 0% de aderência" — em
    // vermelho — para a analise que aconteceu e virou negocio fechado.
    const vendido = deal({ id: "v", outcome: "won", stage: "closed", broker1_id: "b1" });
    const medido = directorPipeline([vendido], [], ["b1"], "09/2026", STAGES);
    expect(medido).toMatchObject({ analises: 1, aprovados: 1, vendas: 1 });
  });

  it("perdido nao vira etapa alcancada, mesmo sendo a ULTIMA posicao do catalogo", () => {
    // `lost` e a posicao 9: sem tirar o perdido da conta, negocio perdido ainda
    // na proposta passaria por "alcancou a analise" e por "aprovado".
    const perdido = deal({ id: "p", outcome: "lost", stage: "lost", broker1_id: "b1" });
    expect(directorPipeline([perdido], [], ["b1"], "09/2026", STAGES)).toMatchObject({
      analises: 0,
      aprovados: 0,
      vendas: 0,
    });
  });

  it("sem o catalogo de etapas nao inventa medicao", () => {
    const vendido = deal({ id: "v", outcome: "won", stage: "closed", broker1_id: "b1" });
    const medido = directorPipeline([vendido], [], ["b1"], "09/2026", []);
    expect(medido.analises).toBe(0);
    expect(medido.aprovados).toBe(0);
    // A venda nao depende do catalogo: ela sai do `outcome`.
    expect(medido.vendas).toBe(1);
  });

  it("lead conta pelo dono e pelo mes LOCAL — a mesma regra do cartao de leads", () => {
    // 30/09 as 23h em Brasilia chega como "2026-10-01T02:00:00+00:00". Enquanto
    // o recorte daqui era texto (`created_at >= "2026-09-01" && < "2026-10-01"`),
    // este lead ficava de fora de setembro no comparativo e DENTRO de setembro
    // no KPI do topo — o mesmo lead em dois meses, na mesma tela.
    const leads = [
      lead({ id: "virada", created_at: "2026-10-01T02:00:00+00:00" }),
      lead({ id: "fora-data", created_at: "2026-10-01T11:00:00+00:00" }),
      lead({ id: "fora-dono", broker_id: "outro" }),
    ];
    expect(directorPipeline([], leads, ["b1"], "09/2026", STAGES).leads).toBe(1);
  });

  it("equipe sem corretor vinculado devolve tudo zero — e a tela avisa que e vinculo", () => {
    const rows = [deal({ id: "d4", outcome: "won", stage: "closed", broker1_id: "b1" })];
    expect(directorPipeline(rows, [lead({})], [], "09/2026", STAGES)).toEqual({
      leads: 0,
      analises: 0,
      aprovados: 0,
      vendas: 0,
    });
  });
});

describe("pickFunnelRuler — qual regua cobra o comparativo da diretoria", () => {
  /** As quatro linhas REAIS de `funnel_targets` na homologacao (02/09/2026). */
  const MAPA = buildTargetsMap([
    { scope: "director", team_id: null, director_id: "dani", lead_to_analysis_pct: 11.5, analysis_to_approval_pct: 43, approval_to_sale_pct: 53 },
    { scope: "team", team_id: "paulista", director_id: null, lead_to_analysis_pct: 12, analysis_to_approval_pct: 45, approval_to_sale_pct: 55 },
    { scope: "team", team_id: "sul", director_id: null, lead_to_analysis_pct: 11, analysis_to_approval_pct: 42, approval_to_sale_pct: 52 },
    { scope: "global", team_id: null, director_id: null, lead_to_analysis_pct: 10, analysis_to_approval_pct: 40, approval_to_sale_pct: 50 },
  ]);

  it("a meta da DIRETORIA vence a da equipe e a da empresa", () => {
    // O /checkpoint media a Daniela por 53% e esta aba por 50%: o mesmo numero
    // cobrado por duas reguas, com o selo divergindo entre as telas.
    expect(pickFunnelRuler(MAPA, { directorId: "dani", teamIds: ["paulista"] })).toEqual({
      scope: "director",
      analises: 11.5,
      aprovados: 43,
      vendas: 53,
    });
  });

  it("sem meta de diretoria, UMA equipe filtrada cobra a meta dela", () => {
    expect(pickFunnelRuler(MAPA, { directorId: "outro", teamIds: ["sul"] })).toEqual({
      scope: "team",
      analises: 11,
      aprovados: 42,
      vendas: 52,
    });
  });

  it("com VARIAS equipes no filtro cai na meta da empresa — media de metas nao e meta", () => {
    // Paulista cobra 12/45/55 e Sul 11/42/52: nao ha regua unica que sirva as
    // duas, e inventar uma media daria um alvo que ninguem cadastrou.
    expect(pickFunnelRuler(MAPA, { directorId: "outro", teamIds: ["paulista", "sul"] })).toEqual({
      scope: "global",
      analises: 10,
      aprovados: 40,
      vendas: 50,
    });
  });

  it("sem linha nenhuma, o funil ideal do produto — e o rotulo diz isso", () => {
    expect(pickFunnelRuler({}, { directorId: "dani", teamIds: ["paulista"] })).toEqual({
      scope: "ideal",
      analises: 10,
      aprovados: 40,
      vendas: 50,
    });
  });

  it("a linha de diretoria e chaveada pelo director_id, nao pelo team_id", () => {
    // `funnel_targets_scope_director` (0009) obriga `team_id` nulo na linha de
    // diretoria: chavea-la pelo time descartava a meta que o diretor cadastrou.
    expect(MAPA[directorTargetKey("dani")]).toBeDefined();
  });
});

describe("monthRange — a janela do diario", () => {
  it("e meio-aberta: o dia 1º do mes seguinte fica de fora", () => {
    // `daily_reports.report_date` e `date` puro, entao aqui a comparacao por
    // texto e segura — e com `lte` no ultimo dia o dia seguinte entrava.
    expect(monthRange("09/2026")).toEqual({ desde: "2026-09-01", ate: "2026-10-01" });
  });
});
