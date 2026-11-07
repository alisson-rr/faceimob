/**
 * Monta o lote da API de Conversões para CRM (0288). Sem dependência de rede
 * nem de Deno: o teste roda no vitest.
 *
 * A Meta casa o evento com o anúncio pelo `lead_id` (o `leadgen_id` do Lead
 * Ads). Telefone e e-mail vão só como hash SHA-256, normalizados como a Meta
 * pede (e-mail em minúsculas e sem espaço; telefone só dígitos com DDI) — nunca
 * em texto puro.
 *
 * 0322: o `LeadConfirmado` (card em "Interesse confirmado") também sai para o
 * lead do anúncio clique-para-WhatsApp, casado pelo `ctwa_clid` com
 * `action_source: business_messaging`. As cinco etapas da 0288 seguem iguais.
 */

export type EventoDaFila = {
  id: string;
  event_name: string;
  event_time: string;
  leadgen_id: string | null;
  /** Já normalizado com DDI (`normalizePhone`), ou null. */
  phone: string | null;
  email: string | null;
  /** Clique do anúncio clique-para-WhatsApp (0254/0322), ou null. */
  ctwa_clid?: string | null;
};

type UserDataHash = { ph?: string[]; em?: string[] };

export type EventoCrm = {
  event_name: string;
  event_time: number;
  action_source: "system_generated";
  /** Só no `LeadConfirmado`: o id da fila, para a Meta deduplicar reenvio. */
  event_id?: string;
  /** `lead_id` fica em texto aqui: `corpoDoLote` o escreve como número. */
  user_data: { lead_id: string } & UserDataHash;
  custom_data: { event_source: "crm"; lead_event_source: string };
};

export type EventoWhatsapp = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "business_messaging";
  messaging_channel: "whatsapp";
  user_data: { whatsapp_business_account_id: string; ctwa_clid: string } & UserDataHash;
};

export type EventoMeta = EventoCrm | EventoWhatsapp;

export const ORIGEM_DO_LEAD = "Faceimob CRM";
export const LEAD_CONFIRMADO = "LeadConfirmado";

export async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashes(e: EventoDaFila): Promise<UserDataHash> {
  const email = e.email?.trim().toLowerCase();
  const fone = e.phone?.replace(/\D/g, "");
  const out: UserDataHash = {};
  if (fone) out.ph = [await sha256(fone)];
  if (email) out.em = [await sha256(email)];
  return out;
}

const temLeadgen = (e: EventoDaFila) => !!e.leadgen_id && /^[0-9]{6,}$/.test(e.leadgen_id);

/** O evento é do clique-para-WhatsApp (sem Lead Ads, com `ctwa_clid`). */
export const ehDoWhatsapp = (e: EventoDaFila) =>
  e.event_name === LEAD_CONFIRMADO && !temLeadgen(e) && !!e.ctwa_clid?.trim();

/**
 * `null` quando o evento não tem como ser casado: sem `leadgen_id` numérico e,
 * no `LeadConfirmado`, também sem `ctwa_clid` (ou sem o id da conta do
 * WhatsApp Business configurado).
 */
export async function eventoParaMeta(
  e: EventoDaFila,
  opts: { wabaId?: string | null } = {},
): Promise<EventoMeta | null> {
  const event_time = Math.floor(Date.parse(e.event_time) / 1000);
  if (temLeadgen(e)) {
    const evento: EventoCrm = {
      event_name: e.event_name,
      event_time,
      action_source: "system_generated",
      user_data: { lead_id: e.leadgen_id as string, ...(await hashes(e)) },
      custom_data: { event_source: "crm", lead_event_source: ORIGEM_DO_LEAD },
    };
    if (e.event_name === LEAD_CONFIRMADO) evento.event_id = e.id;
    return evento;
  }
  if (ehDoWhatsapp(e) && opts.wabaId && /^[0-9]+$/.test(opts.wabaId)) {
    return {
      event_name: e.event_name,
      event_time,
      event_id: e.id,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: {
        whatsapp_business_account_id: opts.wabaId,
        ctwa_clid: (e.ctwa_clid as string).trim(),
        ...(await hashes(e)),
      },
    };
  }
  return null;
}

/**
 * Corpo JSON do POST. O `leadgen_id` tem 15 a 17 dígitos e passa do inteiro
 * seguro do JavaScript: `Number()` arredondaria o id e a Meta não acharia o
 * lead. Ele vai como texto até aqui e é escrito como número no JSON final.
 *
 * `testEventCode` só para o teste manual (`scripts/meta-capi-teste.ts`): o
 * envio do pg_cron nunca passa esse campo.
 */
export function corpoDoLote(eventos: EventoMeta[], token: string, testEventCode?: string): string {
  return JSON.stringify({ data: eventos, access_token: token, ...(testEventCode ? { test_event_code: testEventCode } : {}) })
    .replace(/"lead_id":"([0-9]+)"/g, '"lead_id":$1');
}
