import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { checkMetaSignature, downloadWhatsAppMedia, normalizePhone, sendWhatsAppText } from "../_shared/meta.ts";
import { transcreverAudio } from "../_shared/openai.ts";
import { DuplicateMessageError, runSdrAgentTurn } from "../_shared/sdrAgent.ts";
import {
  AUDIO_NAO_TRANSCRITO,
  AUDIOS_POR_TELEFONE_DIA,
  corpoDaMensagem,
  decidirReentrega,
  decidirRota,
  type InboundMessage,
  inicioDoDiaEmSaoPaulo,
  nomeDoAudio,
  parseMessages,
  passouDoTetoDeAudios,
  planejar,
  RESERVA,
  RESERVA_RETOMADA,
  RESERVA_VENCE_MIN,
} from "./parse.ts";

/**
 * Webhook de mensagens da WhatsApp Cloud API: robô de SDR, remarketing e caixa
 * de conversas. A decisão fica em `parse.ts` (pura e testada); aqui fica o que
 * toca rede e banco. Destino da mensagem, nesta ordem (F2.5):
 *
 *  1. Conversa `active` do telefone → o robô responde e, quando qualifica,
 *     `sdr_handoff` devolve o lead à roleta.
 *  2. Contato de remarketing esperando resposta → vira lead e conversa com o
 *     agente da lista, e segue como em (1).
 *  3. Conversa mais recente do telefone em outro status → a mensagem entra nela
 *     como fala do lead, sem IA (`human_turn`); a `resolved` reabre como
 *     `human`. Antes caía como `unmatched` e sumia da conversa assumida.
 *  4. Ninguém → `unmatched`. O gatilho da 0083/0120 avisa no sino todo
 *     desfecho que pede gente.
 *
 * Áudio (F1.7): só o de conversa casada é baixado e transcrito; o de número
 * desconhecido fica "[áudio]", sem download nem IA. Se não virar texto (tetos
 * de tamanho e de quantidade, Meta ou OpenAI falhando), a conversa vai para
 * humano com `audio_falhou` e o robô NUNCA responde como se tivesse entendido.
 * Imagem, vídeo e documento viram marcador, sem robô.
 *
 * Idempotência: `provider_message_id` é único em `whatsapp_inbound_messages` e
 * em `sdr_messages`. O áudio é RESERVADO no primeiro antes do download: a
 * reentrega da Meta que chega enquanto a transcrição roda não a paga de novo —
 * leva 503, para a Meta tentar de novo mais tarde (`decidirReentrega`).
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

/** Teto por áudio: 3 MB de nota de voz (ogg/opus) passam de 20 minutos de fala. */
const TETO_AUDIO_BYTES = 3 * 1_048_576;
/**
 * A reserva do áudio (`RESERVA`) até o desfecho: o `detail` acha a que ficou
 * para trás se a function morrer no meio — a reentrega da Meta a assume depois
 * de `RESERVA_VENCE_MIN`, e a varredura do início de cada POST a fecha depois
 * de `RESERVA_PERDIDA_MIN`, os dois contados do `reserved_at`.
 */
const RESERVA_PERDIDA_MIN = 10;
const minutosAtras = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

type RemarketingListConfig = { agent_id: string | null; handoff_group_id: string | null };
type ContatoRemarketing = {
  id: string;
  list_id: string;
  full_name: string | null;
  lead_id: string | null;
  remarketing_lists: RemarketingListConfig | null;
};
type InboundOutcome =
  | "sdr_turn"
  | "remarketing_lead"
  | "unmatched"
  | "agent_error"
  | "human_turn"
  | "audio_falhou";
