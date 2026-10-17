/**
 * Monta o lote da API de Conversões para CRM (0288). Sem dependência de rede
 * nem de Deno: o teste roda no vitest.
 *
 * A Meta casa o evento com o anúncio pelo `lead_id` (o `leadgen_id` do Lead
 * Ads). Telefone e e-mail vão só como hash SHA-256, normalizados como a Meta
 * pede (e-mail em minúsculas e sem espaço; telefone só dígitos com DDI) — nunca
 * em texto puro.
 */

export type EventoDaFila = {
  id: string;
  event_name: string;
  event_time: string;
  leadgen_id: string | null;
  /** Já normalizado com DDI (`normalizePhone`), ou null. */
  phone: string | null;
  email: string | null;
};

export type EventoMeta = {
  event_name: string;
  event_time: number;
  action_source: "system_generated";
  /** `lead_id` fica em texto aqui: `corpoDoLote` o escreve como número. */
  user_data: { lead_id: string; ph?: string[]; em?: string[] };
  custom_data: { event_source: "crm"; lead_event_source: string };
};

export const ORIGEM_DO_LEAD = "Faceimob CRM";

export async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `null` quando o evento não tem como ser casado (sem `leadgen_id` numérico). */
export async function eventoParaMeta(e: EventoDaFila): Promise<EventoMeta | null> {
  if (!e.leadgen_id || !/^[0-9]{6,}$/.test(e.leadgen_id)) return null;
  const email = e.email?.trim().toLowerCase();
  const fone = e.phone?.replace(/\D/g, "");
  const user_data: EventoMeta["user_data"] = { lead_id: e.leadgen_id };
  if (fone) user_data.ph = [await sha256(fone)];
  if (email) user_data.em = [await sha256(email)];
  return {
    event_name: e.event_name,
    event_time: Math.floor(Date.parse(e.event_time) / 1000),
    action_source: "system_generated",
    user_data,
    custom_data: { event_source: "crm", lead_event_source: ORIGEM_DO_LEAD },
  };
}

/**
 * Corpo JSON do POST. O `leadgen_id` tem 15 a 17 dígitos e passa do inteiro
 * seguro do JavaScript: `Number()` arredondaria o id e a Meta não acharia o
 * lead. Ele vai como texto até aqui e é escrito como número no JSON final.
 */
export function corpoDoLote(eventos: EventoMeta[], token: string): string {
  return JSON.stringify({ data: eventos, access_token: token })
    .replace(/"lead_id":"([0-9]+)"/g, '"lead_id":$1');
}
