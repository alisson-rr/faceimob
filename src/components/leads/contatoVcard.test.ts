import { describe, expect, it } from "vitest";
import { nomeDoContato, vcardDoLead } from "./contatoVcard";

const lead = (extra: Partial<Parameters<typeof vcardDoLead>[0]> = {}) => ({
  name: "Maria Souza", phone: "(51) 99999-0000", campaign_name: "Solar do Bosque", utm_campaign: null, source: "Meta",
  ...extra,
});

describe("contato do lead para o celular", () => {
  it("nome no formato Nome | Campanha | Faceimob; sem campanha, a origem", () => {
    expect(nomeDoContato(lead())).toBe("Maria Souza | Solar do Bosque | Faceimob");
    expect(nomeDoContato(lead({ campaign_name: null, utm_campaign: null, source: "Site · Popup" })))
      .toBe("Maria Souza | Site · Popup | Faceimob");
    expect(nomeDoContato(lead({ campaign_name: null, utm_campaign: null, source: "" }))).toBe("Maria Souza | Faceimob");
  });

  it("vCard com o telefone com DDI e o texto escapado", () => {
    const v = vcardDoLead(lead({ campaign_name: "Lote; 2, fase" }));
    expect(v).toContain("FN:Maria Souza | Lote\\; 2\\, fase | Faceimob");
    expect(v).toContain("TEL;TYPE=CELL:+5551999990000");
    expect(v?.startsWith("BEGIN:VCARD\r\nVERSION:3.0")).toBe(true);
  });

  it("sem telefone não há cartão", () => {
    expect(vcardDoLead(lead({ phone: "" }))).toBeNull();
  });
});
