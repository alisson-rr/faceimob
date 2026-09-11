import { describe, expect, it } from "vitest";
import { brokerTextClass, dealAgeTone, DEAL_AGE_CLASS } from "./tone";

/**
 * Cores do Pipeline que o cliente definiu em 10/09/2026 — as duas telas
 * (tabela e cartao) leem daqui, entao um corte errado aqui pinta o quadro
 * inteiro de verde sem ninguem perceber.
 */
describe("dealAgeTone", () => {
  it("corta em tres faixas: verde ate 3, amarelo de 4 a 9, vermelho de 10", () => {
    // As bordas sao o que a regra tem de fragil: 3 ainda e verde, 4 ja e
    // amarelo, 9 ainda e amarelo, 10 ja e vermelho.
    expect([0, 3].map(dealAgeTone)).toEqual(["success", "success"]);
    expect([4, 9].map(dealAgeTone)).toEqual(["warning", "warning"]);
    expect([10, 100].map(dealAgeTone)).toEqual(["danger", "danger"]);
  });

  it("tem cor propria para as tres faixas, sem emprestar mapa de outro sentido", () => {
    // A idade pegava emprestada a paleta do Status 2: mexer na cor de um status
    // repintava a coluna "Dias". Fixado aqui porque a troca de mapa nao quebra
    // nada visivelmente — o verde continua verde ate alguem mexer no Status 2.
    expect([0, 5, 20].map((dias) => DEAL_AGE_CLASS[dealAgeTone(dias)].text))
      .toEqual(["text-success", "text-warning", "text-destructive"]);
  });
});

describe("brokerTextClass", () => {
  it("da sempre a mesma cor para o mesmo corretor", () => {
    expect(brokerTextClass("Ana Souza")).toBe(brokerTextClass("  ana souza "));
  });

  it("nunca usa chart-3, que reprova no contraste de TEXTO no tema claro", () => {
    // 3,98:1 sobre `card` no tema claro; nome de corretor e texto de 12 px e
    // precisa de 4,5:1. Fixado aqui porque a paleta e escolhida por hash: sem
    // este teste, incluir o token de volta nao quebra nada visivelmente.
    const cores = ["Ana", "Bruno", "Carla", "Diego", "Eva", "Fabio", "Gil", "Hugo"].map(brokerTextClass);
    expect(cores).not.toContain("text-chart-3");
    expect(new Set(cores).size).toBeGreaterThan(1);
  });
});
