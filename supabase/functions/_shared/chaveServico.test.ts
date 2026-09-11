import { describe, expect, it } from "vitest";
import { tokenEhChaveDeServico } from "./chaveServico.ts";

// Valores fictícios: nenhuma chave real entra em teste.
const COFRE = "sb_secret_cofre_0123456789abcdef";
const AMBIENTE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura-do-ambiente";

/** Token que conta quantas vezes o comparador leu um caractere dele. É o jeito
 *  determinístico de provar "sem atalho": cronometrar seria teste instável. */
function tokenContado(valor: string) {
  const leituras = { n: 0 };
  const token = Object.assign(new String(valor), {
    charCodeAt(i: number) {
      leituras.n++;
      return String.prototype.charCodeAt.call(valor, i);
    },
  }) as unknown as string;
  return { token, leituras };
}

describe("tokenEhChaveDeServico", () => {
  it("aceita o token igual à chave do cofre ou à do ambiente", () => {
    expect(tokenEhChaveDeServico(COFRE, [COFRE, AMBIENTE])).toBe(true);
    expect(tokenEhChaveDeServico(AMBIENTE, [COFRE, AMBIENTE])).toBe(true);
    // Cofre fora do ar: getSecret devolve o ambiente, ou nada.
    expect(tokenEhChaveDeServico(AMBIENTE, [null, AMBIENTE])).toBe(true);
  });

  it("recusa JWT com payload service_role que não é a chave configurada", () => {
    // O ataque da conferência: payload {"role":"service_role"}, assinatura lixo.
    expect(tokenEhChaveDeServico("x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.qualquer", [COFRE, AMBIENTE])).toBe(false);
    // Mesmo payload e mesmo comprimento da chave do ambiente, assinatura trocada.
    const forjado = AMBIENTE.replace("assinatura-do-ambiente", "assinatura-do-atacante");
    expect(forjado.length).toBe(AMBIENTE.length);
    expect(tokenEhChaveDeServico(forjado, [COFRE, AMBIENTE])).toBe(false);
  });

  it("recusa token vazio, inclusive quando não há chave configurada", () => {
    expect(tokenEhChaveDeServico("", [COFRE, AMBIENTE])).toBe(false);
    expect(tokenEhChaveDeServico("", [null, undefined, ""])).toBe(false);
    expect(tokenEhChaveDeServico("qualquer", [null, undefined, ""])).toBe(false);
  });

  it("recusa comprimento diferente sem o tempo depender do token", () => {
    const prefixo = COFRE.slice(0, -1);
    const comSobra = `${COFRE}x`;
    expect(tokenEhChaveDeServico(prefixo, [COFRE])).toBe(false);
    expect(tokenEhChaveDeServico(comSobra, [COFRE])).toBe(false);

    // Curto, prefixo quase inteiro, 100x mais longo: o comparador lê o token o
    // mesmo número de vezes — o comprimento da chave, nunca o do token.
    for (const valor of ["s", prefixo, comSobra, COFRE.repeat(100)]) {
      const { token, leituras } = tokenContado(valor);
      expect(tokenEhChaveDeServico(token, [COFRE])).toBe(false);
      expect(leituras.n).toBe(COFRE.length);
    }
  });
});
