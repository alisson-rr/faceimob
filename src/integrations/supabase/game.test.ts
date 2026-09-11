import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: { from, rpc } }));

import {
  describeGameError,
  gameKeys,
  listRanking,
  monthStart,
  setDefaultScoringPoints,
  weekRange,
  weeksInRange,
} from "./game";
import { dbError } from "@/lib/supabaseError";

type Outcome = { data: unknown; error: { code?: string; message?: string } | null };

/**
 * Builder mínimo do PostgREST: cada filtro devolve o próprio objeto; `select`
 * (fim do update) e `insert` resolvem o resultado combinado. Não existe
 * `upsert` de propósito — se o código voltar a usá-lo, o teste quebra.
 */
function tabela(update: Outcome, insert: Outcome = { data: null, error: null }) {
  const chamadas = { update: null as unknown, insert: null as unknown, filtros: [] as [string, unknown][] };
  const chain = {
    update: vi.fn((payload: unknown) => { chamadas.update = payload; return chain; }),
    eq: vi.fn((col: string, val: unknown) => { chamadas.filtros.push([col, val]); return chain; }),
    is: vi.fn((col: string, val: unknown) => { chamadas.filtros.push([col, val]); return chain; }),
    select: vi.fn(() => Promise.resolve(update)),
    insert: vi.fn((payload: unknown) => { chamadas.insert = payload; return Promise.resolve(insert); }),
  };
  from.mockReturnValue(chain);
  return { chain, chamadas };
}

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe("setDefaultScoringPoints", () => {
  it("atualiza a regra padrão pelo par (event_code, season_id null), sem upsert", async () => {
    const { chain, chamadas } = tabela({ data: [{ id: "r1" }], error: null });

    await setDefaultScoringPoints("venda", "Venda", 700);

    expect(from).toHaveBeenCalledWith("game_scoring_rules");
    expect(chamadas.update).toEqual({ label: "Venda", points: 700 });
    expect(chamadas.filtros).toEqual([["event_code", "venda"], ["season_id", null]]);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("corrigir o peso NÃO religa a regra: `active` fica fora do update", async () => {
    // Com `active: true` no payload, mexer no peso de uma regra que o admin
    // desligou de propósito a reativava em silêncio — o evento voltava a
    // pontuar sem ninguém ter pedido, e o toast dizia só "N pts".
    const { chamadas } = tabela({ data: [{ id: "r1" }], error: null });

    await setDefaultScoringPoints("distrato", "Distrato", -600);

    expect(chamadas.update).not.toHaveProperty("active");
  });

  it("sem regra padrão para o código, insere uma com season_id null", async () => {
    const { chamadas } = tabela({ data: [], error: null });

    await setDefaultScoringPoints("bonus", "Bônus", 50);

    expect(chamadas.insert).toEqual({ season_id: null, event_code: "bonus", label: "Bônus", points: 50, active: true });
  });

  it("erro do banco sobe com o rótulo da operação, não é engolido", async () => {
    tabela({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(setDefaultScoringPoints("venda", "Venda", 1)).rejects.toThrow(/salvar regra de pontuação/);
  });
});

describe("describeGameError", () => {
  it("mostra a recusa escrita por nós, que `describeError` sozinho descartava", () => {
    // `describeError` traduz por `code` do Postgres; um `Error` puro não tem
    // código, então caía no fallback e o operador lia "Não foi possível
    // encerrar a temporada" sem saber qual peso estava errado.
    expect(
      describeGameError(new Error('A pontuação de "Venda" precisa ser um número inteiro.'), "FALLBACK"),
    ).toBe('A pontuação de "Venda" precisa ser um número inteiro.');
  });

  it("erro do banco continua traduzido: o `message` cru não vai para a tela", () => {
    const erro = dbError("salvar regra de pontuação", {
      code: "42501",
      message: "permission denied for table game_scoring_rules",
    });

    expect(describeGameError(erro, "FALLBACK")).toBe("Você não tem permissão para esta ação.");
  });

  it("erro sem mensagem cai no fallback da tela", () => {
    expect(describeGameError(new Error("   "), "FALLBACK")).toBe("FALLBACK");
    expect(describeGameError(null, "FALLBACK")).toBe("FALLBACK");
  });
});

describe("monthStart", () => {
  it("primeiro dia do mês, como month_start() do banco", () => {
    expect(monthStart("2026-08-27")).toBe("2026-08-01");
    expect(monthStart("2026-12-01")).toBe("2026-12-01");
  });
});

/**
 * A semana da premiação (pedido do cliente em 10/09/2026).
 *
 * Ela é FILTRO, não ciclo: o jogo continua fechando por temporada. O que estes
 * asserts travam é o recorte — segunda a domingo — e a virada, que é onde o
 * prêmio troca de dono se a conta escorregar um dia.
 */
describe("weekRange", () => {
  it("recorta de segunda a domingo a partir de qualquer dia da semana", () => {
    // 10/09/2026 é uma quinta-feira.
    expect(weekRange("2026-09-10")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("segunda pertence à própria semana e domingo à que começou antes dele", () => {
    // A virada é na segunda de manhã: 13/09 (domingo) ainda paga a semana de
    // 07/09; 14/09 (segunda) já é a semana seguinte. Um `weekStartsOn` domingo
    // — o padrão de `Date.getDay()` — jogaria o domingo para a semana errada e
    // trocaria o ganhador.
    expect(weekRange("2026-09-07")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(weekRange("2026-09-13")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(weekRange("2026-09-14")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("atravessa a virada do ano sem quebrar a semana", () => {
    expect(weekRange("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("não depende do fuso do navegador", () => {
    // A conta é ancorada em UTC (`T00:00:00Z` + `get/setUTC*`) justamente para
    // a TV da loja num notebook em outro fuso não virar a semana antes ou
    // depois da operação. O fuso real do dia é resolvido uma vez só, no banco.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(weekRange("2026-09-13")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
      process.env.TZ = "Pacific/Midway"; // UTC-11
      expect(weekRange("2026-09-13")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("weeksInRange", () => {
  it("devolve semanas inteiras, mesmo quando a temporada começa no meio de uma", () => {
    // Temporada de 09/09 (quarta) a 21/09: o prêmio é por semana, não pró-rata
    // dos dias corridos, então a primeira opção começa na segunda anterior.
    expect(weeksInRange("2026-09-09", "2026-09-21")).toEqual([
      { from: "2026-09-07", to: "2026-09-13" },
      { from: "2026-09-14", to: "2026-09-20" },
      { from: "2026-09-21", to: "2026-09-27" },
    ]);
  });

  it("temporada de um dia só oferece uma semana", () => {
    expect(weeksInRange("2026-09-10", "2026-09-10")).toEqual([{ from: "2026-09-07", to: "2026-09-13" }]);
  });

  it("fim antes do começo devolve vazio, não laço infinito", () => {
    expect(weeksInRange("2026-09-21", "2026-09-07")).toEqual([]);
  });
});

describe("gameKeys.ranking", () => {
  it("mês e semana que começam no MESMO dia têm chaves diferentes", () => {
    // 01/06/2026 é uma segunda-feira: `intervaloDoMes` e `weekRange` começam no
    // mesmo dia e só o fim os separa. Com a chave só no início, as duas
    // consultas colidiam no cache do TanStack Query e uma devolvia o número da
    // outra — o VGV da semana dividido pela meta do mês na faixa do corretor.
    expect(weekRange("2026-06-03").from).toBe("2026-06-01");

    const semana = gameKeys.ranking("s1", "2026-06-01", "2026-06-07");
    const mes = gameKeys.ranking("s1", "2026-06-01", "2026-06-30");

    expect(semana).not.toEqual(mes);
  });

  it("sem intervalo é a temporada inteira, e continua sob o prefixo `game`", () => {
    // O prefixo é o que faz a invalidação única do `EngagementLayer` alcançar
    // placar, temporada e regras de uma vez.
    expect(gameKeys.ranking("s1")).toEqual(["game", "ranking", "s1", null, null]);
    expect(gameKeys.ranking("s1")).not.toEqual(gameKeys.ranking("s1", "2026-06-01", "2026-06-30"));
  });
});

describe("listRanking", () => {
  const rpcOk = (rows: unknown[] = []) => {
    rpc.mockReturnValue({ order: () => Promise.resolve({ data: rows, error: null }) });
  };

  it("sem semana usa a assinatura de um argumento — a temporada inteira", async () => {
    // O conjunto de nomes é o que o PostgREST usa para escolher entre as duas
    // assinaturas de `visible_game_ranking` (migration 0107). Mandar
    // `p_from`/`p_to` nulos aqui cairia na de três e mudaria a função chamada
    // por `EngagementLayer` e `PipelineTopRanking`.
    rpcOk();

    await listRanking("s1");

    expect(rpc).toHaveBeenCalledWith("visible_game_ranking", { p_season_id: "s1" });
  });

  it("com semana manda o intervalo tal e qual, sem converter para instante", async () => {
    // As datas saem de `current_work_date()` e de `game_seasons.period_start`,
    // que já são o dia de São Paulo. Qualquer `new Date(...).toISOString()` no
    // caminho devolveria o dia anterior depois das 21h de Brasília.
    rpcOk();

    await listRanking("s1", { from: "2026-09-07", to: "2026-09-13" });

    expect(rpc).toHaveBeenCalledWith("visible_game_ranking", {
      p_season_id: "s1",
      p_from: "2026-09-07",
      p_to: "2026-09-13",
    });
  });

  it("erro do banco sobe com o nome da RPC", async () => {
    rpc.mockReturnValue({
      order: () => Promise.resolve({ data: null, error: { code: "42501", message: "denied" } }),
    });

    await expect(listRanking("s1", { from: "2026-09-07", to: "2026-09-13" }))
      .rejects.toThrow(/visible_game_ranking/);
  });
});
