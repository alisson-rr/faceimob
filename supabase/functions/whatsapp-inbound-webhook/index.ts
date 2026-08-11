import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { checkMetaSignature, normalizePhone, sendWhatsAppText } from "../_shared/meta.ts";
import { DuplicateMessageError, runSdrAgentTurn } from "../_shared/sdrAgent.ts";

/**
 * Webhook de mensagens da WhatsApp Cloud API — o elo que faltava do SDR por IA
 * (ata 14/07, 00:32-00:33) e do remarketing (00:35-00:37):
 *
 *  1. Resposta de lead com conversa SDR ativa → agente responde e, quando
 *     qualifica, `sdr_handoff` devolve o lead à roleta do grupo.
 *  2. Resposta de contato de remarketing → vira lead, abre conversa com o
 *     agente da lista e segue o mesmo fluxo.
 *  3. Qualquer outra mensagem → ACK 200 sem efeito (não é assunto do SDR).
 *
 * Idempotência: o id da mensagem do provedor tem índice único em
 * `sdr_messages.provider_message_id` — replay da Meta não duplica turno.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type InboundMessage = { from: string; id: string; text: string };
type UnknownRecord = Record<string, unknown>;
type RemarketingListConfig = { agent_id: string | null; handoff_group_id: string | null };

const recordValue = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";

function parseMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entryValue of arrayValue(recordValue(body).entry)) {
    const entry = recordValue(entryValue);
    for (const changeValue of arrayValue(entry.changes)) {
      const change = recordValue(changeValue);
      if (change.field !== "messages") continue;
      for (const messageValue of arrayValue(recordValue(change.value).messages)) {
        const m = recordValue(messageValue);
        const text =
          stringValue(recordValue(m.text).body) ||
          stringValue(recordValue(m.button).text) ||
          stringValue(recordValue(recordValue(m.interactive).button_reply).title) ||
          stringValue(recordValue(recordValue(m.interactive).list_reply).title);
        const from = stringValue(m.from);
        const id = stringValue(m.id);
        if (from && id && text) out.push({ from, id, text });
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Handshake de assinatura de webhook da Meta (mesmo token do meta-ads).
    if (req.method === "GET") {
      const url = new URL(req.url);
      const verifyToken = await getSecret("META_WEBHOOK_VERIFY_TOKEN");
      if (
        verifyToken &&
        url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === verifyToken
      ) {
        return new Response(url.searchParams.get("hub.challenge") || "", {
          status: 200,
          headers: corsHeaders,
        });
      }
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const raw = await req.text();
    const sig = await checkMetaSignature(raw, req.headers.get("x-hub-signature-256"));
    if (sig === "invalid") {
      console.error("whatsapp-inbound: assinatura inválida — POST recusado");
      return new Response("Invalid signature", { status: 401, headers: corsHeaders });
    }
    if (sig === "unconfigured") {
      console.warn("whatsapp-inbound: META_APP_SECRET não cadastrado — aceitando sem verificação");
    }

    let body: unknown = {};
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      console.warn("whatsapp-inbound: payload JSON inválido");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const messages = parseMessages(body);
    let handled = 0;

    for (const msg of messages) {
      const phone = normalizePhone(msg.from);
      if (!phone) continue;

      // 1) Conversa SDR ativa do lead com este telefone.
      const { data: convRow } = await supabase
        .from("sdr_conversations")
        .select("id, lead_id, leads!inner(phone_raw, phone)")
        .eq("status", "active")
        .or(`phone_raw.eq.${phone},phone.eq.${phone}`, { foreignTable: "leads" })
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let conversationId = convRow?.id as string | undefined;

      // 2) Sem conversa: pode ser contato de remarketing respondendo o template.
      if (!conversationId) {
        const { data: contact } = await supabase
          .from("remarketing_contacts")
          .select("id, list_id, full_name, phone, lead_id, remarketing_lists(agent_id, handoff_group_id)")
          .eq("phone", phone)
          .in("status", ["sent", "delivered"])
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (contact) {
          const listConfig = contact.remarketing_lists as RemarketingListConfig | null;
          let leadId = contact.lead_id as string | null;
          if (!leadId) {
            const { data: lead, error: leadErr } = await supabase
              .from("leads")
              .insert({
                full_name: contact.full_name || "Contato de remarketing",
                phone,
                phone_raw: phone,
                status: "queued",
                funnel_stage: "new",
                utm_source: "remarketing",
                distribution_group_id: listConfig?.handoff_group_id ?? null,
                raw_payload: { remarketing_list_id: contact.list_id },
              })
              .select("id")
              .single();
            if (leadErr) {
              console.error("whatsapp-inbound: falha ao criar lead de remarketing —", leadErr.message);
              continue;
            }
            leadId = lead.id;
          }

          const { error: updErr } = await supabase
            .from("remarketing_contacts")
            .update({ status: "replied", replied_at: new Date().toISOString(), lead_id: leadId })
            .eq("id", contact.id);
          if (updErr) console.error("whatsapp-inbound: falha ao marcar replied —", updErr.message);

          const { data: newConv, error: convErr } = await supabase
            .from("sdr_conversations")
            .insert({ lead_id: leadId, agent_id: listConfig?.agent_id ?? null })
            .select("id")
            .single();
          if (convErr) {
            console.error("whatsapp-inbound: falha ao abrir conversa —", convErr.message);
            continue;
          }
          conversationId = newConv.id;
        }
      }

      if (!conversationId) {
        // Não é lead em SDR nem remarketing — mensagem fora do escopo do robô.
        continue;
      }

      try {
        const turn = await runSdrAgentTurn(supabase, {
          conversationId,
          message: msg.text,
          providerMessageId: msg.id,
        });

        try {
          const sent = await sendWhatsAppText(phone, turn.reply);
          if (!sent.ok) console.error("whatsapp-inbound: falha ao responder conversa", conversationId);
        } catch (e) {
          console.error("whatsapp-inbound: WhatsApp indisponível —", e instanceof Error ? e.message : String(e));
        }

        if (turn.qualified) {
          const { error: handErr } = await supabase.rpc("sdr_handoff", {
            p_conversation_id: conversationId,
          });
          if (handErr) {
            console.error("whatsapp-inbound: sdr_handoff falhou —", handErr.message);
          } else {
            console.log("whatsapp-inbound: conversa", conversationId, "qualificada e devolvida à roleta");
          }
        }
        handled++;
      } catch (e) {
        if (e instanceof DuplicateMessageError) {
          // Replay da Meta: já processada, ACK silencioso.
          continue;
        }
        console.error("whatsapp-inbound: turno falhou —", e instanceof Error ? e.message : String(e));
      }
    }

    // Sempre 200: a Meta re-tenta em qualquer outra resposta e replays duplicam trabalho.
    return ok({ success: true, received: messages.length, handled });
  } catch (error) {
    console.error("whatsapp-inbound error:", error);
    return ok({ success: false });
  }
});