/** A conversa em que a mensagem entra. */
type Alvo = { id: string; lead_id: string | null };
type Registro = {
  leadId?: string | null;
  conversationId?: string | null;
  detail?: string | null;
  body?: string;
  reservada?: boolean;
};

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
    /** Algum áudio deste POST ficou sem desfecho e sem dono vivo conhecido: a Meta tem de reenviar. */
    let retentar = false;

    /**
     * Registra a mensagem recebida com o desfecho do roteamento, em TODOS os
     * caminhos: nada some com o ACK 200 — nem a mensagem de quem não é lead,
     * nem a do turno que falhou (`sdrAgent.ts` só grava depois da resposta).
     *
     * `ignoreDuplicates` sobre o único de `provider_message_id`: replay da Meta
     * não cria segunda linha nem segundo aviso (o gatilho é AFTER INSERT).
     *
     * Áudio reservado já tem a linha: o desfecho entra por UPDATE, e o gatilho
     * da 0121 avisa no sino quando ele muda. Antes era delete + insert, e na
     * janela entre os dois o aviso podia se perder. O UPDATE só fecha o que
     * ainda é reserva: a que a varredura já deu como perdida fica como está.
     */
    const registrar = async (
      msg: InboundMessage,
      phone: string,
      outcome: InboundOutcome,
      extra: Registro = {},
    ) => {
      const linha = {
        provider_message_id: msg.id,
        from_phone: phone,
        body: extra.body ?? corpoDaMensagem(msg),
        lead_id: extra.leadId ?? null,
        conversation_id: extra.conversationId ?? null,
        outcome,
        detail: extra.detail ? extra.detail.slice(0, 500) : null,
        ...(msg.tipo === "texto" ? {} : { media_type: msg.tipo }),
      };
      const tabela = () => supabase.from("whatsapp_inbound_messages");

      if (extra.reservada) {
        const { data, error } = await tabela()
          .update(linha)
          .eq("provider_message_id", msg.id)
          .eq("outcome", RESERVA.outcome)
          .like("detail", `${RESERVA.detail}%`)
          .select("id");
        if (error) {
          console.error("whatsapp-inbound: falha ao fechar a reserva do áudio —", error.message);
          return;
        }
        if (data?.length) {
          registradas++;
          return;
        }
        // Nenhuma reserva aberta: o upsert abaixo só grava se a linha não existir.
      }

      const { error } = await tabela().upsert(linha, { onConflict: "provider_message_id", ignoreDuplicates: true });
      if (error) {
        console.error("whatsapp-inbound: falha ao registrar mensagem recebida —", error.message);
        return;
      }
      registradas++;
    };

    /** Conversa do lead com este telefone: a ativa ou, sem `soAtiva`, a mais recente em qualquer status. */
    const conversaDoTelefone = async (phone: string, soAtiva: boolean) => {
      let consulta = supabase
        .from("sdr_conversations")
        .select("id, lead_id, status, leads!inner(phone_raw, phone)")
        .or(`phone_raw.eq.${phone},phone.eq.${phone}`, { foreignTable: "leads" });
      if (soAtiva) consulta = consulta.eq("status", "active");
      const { data, error } = await consulta.order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) console.error("whatsapp-inbound: falha ao procurar a conversa —", error.message);
      return data
        ? { id: data.id as string, lead_id: data.lead_id as string | null, status: data.status as string }
        : null;
    };

    const contatoDeRemarketing = async (phone: string) => {
      const { data } = await supabase
        .from("remarketing_contacts")
        .select("id, list_id, full_name, phone, lead_id, remarketing_lists(agent_id, handoff_group_id)")
        .eq("phone", phone)
        .in("status", ["sent", "delivered"])
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as ContatoRemarketing | null) ?? null;
    };

    /** Contato de remarketing respondeu o template: vira lead (se ainda não é) e abre conversa com o agente da lista. */
    const abrirRemarketing = async (
      msg: InboundMessage,
      phone: string,
      contact: ContatoRemarketing,
    ): Promise<Alvo | null> => {
      const listConfig = contact.remarketing_lists;
      let leadId = contact.lead_id;
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
          return null;
        }
        leadId = lead.id as string;
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
        return null;
      }
      return { id: newConv.id as string, lead_id: leadId };
    };

    /** A mensagem já entrou na conversa (réplica): nada a baixar. */
    const jaNaConversa = async (providerMessageId: string) => {
      const { data } = await supabase
        .from("sdr_messages").select("id").eq("provider_message_id", providerMessageId).maybeSingle();
      return data !== null;
    };

    /**
     * Reserva o áudio antes do download e devolve a hora da chegada, que é a
     * posição dele no teto do dia. Se o id já tem linha, `decidirReentrega`
     * diz se é duplicata (200), se esta entrega assume a reserva vencida, ou
     * se a Meta tem de tentar de novo (503). O UPDATE condicional da retomada
     * só devolve a linha a uma entrega; a que perde a corrida também leva 503.
     * Falha do banco leva 503: com 200 a Meta desistia do áudio.
     */
    const reservar = async (
      msg: InboundMessage,
      phone: string,
      alvo: Alvo,
    ): Promise<{ chegada: string } | "duplicata" | "tentar_de_novo"> => {
      const tabela = () => supabase.from("whatsapp_inbound_messages");
      const { data, error } = await tabela().insert({
        provider_message_id: msg.id,
        from_phone: phone,
        body: corpoDaMensagem(msg),
        lead_id: alvo.lead_id,
        conversation_id: alvo.id,
        outcome: RESERVA.outcome,
        detail: RESERVA.detail,
        media_type: "audio",
      }).select("created_at").single();
      if (!error) return { chegada: data.created_at as string };
      if (error.code !== "23505") {
        console.error("whatsapp-inbound: falha ao reservar o áudio —", error.message);
        return "tentar_de_novo";
      }
      const { data: linha, error: lerErr } = await tabela()
        .select("outcome, detail, reserved_at").eq("provider_message_id", msg.id).maybeSingle();
      if (lerErr || !linha) {
        console.error("whatsapp-inbound: falha ao ler a reserva do áudio —", lerErr?.message ?? "linha sumiu");
        return "tentar_de_novo";
      }
      const decisao = decidirReentrega(linha, new Date());
      if (decisao === "duplicata") return "duplicata";
      if (decisao === "em_processamento") return "tentar_de_novo";

      const { data: assumida, error: assumirErr } = await tabela()
        .update({ detail: RESERVA_RETOMADA, reserved_at: new Date().toISOString() })
        .eq("provider_message_id", msg.id)
        .eq("outcome", RESERVA.outcome)
        .eq("detail", RESERVA.detail)
        .lt("reserved_at", minutosAtras(RESERVA_VENCE_MIN))
        .select("created_at")
        .maybeSingle();
      if (assumirErr) console.error("whatsapp-inbound: falha ao assumir a reserva vencida do áudio —", assumirErr.message);
      return assumida ? { chegada: assumida.created_at as string } : "tentar_de_novo";
    };

    /** Baixa e transcreve o áudio da conversa, com os dois tetos de custo. Todo erro daqui manda a conversa para humano. */
    const lerAudio = async (msg: InboundMessage, phone: string, chegada: string): Promise<string> => {
      if (!msg.mediaId) throw new Error("a Meta não mandou o id da mídia");
      // Conta as reservas do telefone até a deste áudio, inclusive: elas entram
      // antes do download, então entregas simultâneas se enxergam, e a posição
      // (pela chegada) não muda quando a reentrega retoma um áudio antigo. Com
      // conversa: o áudio de número sem destino não foi reservado nem pago.
      const { count, error } = await supabase
        .from("whatsapp_inbound_messages")
        .select("id", { count: "exact", head: true })
        .eq("from_phone", phone)
        .eq("media_type", "audio")
        .not("conversation_id", "is", null)
        .gte("created_at", inicioDoDiaEmSaoPaulo(new Date(chegada)))
        .lte("created_at", chegada);
      if (error) throw new Error(`não consegui conferir o limite diário de áudios: ${error.message}`);
      if (passouDoTetoDeAudios(count ?? 0)) {
        throw new Error(`limite de ${AUDIOS_POR_TELEFONE_DIA} áudios por telefone por dia atingido`);
      }
      const { blob, mimeType } = await downloadWhatsAppMedia(msg.mediaId, TETO_AUDIO_BYTES);
      return await transcreverAudio(blob, nomeDoAudio(mimeType || msg.mimeType));
    };

    /**
     * Condicional no status de origem: se alguém mexeu na conversa no meio,
     * nada muda. Sem sessão, o gatilho da 0120 deixa a conversa humana SEM dono
     * — é o que manda o aviso ao SDR inteiro e não prende o lead na roleta.
     */
    const passarParaHumano = async (conversationId: string, de: "active" | "resolved") => {
      const { error } = await supabase
        .from("sdr_conversations").update({ status: "human" }).eq("id", conversationId).eq("status", de);
      if (error) console.error("whatsapp-inbound: falha ao passar a conversa para humano —", error.message);
    };

    /**
     * A reserva que ficou para trás: a edge morreu entre a reserva e o desfecho.
     * Sem isto o lead ficava sem resposta, sem o áudio na conversa e sem aviso.
     * Conta do `reserved_at`, e não da chegada: a retomada renova a hora, e uma
     * retomada viva não é dada como perdida.
     *
     * Se a mensagem já está na conversa, a edge morreu DEPOIS de tratá-la (no
     * envio da resposta, por exemplo): a reserva fecha sem mudar o desfecho,
     * então sem sino — "áudio falhou" ali seria falso. As demais viram
     * `audio_falhou`, que toca o sino (gatilho da 0121). Os dois UPDATEs são
     * condicionais na reserva vencida: duas varreduras não pegam a mesma linha.
     */
    const recuperarReservasPerdidas = async () => {
      const motivo = `a function parou no meio do áudio e a reserva venceu em ${RESERVA_PERDIDA_MIN} min`;
      const limite = minutosAtras(RESERVA_PERDIDA_MIN);
      const { data: abertas, error: abertasErr } = await supabase
        .from("whatsapp_inbound_messages")
        .select("provider_message_id")
        .eq("outcome", RESERVA.outcome)
        .like("detail", `${RESERVA.detail}%`)
        .lt("reserved_at", limite);
      if (abertasErr) {
        console.error("whatsapp-inbound: falha ao varrer reservas de áudio —", abertasErr.message);
        return;
      }
      const ids = (abertas ?? []).map((r) => r.provider_message_id as string);
      if (!ids.length) return;

      const { data: naConversa, error: naConversaErr } = await supabase
        .from("sdr_messages").select("provider_message_id").in("provider_message_id", ids);
      if (naConversaErr) {
        // Sem saber, não marca falha que pode ser falsa: a próxima varredura tenta de novo.
        console.error("whatsapp-inbound: falha ao conferir as reservas na conversa —", naConversaErr.message);
        return;
      }
      const tratadas = (naConversa ?? []).map((r) => r.provider_message_id as string);
      if (tratadas.length) {
        const { error: fecharErr } = await supabase
          .from("whatsapp_inbound_messages")
          .update({ detail: "reserva fechada pela varredura: a mensagem já estava na conversa" })
          .eq("outcome", RESERVA.outcome)
          .like("detail", `${RESERVA.detail}%`)
          .lt("reserved_at", limite)
          .in("provider_message_id", tratadas);
        if (fecharErr) console.error("whatsapp-inbound: falha ao fechar reserva já tratada —", fecharErr.message);
      }
      const perdidas = ids.filter((id) => !tratadas.includes(id));
      if (!perdidas.length) return;

      const { data, error } = await supabase
        .from("whatsapp_inbound_messages")
        .update({ outcome: "audio_falhou", body: AUDIO_NAO_TRANSCRITO, detail: motivo })
        .eq("outcome", RESERVA.outcome)
        .like("detail", `${RESERVA.detail}%`)
        .lt("reserved_at", limite)
        .in("provider_message_id", perdidas)
        .select("provider_message_id, conversation_id");
      if (error) {
        console.error("whatsapp-inbound: falha ao varrer reservas de áudio —", error.message);
        return;
      }
      for (const r of data ?? []) {
        const conversationId = r.conversation_id as string | null;
        if (!conversationId) continue;
        // A linha do lead leva o id da Meta: uma edge antiga ainda viva bate no
        // único ao gravar e para, em vez de o robô responder na conversa humana.
        const { error: gravarErr } = await supabase.from("sdr_messages").insert([
          { conversation_id: conversationId, author: "lead", body: AUDIO_NAO_TRANSCRITO, provider_message_id: r.provider_message_id, media_type: "audio", media_id: null },
          { conversation_id: conversationId, author: "system", body: `Áudio do lead não transcrito (${motivo}). Peça ao lead para repetir por escrito.`, provider_message_id: null, media_type: null, media_id: null },
        ]);
        // Já estava na conversa: o áudio foi tratado e só o desfecho não ficou gravado.
        if (gravarErr?.code === "23505") continue;
        if (gravarErr) console.error("whatsapp-inbound: falha ao gravar o áudio perdido na conversa —", gravarErr.message);
        await passarParaHumano(conversationId, "active");
      }
    };

    const linhaDoLead = (msg: InboundMessage, conversationId: string, corpo: string) => ({
      conversation_id: conversationId,
      author: "lead",
      body: corpo,
      provider_message_id: msg.id,
      media_type: msg.tipo === "texto" ? null : msg.tipo,
      media_id: msg.mediaId,
    });

    /**
     * Grava na conversa. `false` = não gravou: réplica (a mensagem já está lá)
     * ou falha — e a falha fica registrada como `agent_error`, que avisa o SDR.
     */
    const gravarNaConversa = async (
      msg: InboundMessage,
      phone: string,
      extra: Registro,
      linhas: Record<string, unknown>[],
    ) => {
      const { error } = await supabase.from("sdr_messages").insert(linhas);
      if (!error) return true;
      if (error.code !== "23505") {
        console.error("whatsapp-inbound: falha ao gravar na conversa —", error.message);
        await registrar(msg, phone, "agent_error", {
          ...extra,
          detail: `falha ao gravar a mensagem na conversa: ${error.message}`,
        });
      }
      return false;
    };

    const processar = async (msg: InboundMessage, phone: string) => {
      let conversa = await conversaDoTelefone(phone, true);
      const contato = conversa ? null : await contatoDeRemarketing(phone);
      if (!conversa && !contato) conversa = await conversaDoTelefone(phone, false);
      const rota = decidirRota(conversa, contato !== null);

      if (rota === "sem_destino") {
        // Nada é baixado nem transcrito para quem não tem conversa: fica o
        // registro (a mídia, no marcador) e o aviso do gatilho da 0083.
        await registrar(msg, phone, "unmatched");
        return;
      }

      const alvo = rota === "remarketing" && contato ? await abrirRemarketing(msg, phone, contato) : conversa;
      if (!alvo) return; // a falha ao abrir o atendimento já ficou registrada
      const extra: Registro = { leadId: alvo.lead_id, conversationId: alvo.id };

      let chegada = "";
      if (msg.tipo === "audio") {
        if (await jaNaConversa(msg.id)) return;
        const reserva = await reservar(msg, phone, alvo);
        if (reserva === "duplicata") return;
        if (reserva === "tentar_de_novo") {
          retentar = true;
          return;
        }
        chegada = reserva.chegada;
        extra.reservada = true;
      }

      const plano = await planejar(msg, rota, () => lerAudio(msg, phone, chegada));

      if (plano.acao === "anexar") {
        if (!(await gravarNaConversa(msg, phone, extra, [linhaDoLead(msg, alvo.id, plano.corpo)]))) return;
        if (plano.humanoDe) await passarParaHumano(alvo.id, plano.humanoDe);
        await registrar(msg, phone, plano.desfecho, { ...extra, body: plano.corpo, detail: plano.detalhe });
        handled++;
        return;
      }

      if (plano.acao === "passar_para_humano") {
        console.warn("whatsapp-inbound: áudio não transcrito —", plano.motivo);
        // Primeiro o status: se a gravação falhar depois, o robô já não fala.
        if (plano.humanoDe) await passarParaHumano(alvo.id, plano.humanoDe);
        const aviso = `Áudio do lead não transcrito (${plano.motivo.slice(0, 300)}).` +
          (plano.humanoDe === "active" ? " A conversa passou para atendimento humano e o robô não respondeu." : "") +
          " Peça ao lead para repetir por escrito.";
        const gravou = await gravarNaConversa(msg, phone, extra, [
          linhaDoLead(msg, alvo.id, AUDIO_NAO_TRANSCRITO),
          { conversation_id: alvo.id, author: "system", body: aviso, provider_message_id: null, media_type: null, media_id: null },
        ]);
        if (!gravou) return;
        await registrar(msg, phone, "audio_falhou", { ...extra, body: AUDIO_NAO_TRANSCRITO, detail: plano.motivo });
        handled++;
        return;
      }

      try {
        const turn = await runSdrAgentTurn(supabase, {
          conversationId: alvo.id,
          message: plano.texto,
          providerMessageId: msg.id,
          leadMessageExtra: msg.tipo === "audio" ? { media_type: "audio", media_id: msg.mediaId } : undefined,
        });

        try {
          const sent = await sendWhatsAppText(phone, turn.reply);
          if (!sent.ok) console.error("whatsapp-inbound: falha ao responder conversa", alvo.id);
        } catch (e) {
          console.error("whatsapp-inbound: WhatsApp indisponível —", e instanceof Error ? e.message : String(e));
        }

        if (turn.qualified) {
          const { error: handErr } = await supabase.rpc("sdr_handoff", { p_conversation_id: alvo.id });
          if (handErr) {
            console.error("whatsapp-inbound: sdr_handoff falhou —", handErr.message);
          } else {
            console.log("whatsapp-inbound: conversa", alvo.id, "qualificada e devolvida à roleta");
          }
        }
        await registrar(msg, phone, rota === "remarketing" ? "remarketing_lead" : "sdr_turn", {
          ...extra,
          body: plano.texto,
        });
        handled++;
      } catch (e) {
        if (e instanceof DuplicateMessageError) {
          // Replay da Meta: já processada, ACK silencioso.
          return;
        }
        const motivo = e instanceof Error ? e.message : String(e);
        console.error("whatsapp-inbound: turno falhou —", motivo);
        // O áudio não é reprocessado (a reserva barra a reentrega): a
        // transcrição, já paga, fica na conversa para o SDR ler o que o lead
        // disse. O texto segue como sempre — só no registro, com o motivo.
        if (msg.tipo === "audio" && !(await gravarNaConversa(msg, phone, extra, [linhaDoLead(msg, alvo.id, plano.texto)]))) {
          return;
        }
        await registrar(msg, phone, "agent_error", { ...extra, body: plano.texto, detail: motivo });
      }
    };

    // Falha na varredura não pode barrar as mensagens deste POST.
    await recuperarReservasPerdidas().catch((e) =>
      console.error("whatsapp-inbound: varredura de reservas falhou —", e instanceof Error ? e.message : String(e))
    );

    for (const msg of messages) {
      const phone = normalizePhone(msg.from);
      if (!phone) {
        console.warn("whatsapp-inbound: mensagem sem telefone utilizável, descartada");
        continue;
      }
      await processar(msg, phone);
    }

    // 503 só para áudio sem desfecho: a Meta reenvia o POST inteiro com recuo
    // por horas, e o resto dele já tratado cai na idempotência. Fora isso, 200:
    // replays só duplicariam trabalho.
    if (retentar) {
      return new Response(
        JSON.stringify({ success: false, retry: true, received: messages.length, handled, registradas }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return ok({ success: true, received: messages.length, handled, registradas });
  } catch (error) {
    console.error("whatsapp-inbound error:", error);
    return ok({ success: false });
  }
});
