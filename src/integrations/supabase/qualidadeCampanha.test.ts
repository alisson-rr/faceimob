import { describe, expect, it } from "vitest";
import { atribuicaoSuspeita, crmRecebeuPouco, percentual } from "./qualidadeCampanha";

describe("qualidade por campanha", () => {
  it("percentual arredonda e não inventa taxa sem base", () => {
    expect(percentual(1, 3)).toBe(33);
    expect(percentual(0, 0)).toBeNull();
  });

  it("marca atribuição suspeita só com mais de um nome ou formulário", () => {
    expect(atribuicaoSuspeita({ nomes_distintos: 1, formularios: 1 })).toBe(false);
    expect(atribuicaoSuspeita({ nomes_distintos: 2, formularios: 1 })).toBe(true);
    expect(atribuicaoSuspeita({ nomes_distintos: 1, formularios: 3 })).toBe(true);
  });

  it("avisa quando o CRM recebeu menos da metade dos resultados da Meta", () => {
    expect(crmRecebeuPouco({ leads: 8, resultados_meta: 40 })).toBe(true);
    expect(crmRecebeuPouco({ leads: 30, resultados_meta: 40 })).toBe(false);
    expect(crmRecebeuPouco({ leads: 0, resultados_meta: 3 })).toBe(false);
  });
});
