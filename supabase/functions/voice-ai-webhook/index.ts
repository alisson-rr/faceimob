import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";

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
 * O CONTRATO PARA O FORNECEDOR MORA EM `docs/integracoes/voice-ai-webhook.md`.
 * Este comentário é o resumo; o documento é o que se entrega. Até 02/09/2026 o
 * contrato existia só aqui e documentava `source_code` como coluna de `leads`
 * — coluna que nunca existiu (a tabela tem `source_id uuid`), então a function
 * respondia 500 mesmo com credencial e payload corretos. O campo do PAYLOAD
 * continua se chamando `source_code`: é o `code` de `lead_sources`, resolvido
 * aqui para o id, do mesmo jeito que o `meta-ads-webhook` faz.
 *
 * Idempotência: `external_id` casa com o índice único parcial
 * `leads_external_id_idx`. Reenviar o mesmo evento não cria um segundo lead —
 * o insert conflita e o fluxo segue com o lead existente. Isso importa porque
 * plataforma de terceiro reenvia por padrão quando não recebe 200 rápido.
 *
 * A distribuição continua sendo do banco: quem escolhe o corretor é
 * `assign_lead`, com o grupo resolvido lá dentro. O webhook não decide fila.
 */

/** Códigos de origem conhecidos vivem em `lead_sources.code` (slug minúsculo e
 *  único). Código desconhecido não derruba o lead: o lead entra sem origem e o
 *  payload inteiro fica em `raw_payload` para a conferência. Perder o lead
 *  seria pior do que perder a etiqueta de origem. */
async function resolveSourceId(
  supabase: SupabaseClient,
  code: string | null,
): Promise<string | null> {
  const slug = (code || "").trim().toLowerCase();
  if (!slug) return null;
  const { data, error } = await supabase
    .from("lead_sources")
    .select("id")
    .eq("code", slug)
    .eq("active", true)
    .maybeSingle();
  if (error || !data) {
    console.warn(`voice-ai-webhook: source_code desconhecido (${slug}); lead entra sem origem`);
    return null;
  }
  return data.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // Sem segredo compartilhado a integração não existe ainda. 503 e não 500:
    // 500 diz "quebrou aqui dentro" e faz a plataforma de voz retentar para
    // sempre; 503 com motivo diz o que falta e a quem pedir.
    const expected = await getSecret("VOICE_AI_WEBHOOK_SECRET");
    if (!expected) {
      console.error("voice-ai-webhook: VOICE_AI_WEBHOOK_SECRET ausente no cofre");
      return json({
        error: "Integração de voz não configurada.",
        detail: "Cadastre voice_ai/webhook_secret em Admin → Integrações antes de apontar o webhook.",
      }, 503);
    }

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

    const sourceId = await resolveSourceId(supabase, body.source_code ? String(body.source_code) : null);

    const { data: created, error: insertError } = await supabase
      .from("leads")
      .insert({
        external_id: externalId,
        full_name: String(body.full_name || "Lead da IA de voz"),
        phone_raw: String(body.phone || ""),
        source_id: sourceId,
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
