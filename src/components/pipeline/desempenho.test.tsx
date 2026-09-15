import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Travamento do Pipeline, da esteira CCA e do Dashboard com base grande.
 *
 * O banco é falso e fica ATRÁS do `fetch`: o cliente do Supabase é o de
 * verdade, então `range`, `count` e o teto de linhas do PostgREST (`max-rows`
 * = 1.000, o padrão do Supabase — o `LIMIT` aparece até nas consultas sem
 * `range` no `pg_stat_statements` da homologação) passam pelo mesmo caminho da
 * produção. Cada requisição espera `latencia` ms.
 *
 * As asserções são de CONTAGEM (requisições, cartões re-renderizados, recargas)
 * e não dependem do volume. Os milissegundos só vão para o log: com
 * `DESEMPENHO_REAL=1` o volume é o da homologação em 13/09/2026 (7.579
 * negócios, 2.288 ativos, 20.737 participantes, 7.560 casos, 102.799 leads),
 * que é de onde saíram os números do relatório — e leva ~40 s.
 */
const REAL = process.env.DESEMPENHO_REAL === "1";
const N_NEGOCIOS = REAL ? 7579 : 2600;
const N_ATIVOS = REAL ? 2288 : 400;
const N_CORRETORES = 287;
const N_LEADS = REAL ? 102_799 : 2500;
const N_CASOS = REAL ? 7560 : 2100;

const h = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, unknown[]>,
    latencia: 0,
    requisicoes: [] as { path: string; offset: number }[],
    abortadas: 0,
    emVoo: 0,
    maxEmVoo: 0,
  };
  const auth = {
    user: { id: "u1" },
    profile: null,
    isAdmin: true,
    roles: ["admin"],
    role: "admin",
    can: () => true,
    canEnterStage: () => true,
  };
  const canExit = () => true;
  const probabilidade = { chamadas: 0 };
  /** Argumentos de cada chamada a `useGameRanking` (o 1º é a lista de negócios). */
  const ranking = { args: [] as unknown[][] };
  return { state, auth, canExit, probabilidade, ranking };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const fetchFalso = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const s = h.state;
    const path = url.pathname.replace("/rest/v1/", "");
    const linhas = s.tables[path] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const pedido = url.searchParams.get("limit");
    const limit = Math.min(pedido === null ? Infinity : Number(pedido), 1000);
    s.requisicoes.push({ path, offset });
    s.emVoo += 1;
    s.maxEmVoo = Math.max(s.maxEmVoo, s.emVoo);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, s.latencia);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          s.abortadas += 1;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    } finally {
      s.emVoo -= 1;
    }
    const pagina = linhas.slice(offset, offset + limit);
    const conta = new Headers(init?.headers).get("Prefer")?.includes("count=exact");
    const faixa = pagina.length ? `${offset}-${offset + pagina.length - 1}` : "*";
    return new Response((init?.method ?? "GET") === "HEAD" ? null : JSON.stringify(pagina), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": `${faixa}/${conta ? linhas.length : "*"}` },
    });
  };
  return {
    supabase: createClient("http://fake.local", "anon", {
      global: { fetch: fetchFalso },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));

vi.mock("@/components/pipeline/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/pipeline/data")>()),
  useCanExitStage: () => h.canExit,
}));

// Uma chamada por render de `DealCard`: é o contador de cartões refeitos.
vi.mock("@/lib/aiAnalytics", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/aiAnalytics")>();
  return {
    ...real,
    calcDealProbability: (...args: Parameters<typeof real.calcDealProbability>) => {
      h.probabilidade.chamadas += 1;
      return real.calcDealProbability(...args);
    },
  };
});

// Repassa ao hook real e anota os argumentos: é como o teste do card de ranking
// sabe que ele não voltou a cruzar o placar com os negócios.
vi.mock("@/hooks/useGameRanking", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useGameRanking")>();
  return {
    ...real,
    useGameRanking: (...args: Parameters<typeof real.useGameRanking>) => {
      h.ranking.args.push(args);
      return real.useGameRanking(...args);
    },
  };
});

vi.mock("@/components/dashboard", () => ({
  ALL_MONTHS: "all",
  useVgvGoal: () => ({ data: null, isLoading: false, error: null }),
}));

vi.mock("@/components/engagement", () => ({ PodiumCards: () => null }));

