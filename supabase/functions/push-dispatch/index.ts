import { getSecret } from "../_shared/secrets.ts";
import { requireServiceRole, serviceClient } from "../_shared/auth.ts";
import { base64UrlEncode, buildPushRequest, MAX_PLAINTEXT_BYTES, pushPayload, vapidAuthorization } from "../_shared/webpush.ts";
import { type Delivery, notificationChange, type Outcome, outcomeOf, subscriptionChange } from "./decide.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Entrega por push do navegador as notificações do sino (migration 0143).
 *
 * O push viaja na linha `in_app`: não existe fila própria. Quem acorda este
 * worker é o gatilho de `notifications` (na hora do insert) e o cron
 * `faceimob-push-dispatch` (a cada minuto, para a nova tentativa). Os dois só
 * chamam quando há pendência de quem tem aparelho e categoria ligada.
 *
 * Quem escolhe O QUE sai é `claim_push_batch()`, no banco: recorta pendência
 * (15 min, 5 tentativas, preferência) e reivindica o lote com `push_claimed_at`,
 * de modo que o gatilho e o cron chamando juntos não mandam o mesmo aviso duas
 * vezes. Aqui só se entrega e se registra o resultado; o que cada status HTTP
 * significa para o aparelho e para o aviso está em `decide.ts`.
 *
 * `push_error` leva status e host — nunca o caminho do endpoint, que é a
 * credencial do aparelho.
 */
const BATCH_LIMIT = 50;
/** Contato do VAPID (RFC 8292): a URL pública do app, sem e-mail pessoal. */
const VAPID_SUBJECT = "https://faceimob.vercel.app";
const SEND_TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

type Pending = {
  id: string;
  profile_id: string;
  kind: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  push_attempts: number;
  push_done_subs: string[] | null;
};

type Subscription = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
};

type Vapid = { publicKey: string; privateKey: string; subject: string };

async function deliver(row: Pending, payload: string, sub: Subscription, vapid: Vapid): Promise<Delivery> {
  const host = new URL(sub.endpoint).host;
  let request: Awaited<ReturnType<typeof buildPushRequest>>;
  try {
    request = await buildPushRequest({ subscription: sub, payload, category: row.category, vapid });
  } catch {
    // Par VAPID e tamanho da carga já foram conferidos antes: o que falha aqui é
    // a chave do aparelho (tamanho ou ponto fora da curva), e ela nunca vai funcionar.
    return { subscriptionId: sub.id, outcome: "gone", detail: `chave do aparelho inválida em ${host}` };
  }

  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // O corpo da resposta do serviço de push não é lido nem logado.
    await res.body?.cancel();
    return { subscriptionId: sub.id, outcome: outcomeOf(res.status), detail: `HTTP ${res.status} em ${host}` };
  } catch {
    return { subscriptionId: sub.id, outcome: outcomeOf(null), detail: `sem resposta de ${host}` };
  }
}

/**
 * Gera o par VAPID aqui dentro e grava pela `webpush_guardar_vapid` (0145), que
 * nunca sobrescreve: a chave privada não sai do servidor nem aparece para
 * ninguém. Devolve só a pública. Chamado uma vez pela sessão de implantação via
 * pg_net com a service role do cofre.
 */
