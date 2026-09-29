/**
 * Trocar o Corretor N troca a sugestão de Gerente N e Diretor N (pedido de
 * 29/09/2026: "se muda o corretor não traz as novas sugestões").
 */
import { describe, expect, it, vi } from "vitest";
import { sugestaoDeLideres } from "./DealForm";

// `DealForm` puxa o cliente do Supabase pela cadeia de imports; nada aqui vai
// ao servidor.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const people = [
  { id: "ana", manager_id: "g1", director_id: "d1" },
  { id: "bia", manager_id: "g2", director_id: "d2" },
  { id: "caio", manager_id: null, director_id: null },
];
const managers = [{ id: "g1" }, { id: "g2" }];
const directors = [{ id: "d1" }, { id: "d2" }];

describe("sugestão de gerente e diretor pelo corretor", () => {
  it("trocar o corretor troca o gerente e o diretor sugeridos", () => {
    const form = { broker2_id: "ana", manager2_id: "g1", director2_id: "d1" };
    expect(sugestaoDeLideres(form, "bia", 2, people, managers, directors))
      .toEqual({ manager2_id: "g2", director2_id: "d2" });
  });

  it("novo corretor sem equipe tira os líderes do anterior", () => {
    const form = { broker2_id: "ana", manager2_id: "g1", director2_id: "d1" };
    expect(sugestaoDeLideres(form, "caio", 2, people, managers, directors))
      .toEqual({ manager2_id: null, director2_id: null });
  });

  it("líder escolhido à mão fica", () => {
    const form = { broker2_id: "ana", manager2_id: "g2", director2_id: "d2" };
    expect(sugestaoDeLideres(form, "caio", 2, people, managers, directors)).toEqual({});
  });

  it("não repete o gerente de outro slot, e limpa o do corretor anterior", () => {
    const form = { broker1_id: "bia", manager1_id: "g2", broker2_id: "ana", manager2_id: "g1", director2_id: "d1" };
    expect(sugestaoDeLideres(form, "bia", 2, people, managers, directors))
      .toEqual({ manager2_id: null, director2_id: "d2" });
  });
});
