import { getSecret, requireSecret } from "./secrets.ts";

/**
 * Utilidades da plataforma Meta compartilhadas pelos webhooks e workers:
 * verificação de assinatura e envio pela WhatsApp Cloud API.
 *
 * A assinatura (X-Hub-Signature-256) é HMAC-SHA256 do corpo bruto com o app
 * secret. Enquanto o admin não cadastrar `META_APP_SECRET` em Integrações, a
 * verificação fica em "modo de transição": aceita e registra o aviso — o
 * ambiente de homologação ainda não tem credencial nenhuma da Meta. Assim que
 * o segredo existir, requisição sem assinatura válida é recusada.
 */

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export type SignatureCheck = "valid" | "invalid" | "unconfigured";

export async function checkMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<SignatureCheck> {
  const appSecret = await getSecret("META_APP_SECRET");
  if (!appSecret) return "unconfigured";

  const provided = (signatureHeader || "").replace(/^sha256=/, "").toLowerCase();
  if (!provided) return "invalid";

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));

  // Comparação em tempo constante: não vaza prefixo correto pelo tempo.
  if (provided.length !== expected.length) return "invalid";
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? "valid" : "invalid";
}

/** Mesma normalização do `normalize_phone` do banco: dígitos com DDI 55. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function whatsAppCreds() {
  return {
    token: await requireSecret("META_WHATSAPP_ACCESS_TOKEN"),
    phoneId: await requireSecret("META_WHATSAPP_PHONE_NUMBER_ID"),
  };
}

export async function sendWhatsAppText(to: string, text: string) {
  const { token, phoneId } = await whatsAppCreds();
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[],
) {
  const { token, phoneId } = await whatsAppCreds();
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(bodyParams.length
        ? {
            components: [{
              type: "body",
              parameters: bodyParams.map((p) => ({ type: "text", text: p })),
            }],
          }
        : {}),
    },
  };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
