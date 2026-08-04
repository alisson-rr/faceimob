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
 * Ponto de entrada da plataforma de IA de voz/WhatsApp (ata 23/07, item 11).
 *
 * Contrato aceito:
 *   POST /functions/v1/voice-ai-webhook
 *   Authorization: Bearer <VOICE_AI_WEBHOOK_SECRET>
 *   {
 *     "event_id":   "evt_123",              // opcional, para rastreio
 *     "type":       "lead_qualified" | "transcript" | "status",
 *     "external_id":"chamada-987",          // OBRIGATÓRIO: chave do lead lá
 *     "full_name":  "Maria Silva",
 *     "phone":      "+5511999998888",
 *     "transcript": "...",                  // type=transcript
 *     "status":     "qualified" | "lost",   // type=status
 *     "source_code":"ia-voz"                // origem opcional
 *   }
 *
 * Idempotência: `external_id` casa com o índice único parcial
 * `leads_external_id_idx`. Reenviar o mesmo evento não cria um segundo lead —
 * o insert conflita e o fluxo segue com o lead existente. Isso importa porque
 * plataforma de terceiro reenvia por padrão quando não recebe 200 rápido.
 *
 * A distribuição continua sendo do banco: quem escolhe o corretor é
 * `assign_lead`, com o grupo resolvido lá dentro. O webhook não decide fila.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const expected = await requireSecret("VOICE_AI_WEBHOOK_SECRET");
    const provided = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    // Comparação de tamanho fixo não importa aqui (o segredo não é derivado de
    // input do atacante), mas responder 401 sem detalhe evita sondagem.
    if (!provided || provided !== expected) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "corpo inválido" }, 400);

    const externalId = String(body.external_id || "").trim();
    if (!externalId) return json({ error: "external_id obrigatório" }, 400);

    const type = String(body.type || "lead_qualified");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Lead já conhecido?
    const { data: existing, error: findError } = await supabase
      .from("leads")
      .select("id,assigned_to")
      .eq("external_id", externalId)
      .maybeSingle();
    if (findError) throw findError;

    if (type === "transcript" || type === "status") {
      if (!existing) return json({ error: "lead não encontrado para este external_id" }, 404);
      const { error } = await supabase.from("lead_events").insert({
        lead_id: existing.id,
        kind: type === "transcript" ? "voice_ai_transcript" : "voice_ai_status",
        to_value: type === "status" ? String(body.status ?? "") : null,
        detail: type === "transcript" ? { transcript: String(body.transcript ?? "") } : body,
      });
      if (error) throw error;
      return json({ ok: true, lead_id: existing.id, recorded: type });
    }

    if (type !== "lead_qualified") return json({ error: `type desconhecido: ${type}` }, 400);

    if (existing) {
      // Replay: nada a criar. Só entra na roleta se ainda não tem dono.
      if (!existing.assigned_to) {
        await supabase.rpc("assign_lead", { p_lead_id: existing.id });
      }
      return json({ ok: true, lead_id: existing.id, duplicate: true });
    }

    const { data: created, error: insertError } = await supabase
      .from("leads")
      .insert({
        external_id: externalId,
        full_name: String(body.full_name || "Lead da IA de voz"),
        phone_raw: String(body.phone || ""),
        source_code: body.source_code ? String(body.source_code) : null,
        status: "queued",
        funnel_stage: "new",
        sdr_qualified_at: new Date().toISOString(),
        raw_payload: body,
      })
      .select("id")
      .single();

    if (insertError) {
      // Corrida entre dois envios do mesmo evento: o índice único resolve, e o
      // segundo request só precisa devolver o lead que o primeiro criou.
      const { data: raced } = await supabase
        .from("leads")
        .select("id")
        .eq("external_id", externalId)
        .maybeSingle();
      if (raced) return json({ ok: true, lead_id: raced.id, duplicate: true });
      throw insertError;
    }

    const { error: assignError } = await supabase.rpc("assign_lead", { p_lead_id: created.id });
    if (assignError) {
      // Lead criado mas não distribuído é recuperável (a varredura da roleta
      // pega); perder o lead não seria. Reporta sem derrubar.
      console.error("voice-ai-webhook: falha ao distribuir lead", created.id);
      return json({ ok: true, lead_id: created.id, assigned: false });
    }

    return json({ ok: true, lead_id: created.id, assigned: true });
  } catch (error) {
    console.error("voice-ai-webhook error:", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});
