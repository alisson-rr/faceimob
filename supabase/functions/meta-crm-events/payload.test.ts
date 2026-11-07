// @vitest-environment node
import { describe, expect, it } from "vitest";
import { corpoDoLote, ehDoWhatsapp, eventoParaMeta, sha256 } from "./payload.ts";

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

describe("LeadConfirmado (0322)", () => {
  const confirmado = { ...base, event_name: "LeadConfirmado" };

  it("as etapas antigas não ganham event_id: o payload delas não muda", async () => {
    const evento = await eventoParaMeta(base);
    expect(evento).not.toHaveProperty("event_id");
    expect(Object.keys(evento ?? {})).toEqual(["event_name", "event_time", "action_source", "user_data", "custom_data"]);
  });

  it("lead do formulário: evento de CRM com event_id da fila", async () => {
    const evento = await eventoParaMeta(confirmado);
    expect(evento).toMatchObject({
      event_name: "LeadConfirmado",
      event_id: "e1",
      action_source: "system_generated",
      user_data: { lead_id: "1234567890123456789" },
    });
  });

  it("lead do clique-para-WhatsApp: business_messaging com ctwa_clid e a conta", async () => {
    const wa = { ...confirmado, leadgen_id: null, email: null, ctwa_clid: " ARAkLkA8rmlFeiCktEJQ " };
    expect(ehDoWhatsapp(wa)).toBe(true);
    const evento = await eventoParaMeta(wa, { wabaId: "102290129340398" });
    expect(evento).toEqual({
      event_name: "LeadConfirmado",
      event_time: Date.UTC(2026, 9, 17, 12) / 1000,
      event_id: "e1",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: {
        whatsapp_business_account_id: "102290129340398",
        ctwa_clid: "ARAkLkA8rmlFeiCktEJQ",
        ph: [await sha256("5551999998888")],
      },
    });
  });

  it("WhatsApp sem a conta cadastrada espera; etapa antiga do WhatsApp nunca sai", async () => {
    const wa = { ...confirmado, leadgen_id: null, ctwa_clid: "ARAk" };
    expect(await eventoParaMeta(wa)).toBeNull();
    expect(ehDoWhatsapp({ ...wa, event_name: "Lead atendido" })).toBe(false);
    expect(await eventoParaMeta({ ...wa, event_name: "Lead atendido" }, { wabaId: "1" })).toBeNull();
  });

  it("test_event_code só entra quando pedido", () => {
    expect(corpoDoLote([], "tok")).not.toContain("test_event_code");
    expect(corpoDoLote([], "tok", "TEST123")).toContain('"test_event_code":"TEST123"');
  });
});
