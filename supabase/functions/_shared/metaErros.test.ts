import { describe, expect, it } from "vitest";
import { AVISO_ACEITE, codigoDoErroMeta, descreverFalhaMeta, explicarErroMeta } from "./metaErros.ts";

/**
 * O que a Meta recusou, em português.
 *
 * O teste que importa aqui não é "traduz 131047" — é o contrário: **código
 * desconhecido não pode ganhar explicação inventada**. Uma tradução plausível
 * para um código novo manda a operação para o lado errado com ar de certeza,
 * que é pior do que mostrar o JSON feio da Meta.
 */
describe("explicarErroMeta", () => {
  it("traduz a janela de 24 h, que é a recusa mais comum do remarketing", () => {
    const erro = explicarErroMeta({ error: { code: 131047, message: "(#131047) Re-engagement message" } });
    expect(erro?.titulo).toBe("Janela de 24 horas fechada");
    expect(erro?.proximo_passo).toMatch(/template aprovado/i);
    // Repetir o mesmo texto livre não muda nada: o que precisa mudar é a mensagem.
    expect(erro?.vale_repetir).toBe(false);
  });

  it("separa o que adianta repetir do que não adianta", () => {
    // Limite de ritmo passa sozinho; regra de janela e template, não.
    expect(explicarErroMeta({ error: { code: 80007 } })?.vale_repetir).toBe(true);
    expect(explicarErroMeta({ error: { code: 4 } })?.vale_repetir).toBe(true);
    expect(explicarErroMeta({ error: { code: 132001 } })?.vale_repetir).toBe(false);
    expect(explicarErroMeta({ error: { code: 190 } })?.vale_repetir).toBe(false);
  });

  it("código desconhecido devolve null em vez de inventar explicação", () => {
    expect(explicarErroMeta({ error: { code: 999999, message: "algo novo" } })).toBeNull();
    expect(explicarErroMeta({})).toBeNull();
    expect(explicarErroMeta(null)).toBeNull();
    expect(explicarErroMeta("não é objeto")).toBeNull();
  });
});

describe("codigoDoErroMeta", () => {
  it("acha o código nos três lugares em que a Meta o esconde", () => {
    expect(codigoDoErroMeta({ error: { code: 131026 } })).toBe(131026);
    expect(codigoDoErroMeta({ statuses: [{ errors: [{ code: 131047 }] }] })).toBe(131047);
    // O webhook de entrega, que é onde chega a falha DEFINITIVA — ler só o
    // primeiro formato deixava justamente esse caso sem explicação.
    expect(
      codigoDoErroMeta({ entry: [{ changes: [{ value: { statuses: [{ errors: [{ code: 130497 }] }] } }] }] }),
    ).toBe(130497);
  });

  it("não confunde ausência de erro com código zero", () => {
    expect(codigoDoErroMeta({ error: { message: "sem código" } })).toBeNull();
    expect(codigoDoErroMeta({ messages: [{ id: "wamid.x" }] })).toBeNull();
  });
});

describe("descreverFalhaMeta", () => {
  it("devolve a frase útil quando conhece o código", () => {
    const texto = descreverFalhaMeta({ error: { code: 131047 } });
    expect(texto).toContain("Janela de 24 horas fechada");
    expect(texto).toContain("→");
  });

  it("devolve a mensagem CRUA da Meta quando não conhece — feia, mas verdadeira", () => {
    const texto = descreverFalhaMeta({ error: { code: 987654, message: "Unsupported post request" } });
    expect(texto).toBe("A Meta recusou: Unsupported post request");
  });

  it("cabe no campo: nunca passa de 400 caracteres", () => {
    const gigante = { error: { code: 987654, message: "x".repeat(5000) } };
    expect(descreverFalhaMeta(gigante).length).toBeLessThanOrEqual(400);
    expect(descreverFalhaMeta({ lixo: "y".repeat(5000) }).length).toBeLessThanOrEqual(400);
  });
});

describe("AVISO_ACEITE", () => {
  it("diz que o 200 é aceite e não entrega", () => {
    // A tela que escreve "enviado" no 200 mente por omissão: a falha definitiva
    // chega depois, pelo webhook de status.
    expect(AVISO_ACEITE).toMatch(/aceite/i);
    expect(AVISO_ACEITE).toMatch(/webhook/i);
  });
});
