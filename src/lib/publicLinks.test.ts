import { describe, expect, it } from "vitest";
import { LINK_VALIDITY_DAYS, linkExpiry, linkLock } from "./publicLinks";

/**
 * Os dois estados em que o link público para de abrir sem que o admin saiba.
 *
 * `expires_at` existe desde a 0009 e `locked_until` desde a 0033, e nenhuma tela
 * lia qualquer um dos dois: o link vencia (ou travava por 5 PINs errados) e o
 * gerente do outro lado recebia a mesma frase de PIN errado — de propósito, para
 * a recusa não virar oráculo de slug. O remédio, então, tem de estar aqui.
 */

const AGORA = new Date("2026-09-02T12:00:00Z").getTime();
const emDias = (dias: number) => new Date(AGORA + dias * 86_400_000).toISOString();

describe("validade do link", () => {
  it("link sem validade é aviso, não estado normal", () => {
    // Todo link criado pela tela antes da 0062 nasceu eterno: sem prazo e sem
    // revogação, um link vazado nunca fecha.
    expect(linkExpiry(null, AGORA)).toMatchObject({ tone: "warn", days: null });
  });

  it("link vencido é falha, e a tela diz que ele não abre", () => {
    const vencido = linkExpiry(emDias(-1), AGORA);
    expect(vencido.tone).toBe("bad");
    expect(vencido.label).toMatch(/não abre/i);
  });

  it("a última semana avisa antes de virar problema", () => {
    expect(linkExpiry(emDias(7), AGORA).tone).toBe("warn");
    expect(linkExpiry(emDias(8), AGORA).tone).toBe("ok");
    expect(linkExpiry(emDias(LINK_VALIDITY_DAYS), AGORA)).toMatchObject({
      tone: "ok",
      days: LINK_VALIDITY_DAYS,
    });
  });
});

describe("trava por PIN errado", () => {
  it("dentro da janela, o link está travado e a tela diz até quando", () => {
    const travado = linkLock(new Date(AGORA + 10 * 60_000).toISOString(), 0, AGORA);
    expect(travado.locked).toBe(true);
    expect(travado.label).toMatch(/travado até/i);
  });

  it("trava vencida não é trava — o link volta sozinho", () => {
    expect(linkLock(new Date(AGORA - 60_000).toISOString(), 0, AGORA)).toEqual({ locked: false, label: null });
  });

  it("erro acumulado aparece antes de virar bloqueio", () => {
    // Três erros ainda abrem, mas é o sinal de que alguém está tentando — ou de
    // que o gerente está com o PIN antigo.
    const parcial = linkLock(null, 3, AGORA);
    expect(parcial.locked).toBe(false);
    expect(parcial.label).toMatch(/3 PINs errados/);
  });

  it("link limpo não mostra rótulo nenhum", () => {
    expect(linkLock(null, 0, AGORA)).toEqual({ locked: false, label: null });
  });
});
