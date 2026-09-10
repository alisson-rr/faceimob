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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "perfil-1" } }),
}));

vi.mock("@/hooks/useGameRanking", () => ({
  useCurrentSeasonId: () => ({ data: "temporada-1" }),
  useSeasonRanking: () => ({ data: [] }),
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
vi.mock("@/lib/engagement/audio", () => ({ playSound: vi.fn() }));
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

async function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
