import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A FIAÇÃO do `EngagementLayer`, não as regras puras.
 *
 * `lib/engagement/celebrations.test.ts` cobre agrupamento, `joinNames` e
 * `detectRankUp` — funções sem React nem Supabase. O inventário de 06/09 achou
 * o que ficava de fora: se o canal parar de assinar `game_events`, se o
 * `event_code` mudar, se a fila de cards travar ou se a queda do canal deixar de
 * aparecer na tela, nada reprova. `grep -rn "confetti\|SaleCelebration" e2e/`
 * voltava vazio.
 *
 * O teste registra um canal falso, empurra o payload que o Postgres mandaria e
 * cobra o que o usuário vê: o card, uma vez só por negócio, com os nomes certos.
 */

// ── dublês ───────────────────────────────────────────────────────────────────

type Handler = (payload: { new: Record<string, unknown> }) => void;
type StatusCb = (status: string) => void;

const canal = {
  filtros: [] as { table: string; handler: Handler }[],
  status: null as StatusCb | null,
  criados: 0,
  removidos: 0,
  /** Status que o dublê emite ao assinar — a TV da loja nem sempre conecta de primeira. */
  statusAoAssinar: "SUBSCRIBED",
};

const fakeChannel = {
  on(_evento: string, filtro: { table: string }, handler: Handler) {
    canal.filtros.push({ table: filtro.table, handler });
    return fakeChannel;
  },
  subscribe(cb: StatusCb) {
    canal.status = cb;
    cb(canal.statusAoAssinar);
    return fakeChannel;
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      canal.criados += 1;
      return fakeChannel;
    },
    removeChannel: () => {
      canal.removidos += 1;
      return Promise.resolve("ok");
    },
  },
}));

/** O que cada teste gira: papel, meta do mês, VGV do mês e o interruptor de som. */
const estado = vi.hoisted(() => ({
  roles: ["broker"] as string[],
  meta: null as { target: number | null; scope: string } | null,
  placarDoMes: [] as { profile_id: string; vgv: number }[],
  somLigado: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "perfil-1" }, roles: estado.roles, isAdmin: false }),
}));

vi.mock("@/hooks/useGameRanking", async (importOriginal) => ({
  // `recorteDoRanking` é o real: quem tem meta individual é a regra do card de game.
  ...(await importOriginal<typeof import("@/hooks/useGameRanking")>()),
  useCurrentSeasonId: () => ({ data: "temporada-1" }),
  // Com `week` é a leitura do mês (o realizado da meta); sem, o placar da temporada.
  useSeasonRanking: (seasonId: string | null, week?: unknown) => ({
    data: week ? (seasonId ? estado.placarDoMes : undefined) : [],
  }),
}));

// `useGoal` desliga a consulta com `ALL_MONTHS`; o dublê respeita o mesmo contrato.
vi.mock("@/components/dashboard/data", () => ({
  ALL_MONTHS: "all",
  useVgvGoal: (mes: string) => ({ data: mes === "all" ? undefined : estado.meta ?? undefined }),
}));

const listRanking = vi.fn(async (_seasonId: string) => [
  { profile_id: "p1", full_name: "Ana Lima" },
  { profile_id: "p2", full_name: "Bruno Reis" },
]);
const countSalesSince = vi.fn(async (_since: string | null) => 0);
/** Régua do servidor: a última venda conhecida quando a tela abre. */
const REGUA_INICIAL = "2026-09-01T00:00:00Z";
const lastSaleAt = vi.fn(async (): Promise<string | null> => REGUA_INICIAL);

vi.mock("@/integrations/supabase/game", () => ({
  gameKeys: {
    all: ["game"],
    ranking: (id: string | null) => ["game", "ranking", id],
  },
  listRanking: (id: string) => listRanking(id),
  countSalesSince: (since: string | null) => countSalesSince(since),
  lastSaleAt: () => lastSaleAt(),
}));

