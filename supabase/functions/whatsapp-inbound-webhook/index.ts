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
 *  3. Qualquer outra mensagem → ACK 200, REGISTRADA em
 *     `whatsapp_inbound_messages` e com aviso ao SDR no sino (migration 0083).
 *     Até aqui esse terceiro caminho era um `continue` puro: quem escrevia para
 *     o número da empresa sem ser lead em SDR nem contato de remarketing sumia
 *     — sem registro, sem caixa de entrada e sem encaminhamento a humano.
 *
 * Idempotência: o id da mensagem do provedor tem índice único em
 * `sdr_messages.provider_message_id` (turno do agente) e em
 * `whatsapp_inbound_messages.provider_message_id` (registro bruto) — replay da
 * Meta não duplica turno nem aviso.
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
type InboundOutcome = "sdr_turn" | "remarketing_lead" | "unmatched" | "agent_error";

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
      // Antes daqui a function ACEITAVA o POST sem prova de origem quando o
      // app secret não estava cadastrado. Quem descobrisse a URL injetava
      // conversa de SDR, criava lead de remarketing e gastava token da OpenAI
      // — e o único sinal era uma linha de log.
      //
      // Recusar deixa o webhook inerte até a credencial existir, e isso é o
      // comportamento correto: sem `META_APP_SECRET` não há como registrar o
      // webhook no painel da Meta de qualquer jeito, então nada de legítimo é
      // perdido. O 401 diz o motivo em vez de falhar em silêncio.
      console.error("whatsapp-inbound: META_APP_SECRET não cadastrado — POST recusado");
      return new Response(
        JSON.stringify({
          error: "Webhook não configurado.",
          detail: "Cadastre meta/app_secret em Admin → Integrações para validar a assinatura da Meta.",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
    let registradas = 0;

    /**
     * Registra a mensagem recebida com o desfecho do roteamento.
     *
     * Chamada em TODOS os caminhos, inclusive nos que antes terminavam em
     * `continue`. Duas perdas de dado morrem aqui: a mensagem de quem escreve
     * para o número da empresa sem ser lead em SDR nem contato de remarketing,
     * e a mensagem cujo turno do agente falhou — `sdrAgent.ts` só grava as duas
     * linhas DEPOIS de a resposta existir (decisão certa lá, buraco aqui).
     *
     * `ignoreDuplicates` sobre o único de `provider_message_id`: replay da Meta
     * não cria segunda linha nem segundo aviso ao SDR (o gatilho é AFTER
     * INSERT). Falha no registro não derruba o processamento — é log, não fluxo
     * — mas aparece no console para não sumir por sua vez.
     */
    const registrar = async (
      msg: InboundMessage,
      phone: string,
      outcome: InboundOutcome,
      extra: { leadId?: string | null; conversationId?: string | null; detail?: string | null } = {},
    ) => {
      const { error } = await supabase
        .from("whatsapp_inbound_messages")
        .upsert({
          provider_message_id: msg.id,
          from_phone: phone,
          body: msg.text,
          lead_id: extra.leadId ?? null,
          conversation_id: extra.conversationId ?? null,
          outcome,
          detail: extra.detail ? extra.detail.slice(0, 500) : null,
        }, { onConflict: "provider_message_id", ignoreDuplicates: true });
      if (error) {
        console.error("whatsapp-inbound: falha ao registrar mensagem recebida —", error.message);
        return;
      }
      registradas++;
    };

    for (const msg of messages) {
      const phone = normalizePhone(msg.from);
      if (!phone) {
        console.warn("whatsapp-inbound: mensagem sem telefone utilizável, descartada");
        continue;
      }

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
      let leadId = (convRow?.lead_id as string | undefined) ?? null;
      let origem: InboundOutcome = "sdr_turn";

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
          origem = "remarketing_lead";
          const listConfig = contact.remarketing_lists as RemarketingListConfig | null;
          leadId = contact.lead_id as string | null;
          if (!leadId) {
            // `status: 'queued'` sem `assigned_to` de propósito: quem acha dono
            // é o cron `faceimob-assign-queued`, que roda a cada minuto e chama
            // `assign_lead`. Distribuir daqui furaria a roleta — grupo, turno e
            // trava de atendimento saem do banco, não do webhook.
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
              await registrar(msg, phone, "agent_error", {
                detail: `falha ao criar lead de remarketing: ${leadErr.message}`,
              });
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
            await registrar(msg, phone, "agent_error", {
              leadId,
              detail: `falha ao abrir conversa: ${convErr.message}`,
            });
            continue;
          }
          conversationId = newConv.id;
        }
      }

      if (!conversationId) {
        // Não é lead em SDR nem remarketing. Era `continue` puro: a mensagem do
        // cliente sumia com ACK 200 para a Meta. Agora fica registrada e o
        // gatilho da 0083 avisa SDR e admin no sino.
        await registrar(msg, phone, "unmatched");
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
        await registrar(msg, phone, origem, { leadId, conversationId });
        handled++;
      } catch (e) {
        if (e instanceof DuplicateMessageError) {
          // Replay da Meta: já processada, ACK silencioso. O registro da
          // primeira passagem continua lá; `ignoreDuplicates` cuida do resto.
          continue;
        }
        const motivo = e instanceof Error ? e.message : String(e);
        console.error("whatsapp-inbound: turno falhou —", motivo);
        // A mensagem do cliente NÃO se perde por falha do modelo: fica
        // registrada com o motivo, e o SDR é avisado para responder à mão.
        await registrar(msg, phone, "agent_error", { leadId, conversationId, detail: motivo });
      }
    }

    // Sempre 200: a Meta re-tenta em qualquer outra resposta e replays duplicam trabalho.
    return ok({ success: true, received: messages.length, handled, registradas });
  } catch (error) {
    console.error("whatsapp-inbound error:", error);
    return ok({ success: false });
  }
});
