import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirCartaoNoSafari, compartilharVcard, nomeDoContato, vcardDoLead } from "./contatoVcard";

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

describe("compartilharVcard (iPhone)", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => { if (original) Object.defineProperty(globalThis, "navigator", original); });
  const comNavigator = (parcial: object) => Object.defineProperty(globalThis, "navigator", { value: parcial, configurable: true });

  it("compartilha o arquivo .vcf pela folha de compartilhar", async () => {
    const share = vi.fn(async () => undefined);
    comNavigator({ canShare: () => true, share });
    expect(await compartilharVcard("BEGIN:VCARD\r\nEND:VCARD\r\n", "Maria")).toBe("compartilhado");
    const arquivo = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(arquivo.name).toBe("Maria.vcf");
    expect(arquivo.type).toBe("text/vcard");
  });

  it("fechar a folha não é erro", async () => {
    comNavigator({ canShare: () => true, share: async () => { throw new DOMException("x", "AbortError"); } });
    expect(await compartilharVcard("BEGIN:VCARD\r\nEND:VCARD\r\n", "Maria")).toBe("cancelado");
  });

  it("sem suporte a compartilhar arquivo, baixa o .vcf", async () => {
    comNavigator({});
    const criar = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { createObjectURL: criar, revokeObjectURL: vi.fn() });
    expect(await compartilharVcard("BEGIN:VCARD\r\nEND:VCARD\r\n", "Maria")).toBe("baixado");
    expect(criar).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("sem telefone, não faz nada", async () => {
    expect(await compartilharVcard(null, "Maria")).toBe("sem-telefone");
  });
});

describe("abrirCartaoNoSafari (iPhone)", () => {
  it("navega para um data URI text/vcard com o cartão inteiro", () => {
    const navegar = vi.fn();
    expect(abrirCartaoNoSafari("BEGIN:VCARD\r\nFN:Maria\r\nEND:VCARD\r\n", navegar)).toBe("aberto");
    const url = navegar.mock.calls[0][0] as string;
    expect(url.startsWith("data:text/vcard;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.split(",").slice(1).join(","))).toContain("FN:Maria");
  });

  it("sem telefone, não navega", () => {
    const navegar = vi.fn();
    expect(abrirCartaoNoSafari(null, navegar)).toBe("sem-telefone");
    expect(navegar).not.toHaveBeenCalled();
  });
});