async function garantirVapid(): Promise<{ criado: boolean; publicKey: string | null }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!d) throw new Error("WebCrypto não exportou o escalar da chave privada");

  const supabase = serviceClient();
  const { data: criado, error } = await supabase.rpc("webpush_guardar_vapid", {
    p_public: publicKey,
    p_private: d,
    p_subject: VAPID_SUBJECT,
  });
  if (error) throw error;
  if (criado) return { criado: true, publicKey };
  // Já existia: a pública vigente é a do cofre, não a que acabou de ser descartada.
  return { criado: false, publicKey: await getSecret("WEBPUSH_VAPID_PUBLIC_KEY") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Worker: o único chamador legítimo é o banco (gatilho e pg_cron via pg_net),
    // que manda a chave de serviço do cofre.
    const denied = await requireServiceRole(req, corsHeaders);
    if (denied) return denied;

    // Gatilho e cron mandam `{}`; só a geração do par manda uma ação.
    const body = await req.json().catch(() => ({})) as { acao?: unknown };
    if (body.acao === "garantir_vapid") return json(await garantirVapid());

    const [publicKey, privateKey, subject] = await Promise.all([
      getSecret("WEBPUSH_VAPID_PUBLIC_KEY"),
      getSecret("WEBPUSH_VAPID_PRIVATE_KEY"),
      getSecret("WEBPUSH_VAPID_SUBJECT"),
    ]);
    if (!publicKey || !privateKey || !subject) {
      console.error("push-dispatch: par VAPID ausente no cofre (webpush/vapid_*)");
      return json({ error: "Credencial de push ausente: cadastre webpush/vapid_public_key, vapid_private_key e vapid_subject em Admin → Integrações." }, 503);
    }
    const vapid: Vapid = { publicKey: publicKey.trim(), privateKey: privateKey.trim(), subject: subject.trim() };

    // Valida o par ANTES de reivindicar: com a chave do cofre errada, cada
    // aparelho cairia em "chave inválida" e seria descartado junto.
    try {
      await vapidAuthorization({ endpoint: "https://fcm.googleapis.com/", ...vapid });
    } catch (error) {
      console.error("push-dispatch: par VAPID inválido —", error instanceof Error ? error.message : "erro");
      return json({ error: "Par VAPID inválido no cofre (base64url sem padding: pública de 65 bytes, privada de 32; subject mailto:)." }, 503);
    }

    const supabase = serviceClient();
    const { data, error } = await supabase.rpc("claim_push_batch", { p_limit: BATCH_LIMIT });
    if (error) throw error;
    const pending = (data ?? []) as Pending[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, gone: 0, failed: 0 });

    const { data: subsData, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id,profile_id,endpoint,p256dh,auth,failures")
      .in("profile_id", [...new Set(pending.map((row) => row.profile_id))]);
    // Sem soltar a reivindicação: ela vence em 2 min e o cron tenta de novo.
    if (subsError) throw subsError;
    const subs = (subsData ?? []) as Subscription[];

    const outcomesBySub = new Map<string, Outcome[]>();
    const results = await Promise.all(pending.map(async (row) => {
      const payload = pushPayload(row);
      const doneSubs = row.push_done_subs ?? [];
      // `link` e `kind` não têm teto na tabela: carga acima do limite do aes128gcm
      // é defeito do aviso, e não pode derrubar aparelho nenhum.
      if (encoder.encode(payload).length > MAX_PLAINTEXT_BYTES) return { row, doneSubs, deliveries: null };
      const targets = subs.filter((sub) => sub.profile_id === row.profile_id && !doneSubs.includes(sub.id));
      const deliveries = await Promise.all(targets.map(async (sub) => {
        const delivery = await deliver(row, payload, sub, vapid);
        outcomesBySub.set(sub.id, [...(outcomesBySub.get(sub.id) ?? []), delivery.outcome]);
        return delivery;
      }));
      return { row, doneSubs, deliveries };
    }));

    const now = new Date().toISOString();
    const logFailure = (what: string, err: { message: string } | null) => {
      if (err) console.error(`push-dispatch: falha ao gravar ${what} —`, err.message);
    };

    let gone = 0;
    await Promise.all(subs.map(async (sub) => {
      const outcomes = outcomesBySub.get(sub.id);
      if (!outcomes) return;
      const change = subscriptionChange(outcomes, sub.failures, now);
      if (change === null) return;
      if (change === "delete") {
        gone++;
        const { error: e } = await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        return logFailure("descarte de assinatura", e);
      }
      const { error: e } = await supabase.from("push_subscriptions").update(change).eq("id", sub.id);
      logFailure("resultado da assinatura", e);
    }));

    let sent = 0;
    let failed = 0;
    await Promise.all(results.map(async ({ row, doneSubs, deliveries }) => {
      const change = notificationChange({ doneSubs, deliveries, attempt: row.push_attempts, now });
      if ("push_sent_at" in change) {
        if (deliveries?.some((d) => d.outcome === "ok")) sent++;
      } else {
        failed++;
      }
      const { error: e } = await supabase.from("notifications").update(change).eq("id", row.id);
      logFailure("resultado do push", e);
    }));

    return json({ processed: pending.length, sent, gone, failed });
  } catch (error) {
    console.error("push-dispatch error:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
