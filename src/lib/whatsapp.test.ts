import { describe, expect, it } from "vitest";
import { linkWhatsapp } from "./whatsapp";

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
