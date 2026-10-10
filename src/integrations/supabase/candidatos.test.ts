import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));

import { respostasDoCandidato } from "./candidatos";

describe("respostasDoCandidato", () => {
  it("mostra só respostas preenchidas, sem '?' e sem objeto", () => {
    expect(respostasDoCandidato({ Nome: "Marina", Unidade: "Zona Sul", CRECI: "?", Bairro: " ", Extra: { a: 1 }, Integral: true }))
      .toEqual([["Nome", "Marina"], ["Unidade", "Zona Sul"], ["Integral", "true"]]);
  });
});
