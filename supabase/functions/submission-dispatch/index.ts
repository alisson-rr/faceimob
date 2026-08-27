import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSecret } from "../_shared/secrets.ts";
import { sendEmail } from "../_shared/brevo.ts";
import { requireServiceRole } from "../_shared/auth.ts";

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
 * Consome a fila `developer_submissions` e envia o dossiê pelo Brevo.
 *
 * A separação entre montar e enviar é o que permite reprocessar uma falha sem
 * remontar o envio: a tela grava `queued`, esta function tenta e registra o
 * resultado. `attempts` e `last_error` ficam na linha, então o CCA vê por que
 * não saiu em vez de descobrir pelo silêncio.
 *
 * Anexo vai por URL assinada de 24h, não por base64: o Brevo baixa o arquivo, e
 * um dossiê com 9 documentos estouraria o limite de corpo da API.
 */
const BATCH_LIMIT = 10;
const SIGNED_URL_TTL = 60 * 60 * 24;
const MAX_ATTEMPTS = 5;

type SubmissionRow = {
  id: string;
  deal_id: string;
  to_email: string;
  cc_emails: string[] | null;
  subject: string;
  body: string | null;
  document_ids: string[];
  attempts: number;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Mesma porta do notify-dispatch: só o pg_cron (0020) chama. Aberto, o
    // endpoint mandava dossiê de cliente por e-mail a pedido de qualquer um
    // com a chave publicável (achado S04).
    const denied = await requireServiceRole(req, corsHeaders);
    if (denied) return denied;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("developer_submissions")
      .select("id,deal_id,to_email,cc_emails,subject,body,document_ids,attempts")
      .in("status", ["queued", "failed"])
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const pending = (data ?? []) as SubmissionRow[];
    if (pending.length === 0) return json({ processed: 0, sent: 0, failed: 0 });

    const senderEmail = await requireSecret("BREVO_SENDER_EMAIL");

    let sent = 0, failed = 0;

    for (const row of pending) {
      // Marca `sending` antes de tentar: se a function morrer no meio, a linha
      // não fica presa em `queued` sendo repescada por outra instância junto.
      await supabase.from("developer_submissions").update({ status: "sending" }).eq("id", row.id);

      try {
        const { data: docs, error: docError } = await supabase
          .from("deal_documents")
          .select("id,storage_path,stored_name")
          .in("id", row.document_ids.length > 0 ? row.document_ids : ["00000000-0000-0000-0000-000000000000"]);
        if (docError) throw docError;

        const attachments = [];
        for (const doc of (docs ?? []) as { storage_path: string; stored_name: string }[]) {
          const { data: signed, error: signError } = await supabase.storage
            .from("deal-documents")
            .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);
          if (signError) throw signError;
          attachments.push({ name: doc.stored_name, url: signed.signedUrl });
        }

        const html = `<p>${escapeHtml(row.body ?? "").replace(/\n/g, "<br>")}</p>`;
        const result = await sendEmail({
          to: row.to_email,
          cc: row.cc_emails ?? undefined,
          subject: row.subject,
          html,
          attachments,
          senderEmail,
        });

        if (!result.ok) throw new Error(result.error);

        await supabase
          .from("developer_submissions")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, attempts: row.attempts + 1 })
          .eq("id", row.id);
        sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : "erro desconhecido";
        await supabase
          .from("developer_submissions")
          .update({ status: "failed", last_error: message.slice(0, 500), attempts: row.attempts + 1 })
          .eq("id", row.id);
        console.error(`submission-dispatch: falha no envio ${row.id}`);
        failed++;
      }
    }

    return json({ processed: pending.length, sent, failed });
  } catch (error) {
    console.error("submission-dispatch error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