import { supabase } from "@/integrations/supabase/client";
import { listLegacyDeals, type DashboardPayload, type LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { gameKeys } from "@/integrations/supabase/game";
import { DealsBoard } from "./DealsBoard";
import { CcaBoard } from "./CcaBoard";
import type { CcaDeal, CcaStage } from "./ccaData";
import { useDeals, usePipelineRealtime } from "./data";
import { useDealActions } from "./useDealActions";
import { EMPTY_FILTERS, applyDealFilters, sortDeals, sortDealsBy } from "./filters";
import type { PipelineStage } from "./stages";
import { useDashboardLeads, useDashboardPayload } from "@/components/dashboard/data";
import PipelineTopRanking from "@/components/PipelineTopRanking";

const CODIGOS = ["lead", "docs", "analysis", "sent", "approved", "proposal", "contract", "won", "lost"];
const STAGES: PipelineStage[] = CODIGOS.map((code, i) => ({ id: `st${i}`, code, label: code.toUpperCase(), position: i + 1 }));
const CCA_STAGES: CcaStage[] = ["pending_documents", "under_review", "sent_to_developer", "approved", "rejected"].map(
  (status, i) => ({ id: `cs${i}`, name: status, color: "#0ea5e9", position: i + 1, status: status as CcaStage["status"] }),
);

function semearBanco() {
  const construtoras = ["Ávila", "Zamboni", "Alfa", "Érica", "Beta"];
  const deals = Array.from({ length: N_NEGOCIOS }, (_, i) => ({
    id: `d${String(i).padStart(5, "0")}`,
    code: `N${i}`,
    stage_id: `st${i % 8}`,
    developer_id: `dev${i % 41}`,
    project_id: `p${i % 200}`,
    unit: String(100 + (i % 50)),
    status_detail: null,
    outcome: i < N_ATIVOS ? "open" : "lost",
    lost_reason: null,
    lead_origin: null,
    month_base: `2026-0${1 + (i % 8)}-01`,
    vgv_gross: 200000,
    discount_pct: 0,
    vgv_net: 190000 + i,
    created_at: new Date(Date.UTC(2026, i % 8, 1 + (i % 27))).toISOString(),
    notes: null,
    document_review_status: "draft",
  }));
  const clientes = deals.flatMap((deal, i) => [
    { id: `c${i}`, deal_id: deal.id, ordinal: 1, full_name: `Cliente ${i}`, cpf: "00000000000" },
    ...(i % 22 === 0 ? [{ id: `c${i}b`, deal_id: deal.id, ordinal: 2, full_name: `Segundo ${i}` }] : []),
  ]);
  // Proporção da homologação: 20.737 participantes para 7.579 negócios.
  const participantes: Record<string, unknown>[] = [];
  deals.forEach((deal, i) => {
    participantes.push({ id: `pb${i}`, deal_id: deal.id, role: "broker", ordinal: 1, profile_id: `pr${i % N_CORRETORES}`, share_pct: "100", created_at: deal.created_at });
    participantes.push({ id: `pm${i}`, deal_id: deal.id, role: "manager", ordinal: 1, profile_id: `pr${290 + (i % 5)}`, share_pct: "0", created_at: deal.created_at });
    if (i < N_NEGOCIOS * 0.736) {
      participantes.push({ id: `pd${i}`, deal_id: deal.id, role: "director", ordinal: 1, profile_id: `pr${296 + (i % 2)}`, share_pct: "0", created_at: deal.created_at });
    }
  });
  const nomes = participantes.map((row) => ({ ...row, full_name: `Corretor ${String(row.profile_id).slice(2)}` }));
  const perfis = Array.from({ length: 298 }, (_, i) => ({ id: `pr${i}`, full_name: `Corretor ${i}`, status: "active" }));

  h.state.tables = {
    deals,
    pipeline_stages: STAGES,
    developers: Array.from({ length: 41 }, (_, i) => ({ id: `dev${i}`, name: `${construtoras[i % 5]} ${i}` })),
    developer_projects: Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: `Residencial ${i}` })),
    deal_clients: clientes,
    deal_participants: participantes,
    "rpc/deal_participant_names": nomes,
    visits: [],
    leads: Array.from({ length: N_LEADS }, (_, i) => ({
      id: `l${i}`,
      full_name: `Lead ${i}`,
      created_at: new Date(Date.UTC(2026, i % 9, 1 + (i % 27))).toISOString(),
      status: i % 3 ? "in_progress" : "converted",
      funnel_stage: null,
      source_id: `src${i % 4}`,
      assigned_to: `pr${i % N_CORRETORES}`,
    })),
    lead_sources: Array.from({ length: 4 }, (_, i) => ({ id: `src${i}`, label: `Origem ${i}` })),
    profiles: perfis,
    user_roles: perfis.map((p) => ({ profile_id: p.id, role: "broker" })),
    team_members: [],
    teams: [],
    cca_stages: CCA_STAGES.map((stage) => ({ ...stage, active: true })),
    cca_cases: Array.from({ length: N_CASOS }, (_, i) => ({
      id: `k${i}`, deal_id: deals[i].id, status: CCA_STAGES[i % 5].status, stage_id: `cs${i % 5}`, decision_notes: null,
      // O caso 1 foi o último mexido (movido agora há pouco); o resto, em ordem.
      updated_at: new Date(Date.UTC(2026, 0, 1) + (i === 1 ? N_CASOS : i) * 60_000).toISOString(),
    })),
    closed_months: [],
  };
}

