import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { sendEmail, senderEmailProblem } from "../_shared/brevo.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { montarEmailDeMovimento, type CcaMoveEmail } from "./email.ts";

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
 * Entrega a fila `cca_move_emails` (0155) pela Brevo: o e-mail de movimento da
 * CCA para o corretor e o gerente do negócio.
 *
 * Worker próprio, e não mais um laço no `submission-dispatch`: aquele envia o
 * dossiê à construtora, que já funciona e anexa documento de cliente. Ligar,
 * desligar ou republicar o e-mail de movimento não toca nesse caminho.
 *
 * Mesmas regras da fila de dossiês: só o pg_cron chama (chave de serviço);
 * `sending` antes de tentar e repesca depois de 10 min; `attempts` conta falha;
 * credencial ausente não gasta tentativa. O corte de 24 h fica no banco
 * (`dispatch_pending_cca_emails`), para valer com este worker fora do ar.
 *
 * Log só com o id da linha: endereço e mensagem são dado pessoal.
 */
const BATCH_LIMIT = 50;

/** Mesmo teto e mesma repesca de `dispatch_pending_cca_emails` (0155). */
const MAX_ATTEMPTS = 5;
const STUCK_AFTER_MS = 10 * 60 * 1000;

type Linha = CcaMoveEmail & {
  id: string;
  to_email: string;
  attempts: number;
  status: string;
  updated_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const denied = await requireServiceRole(req, corsHeaders);
    if (denied) return denied;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const staleBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data, error } = await supabase
      .from("cca_move_emails")
      .select("id,to_email,deal_code,client_name,stage_name,actor_name,message,attempts,status,updated_at")
      .or(`status.eq.queued,and(status.in.(failed,sending),updated_at.lt.${staleBefore})`)
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const pending = (data ?? []) as Linha[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, failed: 0 });

    // Mesmo portão do `submission-dispatch`: sem credencial utilizável a linha
    // ganha o motivo e NÃO gasta tentativa — a mensagem nem foi tentada.
    const apiKey = await getSecret("BREVO_API_KEY");
    const senderEmail = await getSecret("BREVO_SENDER_EMAIL");
    const problema = !apiKey
      ? "chave da Brevo ausente no cofre (brevo/api_key). Cadastre em Admin → Integrações."
      : senderEmailProblem(senderEmail);
    if (problema) {
      const { error: markError } = await supabase
        .from("cca_move_emails")
        .update({ status: "failed", last_error: problema })
        .in("id", pending.map((r) => r.id));
      if (markError) console.error("cca-email-dispatch: falha ao marcar a fila bloqueada —", markError.message);
      console.error(`cca-email-dispatch: ${problema}; ${pending.length} e-mails aguardando`);
      return json({ error: problema, pending: pending.length, processed: 0, sent: 0, failed: 0 }, 503);
    }

    const remetente = (senderEmail ?? "").trim();
    // Endereço público do app, para o link do e-mail. Sem ele o e-mail sai sem
    // link, dizendo onde procurar o negócio.
    const appUrl = Deno.env.get("APP_URL") ?? null;

    let sent = 0, failed = 0;
    for (const row of pending) {
      // Reserva condicional: só marca `sending` se a linha ainda é a que foi
      // lida (mesmo status e mesmo `updated_at`, que o gatilho renova a cada
      // update). O cron chama de minuto em minuto; uma passada lenta (Brevo
      // devagar) cruzava com a seguinte e as duas mandavam o mesmo e-mail.
      const { data: reservada, error: reservaError } = await supabase
        .from("cca_move_emails")
        .update({ status: "sending" })
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (reservaError) throw reservaError;
      if (!reservada?.length) continue;

      try {
        const { subject, html } = montarEmailDeMovimento(row, appUrl);
        const result = await sendEmail({ to: row.to_email, subject, html, senderEmail: remetente });
        if (!result.ok) throw new Error(result.error);

        await supabase
          .from("cca_move_emails")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
        sent++;
      } catch (e) {
        // `sendEmail` devolve só status e código da Brevo, nunca o destinatário.
        const message = e instanceof Error ? e.message : "erro desconhecido";
        await supabase
          .from("cca_move_emails")
          .update({ status: "failed", last_error: message.slice(0, 500), attempts: row.attempts + 1 })
          .eq("id", row.id);
        console.error(`cca-email-dispatch: falha no envio ${row.id}`);
        failed++;
      }
    }

    return json({ processed: sent + failed, sent, failed });
  } catch (error) {
    console.error("cca-email-dispatch error:", error instanceof Error ? error.message : "unknown");
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
