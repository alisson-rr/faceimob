import { describe, expect, it } from "vitest";
import {
  detectRankUp,
  groupSaleEvents,
  hslToHex,
  joinNames,
  parseHslToken,
} from "./celebrations";

describe("groupSaleEvents", () => {
  it("junta os corretores do mesmo negocio num lote so", () => {
    const batches = groupSaleEvents([
      { id: "e1", profileId: "ana", refId: "deal-1" },
      { id: "e2", profileId: "bruno", refId: "deal-1" },
      { id: "e3", profileId: "carlos", refId: "deal-1" },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0].key).toBe("deal-1");
    expect(batches[0].profileIds).toEqual(["ana", "bruno", "carlos"]);
    expect(batches[0].eventIds).toEqual(["e1", "e2", "e3"]);
  });

  it("separa negocios diferentes e preserva a ordem de chegada", () => {
    const batches = groupSaleEvents([
      { id: "e1", profileId: "ana", refId: "deal-1" },
      { id: "e2", profileId: "bruno", refId: "deal-2" },
      { id: "e3", profileId: "carlos", refId: "deal-1" },
    ]);

    expect(batches.map((b) => b.key)).toEqual(["deal-1", "deal-2"]);
    expect(batches[0].profileIds).toEqual(["ana", "carlos"]);
  });

  it("nao junta eventos sem ref_id: correcao manual do admin e avulsa", () => {
    const batches = groupSaleEvents([
      { id: "e1", profileId: "ana", refId: null },
      { id: "e2", profileId: "bruno", refId: null },
    ]);

    expect(batches).toHaveLength(2);
  });

  it("ignora reentrega do mesmo evento pelo realtime", () => {
    const batches = groupSaleEvents([
      { id: "e1", profileId: "ana", refId: "deal-1" },
      { id: "e1", profileId: "ana", refId: "deal-1" },
    ]);

    expect(batches[0].eventIds).toEqual(["e1"]);
    expect(batches[0].profileIds).toEqual(["ana"]);
  });

  it("lista vazia nao gera lote", () => {
    expect(groupSaleEvents([])).toEqual([]);
  });
});

describe("joinNames", () => {
  it("escreve a lista em portugues", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Bruno"])).toBe("Ana e Bruno");
    expect(joinNames(["Ana", "Bruno", "Carlos"])).toBe("Ana, Bruno e Carlos");
  });

  it("cai para 'Equipe' quando o RLS escondeu todos os nomes", () => {
    expect(joinNames([])).toBe("Equipe");
    expect(joinNames(["", "   "])).toBe("Equipe");
  });
});

describe("detectRankUp", () => {
  const antes = ["ana", "bruno", "carlos", "duda"];

  it("detecta a subida do proprio usuario", () => {
    const depois = ["ana", "carlos", "bruno", "duda"];
    expect(detectRankUp(antes, depois, "carlos")).toEqual({ from: 3, to: 2 });
  });

  it("nao comemora descida nem empate de posicao", () => {
    const depois = ["ana", "carlos", "bruno", "duda"];
    expect(detectRankUp(antes, depois, "bruno")).toBeNull();
    expect(detectRankUp(antes, depois, "ana")).toBeNull();
  });

  it("nao comemora na primeira carga, quando nao ha posicao anterior", () => {
    expect(detectRankUp([], antes, "carlos")).toBeNull();
  });

  it("nao comemora quem entrou agora no ranking nem usuario ausente", () => {
    expect(detectRankUp(antes, [...antes, "novo"], "novo")).toBeNull();
    expect(detectRankUp(antes, ["bruno"], "carlos")).toBeNull();
  });

  it("sem usuario logado nao comemora", () => {
    expect(detectRankUp(antes, antes, null)).toBeNull();
    expect(detectRankUp(antes, antes, undefined)).toBeNull();
  });
});

describe("cor do token", () => {
  it("converte HSL para hex", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
  });

  it("le o token no formato de index.css", () => {
    expect(parseHslToken("0 100% 50%")).toBe("#ff0000");
    expect(parseHslToken("  240 100% 50%  ")).toBe("#0000ff");
  });

  it("devolve null quando o token nao existe ou vem estranho", () => {
    expect(parseHslToken("")).toBeNull();
    expect(parseHslToken(null)).toBeNull();
    expect(parseHslToken("azul")).toBeNull();
    expect(parseHslToken("214 72%")).toBeNull();
  });
});
