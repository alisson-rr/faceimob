import { describe, expect, it } from "vitest";
import { ALL_MONTHS } from "@/components/dashboard";
import { intervaloDoMes, mesDaMetaDoCorretor } from "./PipelineTopRanking";

/**
 * O período da faixa do corretor — as duas pontas da mesma fração.
 *
 * A faixa mostrava "Meta de Vendas: —" para todo corretor real: lia `goals` com
 * `metric = 'sales'` no escopo de perfil, que nenhuma tela grava, e ainda
 * procurava no mês da TEMPORADA, enquanto /equipes grava sempre no mês
 * corrente. Agora lê a meta de VGV do perfil no mês do relógio — o mesmo mês em
 * que `MetaVgv` grava e o mesmo que o Dashboard abre — e o realizado é lido
 * nesse mesmo mês (`intervaloDoMes`), em vez do acumulado da temporada.
 */
describe("mesDaMetaDoCorretor", () => {
  it("é o mês corrente, no formato que `useGoal` espera", () => {
    expect(mesDaMetaDoCorretor(true, new Date(2026, 8, 10))).toBe("09/2026");
  });

  it("não segue a temporada: em setembro cobra a meta de setembro", () => {
    // Temporada aberta em agosto atravessa a virada do mês. A meta é MENSAL e
    // /equipes só grava no mês corrente — ler agosto em setembro devolvia nulo
    // e o traço voltava com outra causa.
    expect(mesDaMetaDoCorretor(true, new Date(2026, 7, 31))).toBe("08/2026");
    expect(mesDaMetaDoCorretor(true, new Date(2026, 8, 1))).toBe("09/2026");
  });

  it("desliga a consulta para quem não vê a faixa", () => {
    // Gerente, diretor e admin veem o pódio, não a barra da meta pessoal.
    expect(mesDaMetaDoCorretor(false, new Date(2026, 8, 10))).toBe(ALL_MONTHS);
  });
});

describe("intervaloDoMes", () => {
  it("cobre o mês inteiro do dia informado", () => {
    expect(intervaloDoMes(new Date(2026, 8, 10))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("fecha em 31 e em 28 quando é o caso — sem dia inventado", () => {
    expect(intervaloDoMes(new Date(2026, 0, 15)).to).toBe("2026-01-31");
    expect(intervaloDoMes(new Date(2026, 1, 15)).to).toBe("2026-02-28");
  });

  it("fevereiro bissexto vai até 29", () => {
    expect(intervaloDoMes(new Date(2028, 1, 3)).to).toBe("2028-02-29");
  });

  it("é o mesmo mês que a meta cobra", () => {
    const hoje = new Date(2026, 8, 22);
    // As duas pontas da fração saem da mesma data: numerador e denominador não
    // têm como cair em meses diferentes.
    expect(intervaloDoMes(hoje).from.slice(0, 7)).toBe("2026-09");
    expect(mesDaMetaDoCorretor(true, hoje)).toBe("09/2026");
  });
});
