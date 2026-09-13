/**
 * Web Push do lado do servidor: assinatura VAPID (RFC 8292) e cifragem do
 * conteúdo em `aes128gcm` (RFC 8291 sobre a RFC 8188).
 *
 * Só WebCrypto (`globalThis.crypto.subtle`), sem import de Deno nem de npm. O
 * mesmo arquivo carrega na edge function (Deno) e no vitest (Node), e é isso que
 * permite conferir a cifragem byte a byte contra o vetor da RFC 8291 antes de
 * qualquer aparelho real receber um aviso. A biblioteca `web-push` do npm não
 * serve aqui: ela depende do módulo `crypto` do Node.
 *
 * Função pura de bytes. Quem recebe, quando tentar de novo e o que fazer com
 * 404/410 é decisão da `push-dispatch`.
 */

const encoder = new TextEncoder();

/** Um registro só por mensagem (RFC 8291 §4), anunciado com este tamanho. */
const RECORD_SIZE = 4096;
/** 4096 − 86 de cabeçalho − 16 da tag do GCM − 1 do delimitador (RFC 8291 §4). */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 86 - 16 - 1;
const PADDING_DELIMITER = new Uint8Array([0x02]);
const ONE = new Uint8Array([0x01]);

/** A RFC 8292 aceita até 24 h. 12 h deixa folga para relógio adiantado do lado do serviço de push. */
const VAPID_MAX_SECONDS = 12 * 60 * 60;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  // Resto 1 não existe em base64: sem esta checagem o `atob` falha com
  // "Invalid character", que não diz qual valor do cofre está errado.
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error("valor não é base64url sem padding");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data));
}

function assertUncompressedPoint(bytes: Uint8Array, what: string): void {
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(`${what}: esperado ponto P-256 não comprimido (65 bytes começando em 0x04)`);
  }
}

/**
 * Chave privada P-256 a partir do par bruto (ponto de 65 bytes + escalar de 32).
 * O cofre guarda os dois separados; a WebCrypto só importa privada EC por JWK.
 */
export async function importPrivateKey(
  publicKey: Uint8Array,
  privateKey: Uint8Array,
  algorithm: "ECDH" | "ECDSA",
): Promise<CryptoKey> {
  assertUncompressedPoint(publicKey, "chave pública");
  if (privateKey.length !== 32) throw new Error("chave privada: esperado escalar de 32 bytes");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(publicKey.slice(1, 33)),
      y: base64UrlEncode(publicKey.slice(33, 65)),
      d: base64UrlEncode(privateKey),
      ext: true,
    },
    { name: algorithm, namedCurve: "P-256" },
    false,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

/** CEK e NONCE da RFC 8291 §3.4 — o mesmo cálculo serve para cifrar e decifrar. */
export async function deriveContentKeys(input: {
  ecdhSecret: Uint8Array;
  authSecret: Uint8Array;
  uaPublic: Uint8Array;
  asPublic: Uint8Array;
  salt: Uint8Array;
}): Promise<{ cek: Uint8Array; nonce: Uint8Array }> {
  const prkKey = await hmacSha256(input.authSecret, input.ecdhSecret);
  const keyInfo = concat(encoder.encode("WebPush: info\0"), input.uaPublic, input.asPublic);
  const ikm = await hmacSha256(prkKey, concat(keyInfo, ONE));
  const prk = await hmacSha256(input.salt, ikm);
  const cek = (await hmacSha256(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), ONE))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concat(encoder.encode("Content-Encoding: nonce\0"), ONE))).slice(0, 12);
  return { cek, nonce };
}

/**
 * Corpo `aes128gcm` pronto para o POST: cabeçalho (sal, rs, keyid = chave pública
 * do servidor) seguido do único registro cifrado.
 *
 * `salt` e `asKeys` existem só para o teste reproduzir o vetor da RFC: em
 * produção os dois são novos a cada mensagem, e reaproveitá-los quebraria a
 * confidencialidade.
 */