function zerarRede(latencia: number) {
  Object.assign(h.state, { latencia, requisicoes: [], abortadas: 0, emVoo: 0, maxEmVoo: 0 });
}

const doCaminho = (path: string) => h.state.requisicoes.filter((req) => req.path === path).length;
/** Páginas de 1.000 que a tabela precisa (os volumes não são múltiplos de 1.000). */
const paginas = (tabela: string) => Math.ceil(h.state.tables[tabela].length / 1000);

const log = (...partes: unknown[]) => console.log("[medida]", ...partes);
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function montar(no: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const render = async (proximo: ReactNode) => {
    const inicio = performance.now();
    await act(async () => { root.render(proximo); });
    return Math.round(performance.now() - inicio);
  };
  const ms = await render(no);
  return {
    container, ms, render,
    desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

async function ate(condicao: () => boolean, limite = 30_000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limite) throw new Error("tempo esgotado");
    await act(async () => { await esperar(10); });
  }
}

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });

let negocios: LegacyDealRecord[] = [];

beforeAll(async () => {
  semearBanco();
  zerarRede(0);
  negocios = await listLegacyDeals();
}, 60_000);

afterEach(() => { vi.restoreAllMocks(); });

describe("desempenho · carga dos negócios", () => {
  it("pagina tudo, com as faixas em paralelo em vez de uma cadeia por tabela", async () => {
    zerarRede(25);
    const inicio = performance.now();
    const lista = await listLegacyDeals();
    const ms = Math.round(performance.now() - inicio);
    log("listLegacyDeals", { negocios: lista.length, requisicoes: h.state.requisicoes.length, maxEmVoo: h.state.maxEmVoo, ms, ondas: Math.round(ms / 25) });

    expect(lista).toHaveLength(N_NEGOCIOS);
    const esperado = paginas("deals") + paginas("deal_clients") + paginas("deal_participants")
      + paginas("rpc/deal_participant_names") + 1 /* visits */ + 3 /* catálogos */;
    expect(h.state.requisicoes).toHaveLength(esperado);
    // Em cadeia, cada tabela paginada tem no máximo uma requisição em voo (8 ao
    // todo). Mais que isso só acontece com as faixas saindo juntas.
    expect(h.state.maxEmVoo).toBeGreaterThan(8);
  }, 60_000);
});

// A esteira CCA saiu daqui em 15/09/2026: ela não compartilha mais a base de
// negócios, carrega só o período (filtro no banco) — ver `ccaData.test.ts`.
describe("desempenho · cache compartilhado", () => {
  it("o Dashboard aberto depois do Pipeline não rebaixa os negócios e conta a base inteira", async () => {
    zerarRede(5);
    const client = novoCliente();
    const estado = { pipeline: false, payload: false, leads: false };
    function Pipeline() {
      estado.pipeline = useDeals().isSuccess;
      return null;
    }
    function Dashboard() {
      estado.payload = useDashboardPayload().query.isSuccess;
      estado.leads = useDashboardLeads().isSuccess;
      return null;
    }
    const tela = await montar(<QueryClientProvider client={client}><Pipeline /></QueryClientProvider>);
    await ate(() => estado.pipeline);
    const antes = h.state.requisicoes.length;
    const negociosAntes = doCaminho("deals");
    await tela.render(<QueryClientProvider client={client}><Pipeline /><Dashboard /></QueryClientProvider>);
    await ate(() => estado.payload && estado.leads);
    const payload = client.getQueryData<DashboardPayload>(["dashboard", "payload", "u1"]);
    const somaCca = Object.values(payload?.ccaCounts ?? {}).reduce((a, b) => a + b, 0);
    log("Dashboard depois do Pipeline", {
      requisicoesDoDashboard: h.state.requisicoes.length - antes,
      paginasDeNegociosRebaixadas: doCaminho("deals") - negociosAntes,
      leadsCount: payload?.leadsCount,
      somaCca,
      listaDeLeads: client.getQueryData<unknown[]>(["dashboard", "leads", "u1"])?.length,
    });

    expect(doCaminho("deals") - negociosAntes).toBe(0);
    expect(payload?.leadsCount).toBe(N_LEADS);
    expect(somaCca).toBe(N_CASOS);
    await tela.desmontar();
  }, 120_000);
});

