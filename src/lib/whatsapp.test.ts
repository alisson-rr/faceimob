import { afterEach, describe, expect, it, vi } from "vitest";
import { JANELA_WHATSAPP, abrirWhatsapp, ehCelular, linkWhatsapp } from "./whatsapp";

describe("linkWhatsapp", () => {
  it("no Android abre o app escolhido pelo pacote", () => {
    expect(linkWhatsapp("5551999990000", "Olá", "business", true))
      .toBe("intent://send/?phone=5551999990000&text=Ol%C3%A1#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end");
    expect(linkWhatsapp("5551999990000", "Olá", "normal", true)).toContain("package=com.whatsapp;end");
  });

  it("fora do Android cai no wa.me", () => {
    expect(linkWhatsapp("5551999990000", "Oi tudo bem", "business", false))
      .toBe("https://wa.me/5551999990000?text=Oi%20tudo%20bem");
  });
});

describe("ehCelular", () => {
  it("celular e tablet sim, computador não — o .vcf só serve no celular", () => {
    expect(ehCelular("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(true);
    expect(ehCelular("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(ehCelular("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe(false);
  });
});

describe("abrirWhatsapp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reaproveita sempre a mesma aba nomeada, em vez de abrir uma nova a cada clique", () => {
    const janela = { opener: {} as unknown } as Window;
    const abrir = vi.spyOn(window, "open").mockReturnValue(janela);

    abrirWhatsapp("https://wa.me/5551999990000?text=a");
    abrirWhatsapp("https://wa.me/5551999990001?text=b");

    expect(abrir).toHaveBeenCalledTimes(2);
    for (const chamada of abrir.mock.calls) expect(chamada[1]).toBe(JANELA_WHATSAPP);
    expect(chamada0(abrir)).not.toBe("_blank");
    expect(janela.opener, "a aba aberta não controla esta página").toBeNull();
  });

  it("popup bloqueado não quebra", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => abrirWhatsapp("https://wa.me/5551999990000")).not.toThrow();
  });
});

const chamada0 = (abrir: { mock: { calls: unknown[][] } }) => abrir.mock.calls[0][1];
