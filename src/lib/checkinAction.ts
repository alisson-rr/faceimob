import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";

export const CHECKIN_TIMEOUT_MS = 15000;

/** Cada tentativa tem seu próprio prazo; uma chamada presa não bloqueia as outras. */
export async function checkinDeadline<T>(request: (signal: AbortSignal) => PromiseLike<T>, message = "O servidor demorou para responder. Atualize sua presença e tente novamente."): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
      controller.abort();
    }, CHECKIN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request(controller.signal), expired]);
  } finally { clearTimeout(timer); }
}

export async function checkinAction(action: "checkin" | "checkout"): Promise<void> {
  const translations: Record<string, string> = { unauthorized: "Sua sessão expirou. Entre novamente.", unknown: "Não foi possível concluir a ação. Tente de novo." };
  await checkinDeadline(async (signal) => {
    const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action }, signal });
    const message = error ? await functionErrorMessage(error, "O servidor de check-in não respondeu. Tente de novo em instantes.") : data?.error;
    if (message) throw new Error(translations[String(message)] ?? String(message));
    if (data?.success !== true) throw new Error("Não foi possível confirmar a gravação. Atualize sua presença e tente novamente.");
  }, "O servidor demorou para confirmar. Confira sua presença antes de tentar novamente: o registro pode ter sido salvo.");
}