describe("desempenho · realtime", () => {
  it("uma rajada de eventos em deals vira uma recarga só", async () => {
    zerarRede(20);
    const handlers: Record<string, () => void> = {};
    const canal = {
      on: (_evento: string, cfg: { table: string }, fn: () => void) => { handlers[cfg.table] = fn; return canal; },
      subscribe: () => canal,
    };
    vi.spyOn(supabase, "channel").mockReturnValue(canal as never);
    vi.spyOn(supabase, "removeChannel").mockResolvedValue("ok" as never);
    const client = novoCliente();
    const invalidar = vi.spyOn(client, "invalidateQueries");
    const estado = { ok: false };
    function Tela() {
      usePipelineRealtime();
      estado.ok = useDeals().isSuccess;
      return null;
    }
    const tela = await montar(<QueryClientProvider client={client}><Tela /></QueryClientProvider>);
    await ate(() => estado.ok);
    const antes = h.state.requisicoes.length;
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { handlers.deals(); await esperar(40); });
    }
    const duranteRajada = invalidar.mock.calls.length;
    await act(async () => { await esperar(2000); });
    await ate(() => !client.isFetching());
    log("realtime rajada", {
      invalidacoesDuranteRajada: duranteRajada,
      invalidacoesTotal: invalidar.mock.calls.length,
      requisicoesDisparadas: h.state.requisicoes.length - antes,
    });

    expect(duranteRajada).toBe(0);
    expect(invalidar).toHaveBeenCalledTimes(1);
    await tela.desmontar();
  }, 60_000);
});

