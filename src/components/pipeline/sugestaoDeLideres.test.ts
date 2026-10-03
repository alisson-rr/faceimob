/**
 * Trocar o Corretor N troca a sugestão de Gerente N e Diretor N (pedido de
 * 29/09/2026: "se muda o corretor não traz as novas sugestões").
 */
import { describe, expect, it, vi } from "vitest";
import { lideresDoNegocio, sugestaoDeLideres } from "./DealForm";
import type { PersonRecord } from "@/integrations/supabase/newSchema";

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

describe("corretor que não enxerga a equipe (0199)", () => {
  // O corretor só se vê pela RLS: sem gerente nem diretor na lista visível.
  const eu = { id: "eu", name: "Valmir", active: true, roles: ["broker"], manager_id: null, director_id: null } as unknown as PersonRecord;
  const daRpc = {
    lideres: [
      { id: "g1", name: "Gerente Um", isManager: true, isDirector: false },
      { id: "d1", name: "Diretora Um", isManager: false, isDirector: true },
    ],
    equipes: [{ id: "eu", manager_id: "g1", director_id: "d1" }],
  };

  it("as listas vêm da RPC e a sugestão preenche gerente e diretor", () => {
    const { managers, directors, lideranca } = lideresDoNegocio([eu], daRpc);
    expect(managers.map((m) => m.id)).toEqual(["d1", "g1"]);
    expect(directors.map((d) => d.id)).toEqual(["d1"]);
    expect(sugestaoDeLideres({}, "eu", 1, lideranca, managers, directors))
      .toEqual({ manager1_id: "g1", director1_id: "d1" });
  });

  it("sem as RPCs (deploy fora de ordem) fica a lista visível, sem quebrar", () => {
    const { managers, lideranca } = lideresDoNegocio([eu], null);
    expect(managers).toEqual([]);
    expect(sugestaoDeLideres({}, "eu", 1, lideranca, managers, [])).toEqual({});
  });
});
