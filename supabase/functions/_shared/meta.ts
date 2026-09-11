import { META_GRAPH } from "./metaAds.ts";
import { getSecret, requireSecret } from "./secrets.ts";

/**
 * Utilidades da plataforma Meta compartilhadas pelos webhooks e workers:
 * verificação de assinatura, envio pela WhatsApp Cloud API e download da mídia
 * que o lead manda. A versão da Graph vem de `metaGraph.ts`, num lugar só.
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

async function whatsAppCreds() {
  return {
    token: await requireSecret("META_WHATSAPP_ACCESS_TOKEN"),
    phoneId: await requireSecret("META_WHATSAPP_PHONE_NUMBER_ID"),
  };
}

/**
 * Com timeout: no webhook este envio fica entre o turno gravado e o fechamento
 * da reserva do áudio, e uma Graph pendurada deixava a edge morrer ali. O
 * estouro lança como qualquer falha de rede, e o chamador já trata.
 */
export async function sendWhatsAppText(to: string, text: string) {
  const { token, phoneId } = await whatsAppCreds();
  const res = await fetch(`${META_GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
    signal: AbortSignal.timeout(10_000),
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
  const res = await fetch(`${META_GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const emMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;

/**
 * Baixa uma mídia recebida pela Cloud API. `GET /{media-id}` devolve o link
 * temporário (vale 5 min; o id vale 7 dias) e o GET no link, com o MESMO Bearer
 * do WhatsApp, devolve o arquivo. O token vai só no header.
 *
 * `maxBytes` é o teto de custo: conferido no `file_size` antes de baixar e de
 * novo no que chega, porque o `file_size` pode faltar. Lança com a frase do
 * motivo (404, link expirado, arquivo acima do teto) e nunca com a URL.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  maxBytes: number,
): Promise<{ blob: Blob; mimeType: string }> {
  // O id vira caminho de URL: só o formato de id da Meta passa.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw new Error("Id de mídia do WhatsApp inválido.");
  const auth = { Authorization: `Bearer ${await requireSecret("META_WHATSAPP_ACCESS_TOKEN")}` };

  const info = await pedirMidia(`${META_GRAPH}/${mediaId}`, auth, 10_000);
  if (info.status === 404) throw new Error("A mídia não existe mais na Meta (o id do WhatsApp vale 7 dias).");
  const dados = (await info.json().catch(() => null)) as
    | { url?: unknown; mime_type?: unknown; file_size?: unknown }
    | null;
  if (!info.ok || !dados) throw new Error(`A Meta recusou a leitura da mídia (HTTP ${info.status}).`);
  const tamanho = Number(dados.file_size);
  if (tamanho > maxBytes) {
    throw new Error(`O arquivo tem ${emMb(tamanho)} e passa do teto de ${emMb(maxBytes)}.`);
  }
  if (typeof dados.url !== "string" || !dados.url.startsWith("https://")) {
    throw new Error("A Meta não devolveu o link da mídia.");
  }

  const arquivo = await pedirMidia(dados.url, auth, 20_000);
  if (!arquivo.ok || !arquivo.body) {
    throw new Error(
      [403, 404, 410].includes(arquivo.status)
        ? "O link da mídia expirou antes do download."
        : `A Meta recusou o download da mídia (HTTP ${arquivo.status}).`,
    );
  }

  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const parte of arquivo.body) {
      total += parte.byteLength;
      if (total > maxBytes) break;
      partes.push(parte);
    }
  } catch {
    throw new Error("O download da mídia foi interrompido (tempo esgotado ou falha de rede).");
  }
  if (total > maxBytes) throw new Error(`O arquivo passa do teto de ${emMb(maxBytes)}.`);

  const mimeType = typeof dados.mime_type === "string" && dados.mime_type
    ? dados.mime_type
    : arquivo.headers.get("content-type") ?? "application/octet-stream";
  return { blob: new Blob(partes, { type: mimeType }), mimeType };
}

/** fetch com timeout e erro sem URL: a mensagem crua do fetch traz o link. */
async function pedirMidia(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const expirou = (e as { name?: string } | null)?.name === "TimeoutError";
    throw new Error(
      expirou
        ? `A Meta não respondeu em ${timeoutMs / 1000} s ao baixar a mídia.`
        : "Não consegui falar com a Meta para baixar a mídia (falha de rede).",
    );
  }
}
