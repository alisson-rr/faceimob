import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/anuncios/${p}` } }) }) } },
}));

import { ordenarPorCpl, semRepetidos, type Anuncio } from "./anuncios";

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

describe("semRepetidos", () => {
  const peca = (ad_id: string, path: string, copy = "Saia do aluguel") =>
    ({ ad_id, campanha_id: "c1", formato: "video", titulo: null, copy, imagens: [], imagem_meta_url: null, imagem_path: path }) as unknown as Anuncio;

  it("a mesma peça em dois conjuntos aparece uma vez; arte diferente (teste A/B) fica", () => {
    const lista = [
      peca("1", "111/0-39b27a45.jpg"),
      peca("2", "222/0-39b27a45.jpg"),
      peca("3", "333/0-ea664fe3.png"),
      peca("4", "444/0-39b27a45.jpg", "Outro texto"),
    ];
    expect(semRepetidos(lista).map((a) => a.ad_id)).toEqual(["1", "3", "4"]);
  });
});
