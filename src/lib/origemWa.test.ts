import { describe, expect, it } from "vitest";
import { ehOrigemWa, rotuloOrigemWa } from "./origemWa";

describe("origens de WhatsApp no grupo (05/11/2026)", () => {
  it("diz o que cada origem pega, não o código técnico", () => {
    expect(rotuloOrigemWa({ code: "whatsapp_ads", label: "WhatsApp · Anúncio" }).titulo)
      .toBe("Todas as campanhas de WhatsApp não cadastradas");
    expect(rotuloOrigemWa({ code: "whatsapp_direto", label: "WhatsApp · Direto" }).titulo).toBe("Conversas sem anúncio");
    expect(rotuloOrigemWa({ code: "wa_campanha_1", label: "WhatsApp · WHATS | CASAS" }).titulo).toBe("WHATS | CASAS");
  });

  it("só entram origens de WhatsApp", () => {
    expect(ehOrigemWa({ code: "whatsapp_ads", channel: "meta" })).toBe(true);
    expect(ehOrigemWa({ code: "wa_campanha_9", channel: "whatsapp" })).toBe(true);
    expect(ehOrigemWa({ code: "meta_ads", channel: "meta" })).toBe(false);
  });
});
