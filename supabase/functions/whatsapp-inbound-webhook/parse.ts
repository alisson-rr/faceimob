/**
 * O que o `whatsapp-inbound-webhook` decide sem tocar em rede nem banco: ler o
 * payload da Meta, escolher o destino da mensagem e montar o plano do turno.
 *
 * Sem nenhum import, de propósito: o `index.ts` puxa o supabase-js por URL do
 * Deno e o vitest não o carrega. A regra que decide se o robô fala fica aqui,
 * onde tem teste.
 */

export type TipoMensagem = "texto" | "audio" | "imagem" | "video" | "documento" | "outro";

export type InboundMessage = {
  from: string;
  id: string;
  text: string;
  tipo: TipoMensagem;
  mediaId: string | null;
  mimeType: string | null;
};

type Registro = Record<string, unknown>;

const registro = (v: unknown): Registro =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Registro : {};
const lista = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const texto = (v: unknown): string => typeof v === "string" ? v : "";

/**
 * Tipo da Cloud API → tipo da caixa. `voice` é a nota de voz; `unsupported` é
 * o que a Meta recebeu e não repassa (uma enquete, por exemplo): o lead mandou
 * algo, e sumir com isso seria perder a mensagem. Reação e aviso de sistema
 * ficam de fora — não são fala nova do lead.
 */
const MIDIA = new Map<string, Exclude<TipoMensagem, "texto">>([
  ["audio", "audio"],
  ["voice", "audio"],
  ["image", "imagem"],
  ["video", "video"],
  ["document", "documento"],
  ["sticker", "outro"],
  ["location", "outro"],
  ["contacts", "outro"],
  ["unsupported", "outro"],
]);

export function parseMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of lista(registro(body).entry)) {
    for (const changeValue of lista(registro(entry).changes)) {
      const change = registro(changeValue);
      if (change.field !== "messages") continue;
      for (const messageValue of lista(registro(change.value).messages)) {
        const m = registro(messageValue);
        const from = texto(m.from);
        const id = texto(m.id);
        if (!from || !id) continue;

        const text =
          texto(registro(m.text).body) ||
          texto(registro(m.button).text) ||
          texto(registro(registro(m.interactive).button_reply).title) ||
          texto(registro(registro(m.interactive).list_reply).title);
        if (text) {
          out.push({ from, id, text, tipo: "texto", mediaId: null, mimeType: null });
          continue;
        }

        const tipoMeta = texto(m.type);
        const tipo = MIDIA.get(tipoMeta);
        if (!tipo) continue;
        const midia = registro(m[tipoMeta]);
        out.push({
          from,
          id,
          text: "",
          tipo,
          mediaId: texto(midia.id) || null,
          mimeType: texto(midia.mime_type) || null,
        });
      }
    }
  }
  return out;
}

/**
 * Corpo gravado para a mídia. A aba Conversas tira o selo de `media_type` e
 * separa o áudio que falhou pelo corpo começando por "[áudio" (`seloDeMidia`,
 * src/components/sdr/types.ts): por isso estes textos, e não outros.
 */
export const AUDIO_SEM_DESTINO = "[áudio]";
export const AUDIO_NAO_TRANSCRITO = "[áudio não transcrito]";

const CORPO_DA_MIDIA: Record<Exclude<TipoMensagem, "texto">, string> = {
  audio: AUDIO_SEM_DESTINO,
  imagem: "[imagem]",
  video: "[vídeo]",
  documento: "[documento]",
  outro: "[mídia]",
};

export const corpoDaMensagem = (m: Pick<InboundMessage, "tipo" | "text">): string =>
  m.tipo === "texto" ? m.text : CORPO_DA_MIDIA[m.tipo];

export type Rota = "robo" | "remarketing" | "humano" | "reabrir" | "sem_destino";

/**
 * Para onde vai a mensagem, na ordem da caixa de conversas (F2.5):
 *  1. conversa `active` do telefone → o robô responde;
 *  2. contato de remarketing esperando resposta → vira lead e conversa;
 *  3. conversa mais recente em qualquer outro status → entra nela, sem IA; a
 *     `resolved` reabre como `human`;
 *  4. ninguém → `unmatched`.
 * `conversa` é a ativa, se houver; senão, a mais recente do telefone.
 */
export function decidirRota(conversa: { status: string } | null, remarketing: boolean): Rota {
  if (conversa?.status === "active") return "robo";
  if (remarketing) return "remarketing";
  if (!conversa) return "sem_destino";
  return conversa.status === "resolved" ? "reabrir" : "humano";
}

export type Plano =
  /** O robô responde a `texto` — a transcrição, quando é áudio. */
  | { acao: "turno"; texto: string }
  /** Entra na conversa como fala do lead, sem robô. `humanoDe`: status que vira `human`. */
  | {
      acao: "anexar";
      corpo: string;
      desfecho: "human_turn" | "agent_error";
      detalhe: string | null;
      humanoDe: "resolved" | null;
    }
  /** Áudio que não virou texto: a conversa vai para humano e o robô não fala. */
  | { acao: "passar_para_humano"; motivo: string; humanoDe: "active" | "resolved" | null };

