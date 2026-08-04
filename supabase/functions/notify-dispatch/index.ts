import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSecret } from "../_shared/secrets.ts";

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
 * Entrega as notificações que pedem WhatsApp.
 *
 * Os gatilhos `notify_lead_assigned` e `notify_lead_timeout` já gravavam em
 * `notifications` com `channel = 'whatsapp'` desde a 0011 — e nada nunca leu
 * essa fila, então "avisar o corretor que perdeu o lead por prazo" (ata 14/07)
 * existia só como linha no banco.
 *
 * Idempotência por `sent_at`: só linhas com `sent_at is null` são processadas e
 * a marcação acontece por id. Reexecutar a função não remanda nada — o que
 * importa porque o agendador pode disparar duas vezes na virada.
 *
 * Falha de envio NÃO marca `sent_at`: fica na fila para a próxima passada. O
 * limite por execução evita que uma fila represada estoure o tempo da function.
 */
const BATCH_LIMIT = 50;

type PendingRow = {
  id: string;
  profile_id: string;
  title: string;
  body: string | null;
  profiles: { phone: string | null; full_name: string | null } | null;
};

async function sendWhatsAppText(token: string, phoneId: string, to: string, text: string) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("notifications")
      .select("id,profile_id,title,body,profiles(phone,full_name)")
      .eq("channel", "whatsapp")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const pending = (data ?? []) as unknown as PendingRow[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, skipped: 0, failed: 0 });

    const token = await requireSecret("META_WHATSAPP_ACCESS_TOKEN");
    const phoneId = await requireSecret("META_WHATSAPP_PHONE_NUMBER_ID");

    let sent = 0, skipped = 0, failed = 0;

    for (const row of pending) {
      const phone = row.profiles?.phone?.replace(/\D/g, "") ?? "";
      if (!phone) {
        // Sem telefone não há o que tentar de novo: marca como tratada para a
        // fila não travar num registro impossível.
        await supabase.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
        skipped++;
        continue;
      }

      const text = row.body ? `${row.title}\n\n${row.body}` : row.title;
      const result = await sendWhatsAppText(token, phoneId, phone, text);

      if (result.ok) {
        await supabase.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
        sent++;
      } else {
        // Não logar o corpo inteiro da resposta do provedor: pode conter dado
        // pessoal. Só o id da notificação e o status.
        console.error(`notify-dispatch: falha ao enviar notificação ${row.id}`);
        failed++;
      }
    }

    return json({ processed: pending.length, sent, skipped, failed });
  } catch (error) {
    console.error("notify-dispatch error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