// Sem AudioContext nem canvas no jsdom — e som/confete não são o que se prova.
// O dublê precisa cobrir o módulo inteiro que o `EngagementLayer` alcança:
// `tocarPremiacao` (o som de marco) lê `isSoundOn`/`subscribeSound` daqui.
// Mudo por padrão — teste não toca som e não baixa a faixa. Só o teste da
// venda seguida liga (`estado.somLigado`), com `play` espionado.
vi.mock("@/lib/engagement/audio", () => ({
  playSound: vi.fn(),
  isSoundOn: () => estado.somLigado,
  audioLiberado: () => false,
  subscribeSound: () => () => undefined,
}));
vi.mock("./Confetti", () => ({ fireConfetti: vi.fn() }));

const toastSpy = vi.fn();
vi.mock("@/components/ui/sonner", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

// O card real usa framer-motion (AnimatePresence não desmonta em jsdom sem
// timers); o dublê preserva o que importa aqui — o payload que a camada monta.
vi.mock("@/components/SaleCelebration", () => ({
  default: ({ sale }: { sale: { id: string; names: string } | null }) =>
    sale ? <p data-testid="venda">{sale.names}</p> : null,
}));
vi.mock("@/components/MotivationalPopup", () => ({ MotivationalPopup: () => null }));
vi.mock("@/components/NewLeadNotifier", () => ({ default: () => null }));

const { EngagementLayer } = await import("./EngagementLayer");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── apoio ────────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

const handlerDe = (tabela: string) => {
  const alvo = canal.filtros.find((f) => f.table === tabela);
  if (!alvo) throw new Error(`o canal não assinou "${tabela}"`);
  return alvo.handler;
};

/**
 * Instante (do servidor) das vendas que os testes empurram, na grafia que o
 * REALTIME usa — texto do Postgres, com espaço e offset curto. O `lastSaleAt`
 * vem do PostgREST, em ISO: as duas grafias convivem de propósito, porque foi
 * comparar uma com a outra como string que quebrou a régua.
 */
const VENDA_AS_12H = "2026-09-02 12:00:00.123456+00";

/** Payload igual ao que o realtime do Postgres entrega num INSERT: a linha inteira. */
const evento = (over: Record<string, unknown> = {}) => ({
  new: {
    id: `e-${Math.random()}`,
    profile_id: "p1",
    ref_id: "negocio-1",
    season_id: "temporada-1",
    event_code: "venda",
    occurred_at: VENDA_AS_12H,
    ...over,
  },
});

let client: QueryClient;

/** Monta — ou re-renderiza, com o mesmo cliente, quando chamado de novo no teste. */
async function montar() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <EngagementLayer><span /></EngagementLayer>
      </QueryClientProvider>,
    );
  });
}

/** Passa a janela de agrupamento (500 ms) e deixa as promessas resolverem. */
async function passarJanela() {
  await act(async () => { vi.advanceTimersByTime(600); });
  await esperarPromessas();
}

