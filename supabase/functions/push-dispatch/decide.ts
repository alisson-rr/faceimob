/**
 * Regras de desfecho da `push-dispatch`, separadas do `Deno.serve` para o vitest
 * testar sem rede nem banco.
 *
 * A distinção que importa: falha do APARELHO (a assinatura nunca vai funcionar)
 * contra falha PASSAGEIRA do serviço de push (429, 5xx, timeout). Contar a
 * segunda como a primeira apagava, num pico de 1 a 2 minutos do FCM, o aparelho
 * de quem tinha aviso pendente — e ele só voltava quando a pessoa reabrisse o app.
 */

export type Outcome = "ok" | "gone" | "rejected" | "transient";

export const MAX_FAILURES = 10;

/** Status HTTP do serviço de push (null = sem resposta) → o que ele diz do aparelho. */
export function outcomeOf(status: number | null): Outcome {
  if (status === null) return "transient";
  if (status >= 200 && status < 300) return "ok";
  // O navegador desistiu da assinatura.
  if (status === 404 || status === 410) return "gone";
  // Assinatura recusada: par VAPID trocado deixa toda assinatura antiga em 401/403
  // para sempre. Conta falha; em MAX_FAILURES a assinatura sai.
  if (status === 400 || status === 401 || status === 403) return "rejected";
  // 413, 429, 5xx e o resto: problema do serviço ou do aviso, não do aparelho.
  return "transient";
}

type SubscriptionChange =
  | "delete"
  | { last_success_at: string; failures: 0 }
  | { failures: number }
  | null;

/** O que gravar na assinatura depois de todos os envios dela neste lote. */
export function subscriptionChange(outcomes: Outcome[], failures: number, now: string): SubscriptionChange {
  if (outcomes.includes("gone")) return "delete";
  if (outcomes.includes("ok")) return { last_success_at: now, failures: 0 };
  if (!outcomes.includes("rejected")) return null;
  return failures + 1 >= MAX_FAILURES ? "delete" : { failures: failures + 1 };
}

export type Delivery = { subscriptionId: string; outcome: Outcome; detail: string };

type NotificationChange =
  | { push_sent_at: string; push_error: string | null }
  | { push_done_subs: string[]; push_error: string };

/**
 * O que gravar na notificação. `deliveries` null = carga acima do teto do
 * aes128gcm: o aviso não sai por push e nenhum aparelho é tocado.
 *
 * Com pendência, a reivindicação NÃO é solta: ela vence em 2 min e esse é o
 * intervalo entre tentativas — sem isso, qualquer insert de outra pessoa acordava
 * a edge e as 5 tentativas acabavam em segundos. `push_done_subs` guarda quem já
 * foi tratado, e a nova tentativa não repete o aviso no aparelho que já mostrou.
 */
export function notificationChange(input: {
  doneSubs: string[];
  deliveries: Delivery[] | null;
  attempt: number;
  now: string;
}): NotificationChange {
  if (input.deliveries === null) {
    return { push_sent_at: input.now, push_error: "carga acima do limite do push: o aviso ficou só no sino" };
  }
  const pending = input.deliveries.filter((d) => d.outcome === "rejected" || d.outcome === "transient");
  if (pending.length === 0) return { push_sent_at: input.now, push_error: null };
  const handled = input.deliveries.filter((d) => d.outcome === "ok" || d.outcome === "gone");
  return {
    push_done_subs: [...new Set([...input.doneSubs, ...handled.map((d) => d.subscriptionId)])],
    push_error: `tentativa ${input.attempt}: ${pending.map((d) => d.detail).join("; ")}`.slice(0, 500),
  };
}
