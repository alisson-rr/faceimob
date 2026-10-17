// @vitest-environment node
import { describe, expect, it } from "vitest";
import { corpoDoLote, eventoParaMeta, sha256 } from "./payload.ts";

/**
 * O lote da API de Conversões para CRM (0288). O que se trava aqui: o id do
 * lead chega inteiro à Meta (é por ele que ela acha o anúncio), e telefone e
 * e-mail nunca saem em texto puro.
 */
const base = {
  id: "e1",
  event_name: "Virou negócio",
  event_time: "2026-10-17T12:00:00Z",
  leadgen_id: "1234567890123456789",
  phone: "5551999998888",
  email: "  Cliente@Exemplo.com ",
};

describe("eventoParaMeta", () => {
  it("monta o evento de CRM com hash do telefone e do e-mail normalizados", async () => {
    const evento = await eventoParaMeta(base);
    expect(evento).toMatchObject({
      event_name: "Virou negócio",
      event_time: Date.UTC(2026, 9, 17, 12) / 1000,
      action_source: "system_generated",
      custom_data: { event_source: "crm", lead_event_source: "Faceimob CRM" },
    });
    expect(evento?.user_data.ph).toEqual([await sha256("5551999998888")]);
    expect(evento?.user_data.em).toEqual([await sha256("cliente@exemplo.com")]);
    expect(JSON.stringify(evento)).not.toContain("Cliente@Exemplo.com");
    expect(JSON.stringify(evento)).not.toContain("999998888\"");
  });

  it("descarta o evento sem leadgen_id numérico", async () => {
    expect(await eventoParaMeta({ ...base, leadgen_id: null })).toBeNull();
    expect(await eventoParaMeta({ ...base, leadgen_id: "site-123" })).toBeNull();
  });
});

describe("corpoDoLote", () => {
  it("escreve o lead_id como número sem arredondar os 19 dígitos", async () => {
    const evento = await eventoParaMeta(base);
    const corpo = corpoDoLote(evento ? [evento] : [], "tok");
    expect(corpo).toContain('"lead_id":1234567890123456789');
    expect(Number("1234567890123456789").toString()).not.toBe("1234567890123456789");
  });
});