export async function encryptPayload(input: {
  plaintext: Uint8Array;
  uaPublic: Uint8Array;
  authSecret: Uint8Array;
  salt?: Uint8Array;
  asKeys?: { publicKey: Uint8Array; privateKey: CryptoKey };
}): Promise<Uint8Array> {
  assertUncompressedPoint(input.uaPublic, "p256dh");
  if (input.authSecret.length !== 16) throw new Error("auth: esperado segredo de 16 bytes");
  if (input.plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`conteúdo acima de ${MAX_PLAINTEXT_BYTES} bytes`);
  }

  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("sal: esperado 16 bytes");

  let asKeys = input.asKeys;
  if (!asKeys) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asKeys = {
      publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      privateKey: pair.privateKey,
    };
  }

  // A importação confere que o ponto do aparelho está na curva: a RFC 8291 §7
  // exige, porque ponto inválido permite extrair a chave privada do servidor.
  const uaKey = await crypto.subtle.importKey("raw", input.uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );
  const { cek, nonce } = await deriveContentKeys({
    ecdhSecret,
    authSecret: input.authSecret,
    uaPublic: input.uaPublic,
    asPublic: asKeys.publicKey,
    salt,
  });

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      concat(input.plaintext, PADDING_DELIMITER),
    ),
  );

  const header = new Uint8Array(21 + asKeys.publicKey.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asKeys.publicKey.length;
  header.set(asKeys.publicKey, 21);
  return concat(header, ciphertext);
}

/**
 * Valor do header `Authorization` do VAPID: `vapid t=<jwt>, k=<chave pública>`.
 *
 * `aud` é a ORIGEM do endpoint (o serviço de push recusa o caminho completo) e a
 * chave pública vai no `k=` exatamente como o aparelho a recebeu em
 * `applicationServerKey` — se não bater, o serviço responde 401/403.
 */
export async function vapidAuthorization(input: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  nowSeconds?: number;
}): Promise<string> {
  if (!/^(mailto:|https:\/\/)/.test(input.subject)) {
    throw new Error("vapid_subject precisa começar com mailto: ou https://");
  }
  const signingKey = await importPrivateKey(
    base64UrlDecode(input.publicKey),
    base64UrlDecode(input.privateKey),
    "ECDSA",
  );
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const json64 = (value: unknown) => base64UrlEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${json64({ typ: "JWT", alg: "ES256" })}.${
    json64({ aud: new URL(input.endpoint).origin, exp: now + VAPID_MAX_SECONDS, sub: input.subject })
  }`;
  // A WebCrypto já devolve a assinatura ECDSA como r||s de 64 bytes, que é o
  // formato do JWS ES256 — sem conversão de DER.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${input.publicKey}`;
}

/**
 * Prazo e prioridade por categoria (as mesmas de `public.push_category`).
 * Aviso de lead novo ou de prazo vale enquanto dá para atender: passado de
 * 10 min o serviço de push descarta em vez de acordar o aparelho com fato velho.
 */
export function deliveryOptions(category: string): { ttl: number; urgency: "high" | "normal" } {
  return category === "lead_recebido" || category === "lead_prazo"
    ? { ttl: 600, urgency: "high" }
    : { ttl: 86_400, urgency: "normal" };
}

export type PushRow = {
  id: string;
  kind: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
};

/** Corta por ponto de código: `slice` de string partiria um emoji ao meio. */
const cut = (text: string, max: number) => Array.from(text).slice(0, max).join("");

/**
 * Carga que o service worker recebe. Corpo em 300 caracteres (contrato) e título
 * em 200: juntos, mesmo em UTF-8 de 4 bytes, ficam longe do teto de 3993 bytes.
 */
export function pushPayload(row: PushRow): string {
  return JSON.stringify({
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: cut(row.title, 200),
    body: row.body === null ? null : cut(row.body, 300),
    link: row.link,
    created_at: row.created_at,
  });
}

/** POST completo para um aparelho: URL, cabeçalhos e corpo cifrado. */
export async function buildPushRequest(input: {
  subscription: { endpoint: string; p256dh: string; auth: string };
  payload: string;
  category: string;
  vapid: { publicKey: string; privateKey: string; subject: string };
  nowSeconds?: number;
}): Promise<{ url: string; headers: Record<string, string>; body: Uint8Array }> {
  const { ttl, urgency } = deliveryOptions(input.category);
  const body = await encryptPayload({
    plaintext: encoder.encode(input.payload),
    uaPublic: base64UrlDecode(input.subscription.p256dh),
    authSecret: base64UrlDecode(input.subscription.auth),
  });
  const authorization = await vapidAuthorization({
    endpoint: input.subscription.endpoint,
    ...input.vapid,
    nowSeconds: input.nowSeconds,
  });
  return {
    url: input.subscription.endpoint,
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  };
}