/**
 * O plano de uma mensagem que casou com uma conversa. `lerAudio` baixa e
 * transcreve (é quem aplica os tetos); qualquer erro dele vira "passar para
 * humano" — nunca um turno com texto vazio ou inventado.
 */
export async function planejar(
  msg: Pick<InboundMessage, "tipo" | "text">,
  rota: Exclude<Rota, "sem_destino">,
  lerAudio: () => Promise<string>,
): Promise<Plano> {
  const robo = rota === "robo" || rota === "remarketing";
  const reabre = rota === "reabrir" ? "resolved" as const : null;

  let fala = msg.text;
  if (msg.tipo === "audio") {
    try {
      fala = await lerAudio();
    } catch (e) {
      return {
        acao: "passar_para_humano",
        motivo: e instanceof Error ? e.message : String(e),
        humanoDe: robo ? "active" : reabre,
      };
    }
  } else if (msg.tipo !== "texto") {
    // O robô não lê imagem, vídeo nem documento: fica o marcador na conversa,
    // e o `agent_error` faz o sino chamar o SDR.
    return robo
      ? { acao: "anexar", corpo: corpoDaMensagem(msg), desfecho: "agent_error", detalhe: `mídia não suportada: ${msg.tipo}`, humanoDe: null }
      : { acao: "anexar", corpo: corpoDaMensagem(msg), desfecho: "human_turn", detalhe: null, humanoDe: reabre };
  }

  return robo
    ? { acao: "turno", texto: fala }
    : { acao: "anexar", corpo: fala, desfecho: "human_turn", detalhe: null, humanoDe: reabre };
}

/**
 * Marcador da reserva do áudio em `whatsapp_inbound_messages.detail`, gravado
 * antes do download. A retomada começa pelo mesmo texto: a varredura das
 * reservas perdidas e o fechamento da reserva acham as duas pelo prefixo.
 */
export const RESERVA_DO_AUDIO = "áudio em processamento";
export const RESERVA_RETOMADA = `${RESERVA_DO_AUDIO} (retomada)`;
/** `sdr_turn` não aciona o sino: a reserva só avisa quando o desfecho muda. */
export const RESERVA = { outcome: "sdr_turn", detail: RESERVA_DO_AUDIO } as const;
/** Reserva sem desfecho há mais que isto (pelo `reserved_at`): a edge morreu no meio. */
export const RESERVA_VENCE_MIN = 5;

/**
 * A entrega de um áudio cujo id já tem linha em `whatsapp_inbound_messages`:
 *  - `duplicata`: já tem desfecho → 200, nada a fazer;
 *  - `retomar`: reserva original vencida → esta entrega a assume;
 *  - `em_processamento`: reserva recente, ou retomada que também parou → 503,
 *    para a Meta reenviar mais tarde. Com 200 ela parava de tentar e o áudio
 *    ficava "em processamento" sem sino até o próximo POST qualquer.
 * A retomada só acontece uma vez (custo); a que parou fica para a varredura.
 */
export type Reentrega = "duplicata" | "retomar" | "em_processamento";

export function decidirReentrega(
  linha: { outcome: string; detail: string | null; reserved_at: string },
  agora: Date,
): Reentrega {
  if (linha.outcome !== RESERVA.outcome || !linha.detail?.startsWith(RESERVA_DO_AUDIO)) return "duplicata";
  const vencida = agora.getTime() - new Date(linha.reserved_at).getTime() > RESERVA_VENCE_MIN * 60_000;
  return vencida && linha.detail === RESERVA_DO_AUDIO ? "retomar" : "em_processamento";
}

/** Teto de áudios por telefone por dia: custo de IA previsível. */
export const AUDIOS_POR_TELEFONE_DIA = 15;

/**
 * `posicao` = reservas de áudio do telefone no dia até a deste, inclusive. Por
 * telefone, e não por conversa: no remarketing, 20 notas de voz simultâneas
 * abrem 20 conversas e cada uma contaria 1. Conta reserva, e não mensagem
 * gravada na conversa (que só entra depois da transcrição): entregas
 * simultâneas veem 1..20, e não 0 cada uma.
 */
export const passouDoTetoDeAudios = (posicao: number): boolean => posicao > AUDIOS_POR_TELEFONE_DIA;

/** 00:00 de hoje em São Paulo, em ISO UTC. UTC−3 o ano todo (sem horário de verão desde 2019). */
export function inicioDoDiaEmSaoPaulo(agora: Date): string {
  const fuso = 3 * 3_600_000;
  const local = new Date(agora.getTime() - fuso);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + fuso,
  ).toISOString();
}

/**
 * Nome do arquivo que vai à OpenAI, que reconhece o formato pela extensão. A
 * nota de voz do WhatsApp é ogg/opus; formato que ela não lê (amr) falha lá, e
 * a falha manda a conversa para humano.
 */
export function nomeDoAudio(mimeType: string | null): string {
  const mime = (mimeType ?? "").toLowerCase();
  const ext = mime.includes("mpeg") ? "mp3"
    : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a"
    : mime.includes("wav") ? "wav"
    : mime.includes("webm") ? "webm"
    : "ogg";
  return `audio.${ext}`;
}
