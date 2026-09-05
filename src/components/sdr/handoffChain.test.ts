import { describe, expect, it } from "vitest";
import { chainReaches, handoffOptions } from "./handoffChain";

type Fake = { id: string; handoff_to_agent_id: string | null; active: boolean };

const agente = (id: string, handoff: string | null = null, active = true): Fake =>
  ({ id, handoff_to_agent_id: handoff, active });

describe("chainReaches", () => {
  it("segue a cadeia até o alvo", () => {
    const agents = [agente("a", "b"), agente("b", "c"), agente("c")];
    expect(chainReaches(agents, "a", "c")).toBe(true);
    expect(chainReaches(agents, "c", "a")).toBe(false);
  });

  // Sem o conjunto de visitados, um ciclo já gravado (por seed ou script)
  // travaria a tela num laço infinito ao abrir o seletor.
  it("não entra em laço quando a cadeia já está em ciclo", () => {
    const agents = [agente("a", "b"), agente("b", "a")];
    expect(chainReaches(agents, "a", "z")).toBe(false);
  });
});

describe("handoffOptions", () => {
  it("tira o próprio agente, os inativos e quem fecharia o ciclo", () => {
    const agents = [
      agente("a", "b"),           // a → b
      agente("b"),                // b não delega
      agente("c", "a"),           // c → a → b : escolher c em b fecharia b→c→a→b
      agente("d", null, false),   // inativo
      agente("e"),
    ];
    const ids = handoffOptions(agents, "b").map((x) => x.id);
    expect(ids).toEqual(["e"]);
  });

  it("agente ainda não gravado enxerga todos os ativos", () => {
    const agents = [agente("a"), agente("b", null, false)];
    expect(handoffOptions(agents, undefined).map((x) => x.id)).toEqual(["a"]);
  });
});