describe("desempenho · render", () => {
  const noop = () => undefined;
  const fechados: string[] = [];
  const clienteDoQuadro = novoCliente();
  /** O `onMove` é o `moveDeal` de verdade, como no Pipeline: um `noop` estável
   *  escondia que ele mudava a cada render (via `useInvalidateDeals`) e refazia
   *  todos os cartões. */
  function Pai() {
    const { moveDeal } = useDealActions({ stages: STAGES, closedMonths: fechados, onNeedsLossConfirmation: noop });
    return (
      <DealsBoard
        view="kanban"
        deals={negocios}
        stages={STAGES}
        isPending={false}
        error={null}
        filtered={false}
        canWrite
        closedMonths={fechados}
        onRetry={noop}
        onClearFilters={noop}
        onNewDeal={noop}
        onOpen={noop}
        onMove={moveDeal}
        onStatusChange={noop}
        onScheduleVisit={noop}
        onLose={noop}
        onReopen={noop}
      />
    );
  }
  const quadro = () => <QueryClientProvider client={clienteDoQuadro}><Pai /></QueryClientProvider>;

  it("kanban: render do pai e arraste não refazem os cartões", async () => {
    h.probabilidade.chamadas = 0;
    const tela = await montar(quadro());
    const montagem = { ms: tela.ms, cartoes: h.probabilidade.chamadas };

    h.probabilidade.chamadas = 0;
    let msPai = 0;
    for (let i = 0; i < 5; i += 1) msPai += await tela.render(quadro());
    const pai = { msMedio: Math.round(msPai / 5), cartoes: h.probabilidade.chamadas };

    const cartao = tela.container.querySelector<HTMLElement>('[role="button"][draggable="true"]');
    const colunas = tela.container.querySelectorAll<HTMLElement>(".w-60");
    h.probabilidade.chamadas = 0;
    let inicio = performance.now();
    await act(async () => { cartao?.dispatchEvent(new Event("dragstart", { bubbles: true })); });
    const dragstart = { ms: Math.round(performance.now() - inicio), cartoes: h.probabilidade.chamadas };

    h.probabilidade.chamadas = 0;
    inicio = performance.now();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { colunas[2].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true })); });
      await act(async () => { colunas[2].dispatchEvent(new Event("dragleave", { bubbles: true })); });
    }
    const fronteiras = { msPorFronteira: Math.round((performance.now() - inicio) / 8), cartoes: h.probabilidade.chamadas };
    log("kanban", { cartoesNaTela: tela.container.querySelectorAll("article").length, montagem, pai, dragstart, fronteiras });

    expect(montagem.cartoes).toBe(N_ATIVOS);
    expect(pai.cartoes).toBe(0);
    // Só o cartão que saiu da mão muda (`dragging`).
    expect(dragstart.cartoes).toBe(1);
    expect(fronteiras.cartoes).toBe(0);
    await tela.desmontar();
  }, 120_000);

  it("PipelineTopRanking: re-render com 287 corretores", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(gameKeys.season, "s1");
    client.setQueryData(gameKeys.ranking("s1", null, null), Array.from({ length: N_CORRETORES }, (_, i) => ({
      season_id: "s1", profile_id: `pr${i}`, full_name: `Corretor ${i}`, avatar_url: null, active: true,
      points: i * 10, sales: i % 7, vgv: 0, breakdown: {}, team_id: null, team_name: null,
      manager_id: null, manager_name: null, director_id: null, director_name: null,
    })));
    const abrir = () => undefined;
    // Elemento novo a cada volta: o card re-renderiza como quando o Pipeline muda de estado.
    const no = () => <QueryClientProvider client={client}><PipelineTopRanking onAbrirPainel={abrir} /></QueryClientProvider>;
    h.ranking.args = [];
    const tela = await montar(no());
    let total = 0;
    for (let i = 0; i < 10; i += 1) total += await tela.render(no());
    log("TopRanking", { montagemMs: tela.ms, reRenderMedioMs: Math.round(total / 10) });

    // O custo era `useGameRanking(negócios)`: 287 corretores × a base inteira
    // em comparação de nome, por render, para um campo que ninguém lê.
    expect(h.ranking.args.length).toBeGreaterThan(0);
    expect(h.ranking.args.every((args) => args[0] === undefined)).toBe(true);
    await tela.desmontar();
  }, 60_000);

  it("busca: filtro + ordenação por tecla", () => {
    const termos = ["c", "cl", "cli", "clie", "cliente 1"];
    const inicio = performance.now();
    for (let rodada = 0; rodada < 3; rodada += 1) {
      for (const search of termos) sortDeals(applyDealFilters(negocios, { ...EMPTY_FILTERS, search }));
    }
    log("busca por tecla", { listaMs: +((performance.now() - inicio) / (termos.length * 3)).toFixed(1) });

    // O `Intl.Collator` reaproveitado tem de dar a MESMA ordem do
    // `localeCompare("pt-BR")` que ele substituiu, com acento ("Ávila", "Érica").
    const porLocaleCompare = negocios.map((deal) => deal.developer || "")
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    expect(sortDealsBy(negocios, "developer", true).map((deal) => deal.developer || "")).toEqual(porLocaleCompare);
  });

  it("esteira CCA: a coluna desenha 200 cartões e o resto sob pedido", async () => {
    const casos: CcaDeal[] = Array.from({ length: N_CASOS }, (_, i) => ({
      caseId: `k${i}`, dealId: `d${i}`, client: `Cliente ${i}`, developer: "Alfa", project: "Aurora",
      broker: "Ana", value: 1000, stageId: `cs${i % 5}`, notes: "", status: "under_review",
    }));
    const tela = await montar(
      <CcaBoard stages={CCA_STAGES} deals={casos} canAct onOpen={noop} onMove={noop} onSubmitToDeveloper={noop} />,
    );
    const cartoes = () => tela.container.querySelectorAll("article").length;
    const porColuna = Math.ceil(N_CASOS / 5);
    log("CcaBoard", { casos: N_CASOS, montarMs: tela.ms, cartoes: cartoes(), nos: tela.container.querySelectorAll("*").length });

    expect(cartoes()).toBe(5 * Math.min(200, porColuna));
    // O contador da coluna segue contando TODOS os casos dela.
    expect(tela.container.querySelector("section .tabular-nums")?.textContent).toBe(String(porColuna));

    const mais = [...tela.container.querySelectorAll("button")].find((botao) => botao.textContent?.startsWith("Mostrar mais"));
    expect(mais, "coluna com mais de 200 casos oferece o resto").toBeTruthy();
    await act(async () => { mais?.click(); });
    expect(cartoes()).toBe(5 * Math.min(200, porColuna) + Math.min(200, porColuna - 200));
    await tela.desmontar();
  }, 120_000);
});
