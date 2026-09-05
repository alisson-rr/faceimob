import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("./client", () => ({ supabase: { from } }));

import { describeGameError, monthStart, setDefaultScoringPoints } from "./game";
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

beforeEach(() => from.mockReset());

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
