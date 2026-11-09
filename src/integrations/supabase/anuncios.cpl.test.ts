import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ordenarPorCpl, type Anuncio } from "./anuncios";

const anuncio = (ad_id: string, campanha_id: string | null) => ({ ad_id, campanha_id }) as Anuncio;

describe("ordenarPorCpl", () => {
  it("menor CPL primeiro; sem CPL vai para o fim mantendo a ordem anterior", () => {
    const lista = [anuncio("1", "caro"), anuncio("2", null), anuncio("3", "barato"), anuncio("4", "sem-dado"), anuncio("5", "barato")];
    const cpls = [
      { campanha_id: "barato", posicao: 1, cpl: 12.5 },
      { campanha_id: "caro", posicao: 2, cpl: 40 },
    ];
    expect(ordenarPorCpl(lista, cpls).map((a) => a.ad_id)).toEqual(["3", "5", "1", "2", "4"]);
  });

  it("sem dados de CPL a lista fica como veio", () => {
    const lista = [anuncio("1", "a"), anuncio("2", "b")];
    expect(ordenarPorCpl(lista, []).map((a) => a.ad_id)).toEqual(["1", "2"]);
  });
});