/** Deixa a leitura da régua e a contagem da recuperação resolverem. */
async function esperarPromessas() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** Derruba o canal e deixa o reassinar (4 s) acontecer. */
async function quedaEVolta(motivo = "CHANNEL_ERROR") {
  await act(async () => { canal.status?.(motivo); });
  await act(async () => { vi.advanceTimersByTime(4100); });
  await esperarPromessas();
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  estado.roles = ["broker"];
  estado.meta = null;
  estado.placarDoMes = [];
  estado.somLigado = false;
  localStorage.clear();
  canal.filtros = [];
  canal.status = null;
  canal.criados = 0;
  canal.removidos = 0;
  canal.statusAoAssinar = "SUBSCRIBED";
  toastSpy.mockClear();
  listRanking.mockClear();
  countSalesSince.mockClear();
  lastSaleAt.mockClear();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

// ── testes ───────────────────────────────────────────────────────────────────

describe("EngagementLayer · realtime", () => {
  it("assina as três tabelas que o banco realmente emite", async () => {
    await montar();
    expect(canal.filtros.map((f) => f.table).sort()).toEqual([
      "checkins",
      "game_events",
      "lead_events",
    ]);
  });

  it("um INSERT de venda vira o card com o nome de quem vendeu", async () => {
    await montar();

    await act(async () => { handlerDe("game_events")(evento()); });
    await passarJanela();

    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Ana Lima");
  });

  /**
   * O trigger grava UMA linha por corretor do rateio. Sem o agrupamento, uma
   * venda a três mãos tocava três fanfarras sobrepostas e trocava o nome no
   * meio do card.
   */
  it("os eventos do mesmo negócio viram um card só, com todos os nomes", async () => {
    await montar();

    await act(async () => {
      handlerDe("game_events")(evento({ id: "e1", profile_id: "p1" }));
      handlerDe("game_events")(evento({ id: "e2", profile_id: "p2" }));
    });
    await passarJanela();

    expect(container.querySelectorAll("[data-testid=venda]")).toHaveLength(1);
    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Ana Lima e Bruno Reis");
  });

  /**
   * `esteira`, `aprovado`, `distrato` e `incompleto_com_doc` também chegam por
   * este canal — e só a venda comemora. Trocar o código do evento no banco sem
   * trocar aqui voltaria a loja a tocar fanfarra por documento anexado.
   */
  it("evento que não é venda mexe no placar sem comemorar", async () => {
    await montar();

    await act(async () => { handlerDe("game_events")(evento({ event_code: "esteira" })); });
    await passarJanela();

    expect(container.querySelector("[data-testid=venda]")).toBeNull();
  });

  it("o mesmo id de evento não comemora duas vezes", async () => {
    await montar();

    await act(async () => {
      handlerDe("game_events")(evento({ id: "repetido" }));
      handlerDe("game_events")(evento({ id: "repetido" }));
    });
    await passarJanela();

    expect(listRanking).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-testid=venda]")).toHaveLength(1);
  });

  it("sem nome resolvido o card ainda aparece, como 'Equipe'", async () => {
    await montar();

    await act(async () => { handlerDe("game_events")(evento({ profile_id: "fora-do-escopo" })); });
    await passarJanela();

    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Equipe");
  });
});

/**
 * O trigger grava uma linha por corretor do rateio e por regra, e cada aba logada
 * recebe todas. Invalidar `["game"]` a cada linha refazia temporada e ranking uma
 * vez por linha, em todas as abas — o servidor executa tudo, mesmo o que o
 * cliente cancela. O placar agora é refeito uma vez por rajada, e só o ranking.
 */
describe("EngagementLayer · placar", () => {
  /** As chaves `["game", …]` que a tela real mantém em cache. */
  const CHAVES = {
    temporada: ["game", "season"],
    // A TV escolhe a temporada exibida nesta lista: sem ela, a temporada nova
    // não está lá e a tela cai na primeira da lista, a encerrada.
    temporadas: ["game", "seasons"],
    ranking: ["game", "ranking", "temporada-1", null, null],
    rankingDoMes: ["game", "ranking", "temporada-1", "2026-09-01", "2026-09-30"],
    regras: ["game", "rules", "temporada-1"],
    resultados: ["game", "results", "temporada-0"],
  };
  const invalidada = (chave: unknown[]) => client.getQueryState(chave)?.isInvalidated ?? false;

  it("rajada de 10 eventos em 1 s refaz o placar uma vez, e só ranking e temporadas", async () => {
    await montar();
    Object.values(CHAVES).forEach((chave) => client.setQueryData(chave, []));
    const spy = vi.spyOn(client, "invalidateQueries");

    for (let i = 0; i < 10; i += 1) {
      await act(async () => { handlerDe("game_events")(evento({ id: `r${i}`, event_code: "esteira" })); });
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(invalidada(CHAVES.ranking)).toBe(true);
    expect(invalidada(CHAVES.rankingDoMes)).toBe(true);
    // A temporada entra: o primeiro evento de uma temporada recém-aberta é o
    // que tira a TV da loja do placar encerrado.
    expect(invalidada(CHAVES.temporada)).toBe(true);
    expect(invalidada(CHAVES.temporadas)).toBe(true);
    expect(invalidada(CHAVES.regras)).toBe(false);
    expect(invalidada(CHAVES.resultados)).toBe(false);
  });

  /**
   * O nome do card sai do ranking. Com o placar em cache e ainda fresco, só o
   * agrupamento faria o card ler a foto de antes da venda — e quem vendeu pela
   * primeira vez viraria "Equipe".
   */
  it("venda a três mãos: uma invalidação, e o nome sai do placar já refeito", async () => {
    await montar();
    client.setQueryData(["game", "ranking", "temporada-1"], [{ profile_id: "p1", full_name: "Ana Lima" }]);
    const spy = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      handlerDe("game_events")(evento({ id: "m1", profile_id: "p1" }));
      handlerDe("game_events")(evento({ id: "m2", profile_id: "p2" }));
      handlerDe("game_events")(evento({ id: "m3", profile_id: "p1", event_code: "esteira" }));
    });
    await passarJanela();
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Ana Lima e Bruno Reis");
  });
});

