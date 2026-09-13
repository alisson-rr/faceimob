// @vitest-environment node
// O jsdom não implementa `crypto.subtle`; a edge function roda com a WebCrypto
// nativa, que é a mesma do Node.
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildPushRequest,
  deliveryOptions,
  deriveContentKeys,
  encryptPayload,
  importPrivateKey,
  pushPayload,
  vapidAuthorization,
} from "./webpush.ts";

/** RFC 8291, seção 5 e Apêndice A (espaços de quebra de linha removidos). */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const b = base64UrlDecode;

/** Lado do aparelho: decifra o corpo como o navegador faria. */
async function decryptLikeBrowser(body: Uint8Array, uaPublic: Uint8Array, uaPrivate: CryptoKey, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const { cek, nonce } = await deriveContentKeys({ ecdhSecret, authSecret, uaPublic, asPublic, salt });
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, body.slice(21 + idLength)));
  return { recordSize, idLength, delimiter: padded[padded.length - 1], text: new TextDecoder().decode(padded.slice(0, -1)) };
}

async function novoAparelho() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { pair, publicKey, authSecret, p256dh: base64UrlEncode(publicKey), auth: base64UrlEncode(authSecret) };
}

async function novoParVapid() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d as string, publicRaw };
}

describe("cifragem aes128gcm — vetor da RFC 8291", () => {
  it("deriva CEK e NONCE do Apêndice A", async () => {
    const { cek, nonce } = await deriveContentKeys({
      ecdhSecret: b(RFC.ecdhSecret),
      authSecret: b(RFC.authSecret),
      uaPublic: b(RFC.uaPublic),
      asPublic: b(RFC.asPublic),
      salt: b(RFC.salt),
    });
    expect(base64UrlEncode(cek)).toBe(RFC.cek);
    expect(base64UrlEncode(nonce)).toBe(RFC.nonce);
  });

  it("produz o corpo da seção 5 byte a byte (cabeçalho de 86 bytes + registro)", async () => {
    const asPublic = b(RFC.asPublic);
    const body = await encryptPayload({
      plaintext: new TextEncoder().encode(RFC.plaintext),
      uaPublic: b(RFC.uaPublic),
      authSecret: b(RFC.authSecret),
      salt: b(RFC.salt),
      asKeys: { publicKey: asPublic, privateKey: await importPrivateKey(asPublic, b(RFC.asPrivate), "ECDH") },
    });

    // A seção 5 da RFC diz `Content-Length: 145`, mas o próprio corpo que ela
    // mostra tem 192 caracteres base64url = 144 bytes (86 + 58). O byte a byte
    // abaixo é contra o corpo, não contra o cabeçalho HTTP do exemplo.
    expect(body.length).toBe(144);
    expect(Array.from(body.slice(0, 86))).toEqual(Array.from(b(RFC.header)));
    expect(Array.from(body.slice(86))).toEqual(Array.from(b(RFC.ciphertext)));
    expect(base64UrlEncode(body)).toBe(RFC.body);
  });

  it("o aparelho da RFC decifra o que foi cifrado com sal e chave aleatórios", async () => {
    const uaPublic = b(RFC.uaPublic);
    const uaPrivate = await importPrivateKey(uaPublic, b(RFC.uaPrivate), "ECDH");
    const body = await encryptPayload({
      plaintext: new TextEncoder().encode("Novo lead: Marta"),
      uaPublic,
      authSecret: b(RFC.authSecret),
    });

    const aberto = await decryptLikeBrowser(body, uaPublic, uaPrivate, b(RFC.authSecret));
    expect(aberto).toEqual({ recordSize: 4096, idLength: 65, delimiter: 2, text: "Novo lead: Marta" });
    expect(base64UrlEncode(body.slice(0, 16))).not.toBe(RFC.salt);
  });

  it("recusa chave de aparelho fora do formato e ponto fora da curva", async () => {
    const plaintext = new TextEncoder().encode("x");
    await expect(encryptPayload({ plaintext, uaPublic: b(RFC.uaPublic).slice(1), authSecret: b(RFC.authSecret) }))
      .rejects.toThrow(/65 bytes/);
    await expect(encryptPayload({ plaintext, uaPublic: b(RFC.uaPublic), authSecret: b(RFC.authSecret).slice(1) }))
      .rejects.toThrow(/16 bytes/);
    const foraDaCurva = b(RFC.uaPublic);
    foraDaCurva[64] ^= 0x01;
    await expect(encryptPayload({ plaintext, uaPublic: foraDaCurva, authSecret: b(RFC.authSecret) })).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("JWT ES256 verificável com a chave pública, aud = origem do endpoint e exp de até 12 h", async () => {
    const vapid = await novoParVapid();
    const agora = 1_788_000_000;
    const header = await vapidAuthorization({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc:def?x=1",
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      subject: "mailto:ti@faceimob.test",
      nowSeconds: agora,
    });

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, p, s, k] = match as RegExpExecArray;
    expect(k).toBe(vapid.publicKey);

    const decode = (part: string) => JSON.parse(new TextDecoder().decode(b(part)));
    expect(decode(h)).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = decode(p);
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:ti@faceimob.test");
    expect(claims.exp).toBeGreaterThan(agora);
    expect(claims.exp - agora).toBeLessThanOrEqual(12 * 60 * 60);

    const verifyKey = await crypto.subtle.importKey("raw", vapid.publicRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const assinatura = b(s);
    expect(assinatura.length).toBe(64);
    const valido = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      assinatura,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(valido).toBe(true);
  });

  it("recusa subject sem mailto:/https:// e chave privada de tamanho errado", async () => {
    const vapid = await novoParVapid();
    const base = { endpoint: "https://web.push.apple.com/abc", publicKey: vapid.publicKey, privateKey: vapid.privateKey };
    await expect(vapidAuthorization({ ...base, subject: "ti@faceimob.test" })).rejects.toThrow(/mailto/);
    await expect(vapidAuthorization({ ...base, privateKey: vapid.privateKey.slice(0, 40), subject: "mailto:a@b.c" }))
      .rejects.toThrow(/32 bytes/);
    await expect(vapidAuthorization({ ...base, privateKey: `${vapid.privateKey}=`, subject: "mailto:a@b.c" }))
      .rejects.toThrow(/base64url/);
  });
});

describe("requisição de push", () => {
  const linha = {
    id: "8f0c3a52-0000-4000-8000-000000000143",
    kind: "lead_assigned",
    category: "lead_recebido",
    title: "Novo lead: Marta",
    body: "Você tem até 14:05 para iniciar o atendimento.",
    link: "/leads?lead=8f0c3a52-0000-4000-8000-000000000001",
    created_at: "2026-09-12T21:00:00.000Z",
  };

  it("monta cabeçalhos do contrato e corpo que o aparelho decifra", async () => {
    const aparelho = await novoAparelho();
    const vapid = await novoParVapid();
    const req = await buildPushRequest({
      subscription: { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAA", p256dh: aparelho.p256dh, auth: aparelho.auth },
      payload: pushPayload(linha),
      category: linha.category,
      vapid: { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:ti@faceimob.test" },
    });

    expect(req.url).toBe("https://updates.push.services.mozilla.com/wpush/v2/gAAA");
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers["Content-Type"]).toBe("application/octet-stream");
    expect(req.headers.TTL).toBe("600");
    expect(req.headers.Urgency).toBe("high");
    expect(req.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));

    const aberto = await decryptLikeBrowser(req.body, aparelho.publicKey, aparelho.pair.privateKey, aparelho.authSecret);
    expect(JSON.parse(aberto.text)).toEqual(linha);
  });

  it("lead novo e prazo saem urgentes e curtos; o resto espera até 1 dia", () => {
    expect(deliveryOptions("lead_recebido")).toEqual({ ttl: 600, urgency: "high" });
    expect(deliveryOptions("lead_prazo")).toEqual({ ttl: 600, urgency: "high" });
    for (const categoria of ["lead_atividade", "credito", "outros"]) {
      expect(deliveryOptions(categoria)).toEqual({ ttl: 86_400, urgency: "normal" });
    }
  });

  it("carga tem só os campos do contrato e corta o corpo em 300 caracteres sem partir emoji", () => {
    const corpo = "🏠".repeat(350);
    const carga = JSON.parse(pushPayload({ ...linha, body: corpo }));
    expect(Object.keys(carga).sort()).toEqual(["body", "category", "created_at", "id", "kind", "link", "title"]);
    expect(Array.from(carga.body as string)).toHaveLength(300);
    expect(carga.body).toBe("🏠".repeat(300));
    expect(JSON.parse(pushPayload({ ...linha, body: null })).body).toBeNull();
  });
});