describe("EngagementLayer · queda do canal", () => {
  it("avisa na tela enquanto está fora do ar e some ao voltar", async () => {
    await montar();
    expect(container.textContent).not.toContain("Sem conexão ao vivo");

    await act(async () => { canal.status?.("CHANNEL_ERROR"); });
    expect(container.textContent).toContain("Sem conexão ao vivo");

    // Reassina em RESUBSCRIBE_MS (4 s) e o `subscribe` do dublê já confirma.
    await act(async () => { vi.advanceTimersByTime(4100); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("Sem conexão ao vivo");
  });

  it("na volta, conta A PARTIR da régua do servidor e diz quantas fecharam", async () => {
    countSalesSince.mockResolvedValueOnce(3);
    await montar();
    await esperarPromessas();

    await quedaEVolta("TIMED_OUT");

    // O argumento é o que separa "3 vendas na queda" de "a história inteira":
    // `countSalesSince(null)` não filtra nada e devolveria todas as vendas do
    // banco como se tivessem acabado de acontecer.
    expect(countSalesSince).toHaveBeenCalledWith(REGUA_INICIAL);
    const [titulo, opcoes] = toastSpy.mock.calls.at(-1) as [string, { description: string }];
    expect(titulo).toBe("Conexão ao vivo restabelecida");
    expect(opcoes.description).toContain("3 venda(s)");
  });

  /**
   * A régua tem que andar com o expediente. Sem isso ela ficava no instante em
   * que a TV conectou de manhã, e a queda do fim do dia contava também as
   * vendas que já tinham tido card e fanfarra.
   */
  it("venda comemorada avança a régua: a volta não reconta o que já teve card", async () => {
    await montar();
    await esperarPromessas();

    await act(async () => { handlerDe("game_events")(evento()); });
    await passarJanela();
    expect(container.querySelector("[data-testid=venda]")).not.toBeNull();

    await quedaEVolta();

    expect(countSalesSince).toHaveBeenCalledWith(VENDA_AS_12H);
  });

  /**
   * Queda na PRIMEIRA assinatura: `aoConectar` nunca rodou, então não existe
   * régua. Contar sem régua devolveria a história inteira — o aviso diria que
   * oito vendas fecharam agorinha. Melhor admitir que não dá para conferir.
   */
  it("sem régua estabelecida, a volta admite que não conferiu em vez de inventar número", async () => {
    canal.statusAoAssinar = "CHANNEL_ERROR";
    await montar();
    await esperarPromessas();

    canal.statusAoAssinar = "SUBSCRIBED";
    await act(async () => { vi.advanceTimersByTime(4100); });
    await esperarPromessas();

    expect(countSalesSince).not.toHaveBeenCalled();
    const [titulo, opcoes] = toastSpy.mock.calls.at(-1) as [string, { description: string }];
    expect(titulo).toBe("Conexão ao vivo restabelecida");
    expect(opcoes.description).toContain("Não consegui conferir");
    expect(opcoes.description).not.toContain("venda(s)");
  });

  it("a primeira conexão não avisa nada — não houve queda", async () => {
    await montar();
    await esperarPromessas();
    expect(countSalesSince).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("EngagementLayer · som da venda", () => {
  let tocarFaixa: { mockRestore: () => void; mock: { calls: unknown[] } };
  let pausar: { mockRestore: () => void };

  beforeEach(() => {
    estado.somLigado = true;
    // jsdom não reproduz áudio: o que se prova é quantas vezes a faixa foi pedida.
    tocarFaixa = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    pausar = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { configurable: true, writable: true, value: 0 });
  });

  afterEach(() => {
    tocarFaixa.mockRestore();
    pausar.mockRestore();
  });

  /**
   * O card durava 6 s e o trecho da música 7 s: o card da segunda venda entrava
   * com a faixa ainda na trava de não empilhar e a loja via o card sem som.
   */
  it("a segunda venda seguida também toca: o card dura o trecho inteiro da música", async () => {
    const { TRECHO_MS } = await import("@/hooks/useSomDePremiacao");
    await montar();

    await act(async () => {
      handlerDe("game_events")(evento({ id: "v1", ref_id: "negocio-1", profile_id: "p1" }));
      handlerDe("game_events")(evento({ id: "v2", ref_id: "negocio-2", profile_id: "p2" }));
    });
    await passarJanela();
    await esperarPromessas();

    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Ana Lima");
    expect(tocarFaixa.mock.calls).toHaveLength(1);

    await act(async () => { vi.advanceTimersByTime(TRECHO_MS); });

    expect(container.querySelector("[data-testid=venda]")?.textContent).toBe("Bruno Reis");
    expect(tocarFaixa.mock.calls).toHaveLength(2);
  });
});

describe("EngagementLayer · meta batida", () => {
  const vgvDoMes = (valor: number) => [{ profile_id: "perfil-1", vgv: valor }];
  const comemoracoesDeMeta = () => toastSpy.mock.calls.filter(([titulo]) => String(titulo).includes("Meta"));

  beforeEach(() => {
    estado.meta = { target: 100_000, scope: "profile" };
  });

  it("comemora quando o VGV do mês cruza a meta — e uma vez só, mesmo caindo, recarregando e cruzando de novo", async () => {
    estado.placarDoMes = vgvDoMes(60_000);
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(0);

    estado.placarDoMes = vgvDoMes(120_000);
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(1);

    // Distrato derruba o VGV, a página é recarregada e uma venda nova cruza de
    // novo: é a mesma meta da mesma temporada, e a marca está no localStorage.
    estado.placarDoMes = vgvDoMes(80_000);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await montar();
    estado.placarDoMes = vgvDoMes(130_000);
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(1);
  });

  it("quem abre o app com a meta já batida não recebe comemoração no carregamento", async () => {
    estado.placarDoMes = vgvDoMes(150_000);
    await montar();
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(0);
  });

  /**
   * Quem cruza é o PROGRESSO da pessoa, não o número de /equipes: baixar a meta
   * abaixo do VGV, ou apagar e recriar depois que o VGV passou dela, não é
   * venda nenhuma — só uma linha de base nova.
   */
  it("mexer só na meta não comemora", async () => {
    estado.meta = { target: 200_000, scope: "profile" };
    estado.placarDoMes = vgvDoMes(150_000);
    await montar();

    estado.meta = { target: 120_000, scope: "profile" };
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(0);

    estado.meta = { target: 200_000, scope: "profile" };
    await montar();
    estado.meta = null;
    await montar();
    estado.placarDoMes = vgvDoMes(250_000);
    estado.meta = { target: 200_000, scope: "profile" };
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(0);
  });

  /**
   * Para gerente e diretor a meta que o `useGoal` devolve pode ser a soma das
   * equipes lideradas, comparada com o VGV só da pessoa: um "Meta batida"
   * assim seria falso. Só quem tem a faixa individual no card de game entra.
   */
  it("fora do recorte individual não há gatilho", async () => {
    estado.roles = ["manager"];
    estado.placarDoMes = vgvDoMes(60_000);
    await montar();
    estado.placarDoMes = vgvDoMes(120_000);
    await montar();
    expect(comemoracoesDeMeta()).toHaveLength(0);
  });
});
