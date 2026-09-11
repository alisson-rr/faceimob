import { describe, expect, it } from "vitest";
import {
  AUDIO_NAO_TRANSCRITO, AUDIOS_POR_TELEFONE_DIA, corpoDaMensagem, decidirReentrega, decidirRota, inicioDoDiaEmSaoPaulo,
  nomeDoAudio, parseMessages, passouDoTetoDeAudios, planejar, RESERVA_DO_AUDIO, RESERVA_RETOMADA,
} from "./parse.ts";

/**
 * O que decide se o robô fala. Cada bloco trava um defeito que custaria caro:
 * áudio sumindo sem rastro, robô respondendo a um áudio que não leu, e a
 * resposta do lead caindo fora da conversa assumida.
 */
const payload = (...messages: unknown[]) => ({
  entry: [{ changes: [{ field: "messages", value: { messages } }] }],
});
const de = { from: "5511999990000" };

describe("parseMessages", () => {
  it("texto, botão e interativo seguem como hoje", () => {
    const r = parseMessages(payload(
      { ...de, id: "t", type: "text", text: { body: "Oi" } },
      { ...de, id: "b", type: "button", button: { text: "Quero saber" } },
      { ...de, id: "i", type: "interactive", interactive: { button_reply: { title: "Sim" } } },
      { ...de, id: "l", type: "interactive", interactive: { list_reply: { title: "2 quartos" } } },
    ));
    expect(r.map((m) => [m.tipo, m.text, m.mediaId])).toEqual([
      ["texto", "Oi", null],
      ["texto", "Quero saber", null],
      ["texto", "Sim", null],
      ["texto", "2 quartos", null],
    ]);
  });

  it("áudio e nota de voz trazem o id e o mime_type da mídia", () => {
    const r = parseMessages(payload(
      { ...de, id: "a", type: "audio", audio: { id: "111", mime_type: "audio/ogg; codecs=opus", voice: true } },
      { ...de, id: "v", type: "voice", voice: { id: "222", mime_type: "audio/ogg" } },
    ));
    expect(r).toEqual([
      { ...de, id: "a", text: "", tipo: "audio", mediaId: "111", mimeType: "audio/ogg; codecs=opus" },
      { ...de, id: "v", text: "", tipo: "audio", mediaId: "222", mimeType: "audio/ogg" },
    ]);
  });

  it("imagem vira tipo 'imagem' com texto vazio; reação e tipo desconhecido não entram", () => {
    const r = parseMessages(payload(
      { ...de, id: "img", type: "image", image: { id: "333", mime_type: "image/jpeg", caption: "fachada" } },
      { ...de, id: "r", type: "reaction", reaction: { message_id: "wamid.0", emoji: "ok" } },
      { ...de, id: "x", type: "constructor" },
    ));
    expect(r).toEqual([{ ...de, id: "img", text: "", tipo: "imagem", mediaId: "333", mimeType: "image/jpeg" }]);
  });

  it("os marcadores começam por '[áudio', que é como a aba Conversas separa o áudio que falhou", () => {
    expect(corpoDaMensagem({ tipo: "audio", text: "" })).toBe("[áudio]");
    expect(AUDIO_NAO_TRANSCRITO).toBe("[áudio não transcrito]");
    expect(corpoDaMensagem({ tipo: "imagem", text: "" })).toBe("[imagem]");
  });
});

describe("decidirRota", () => {
  it("conversa ativa vai para o robô, mesmo com remarketing pendente", () => {
    expect(decidirRota({ status: "active" }, true)).toBe("robo");
  });

  it("'human' não chama o robô: a mensagem entra na conversa", () => {
    expect(decidirRota({ status: "human" }, false)).toBe("humano");
    expect(decidirRota({ status: "handed_off" }, false)).toBe("humano");
  });

  it("'resolved' reabre como 'human'", () => {
    expect(decidirRota({ status: "resolved" }, false)).toBe("reabrir");
  });

  it("remarketing vem antes da conversa encerrada; sem ninguém, sem destino", () => {
    expect(decidirRota({ status: "resolved" }, true)).toBe("remarketing");
    expect(decidirRota(null, true)).toBe("remarketing");
    expect(decidirRota(null, false)).toBe("sem_destino");
  });
});

describe("planejar", () => {
  const audio = { tipo: "audio" as const, text: "" };
  const texto = { tipo: "texto" as const, text: "Alô?" };
  const transcreve = async () => "Quero visitar no sábado";
  const falha = async (): Promise<string> => {
    throw new Error("A OpenAI recusou a chave de API (401).");
  };
  const naoLe = async (): Promise<string> => {
    throw new Error("não devia baixar áudio");
  };

  it("áudio com a transcrição lançando erro passa para humano e nunca vira turno", async () => {
    expect(await planejar(audio, "robo", falha)).toEqual({
      acao: "passar_para_humano",
      motivo: "A OpenAI recusou a chave de API (401).",
      humanoDe: "active",
    });
    expect(await planejar(audio, "remarketing", falha)).toMatchObject({ acao: "passar_para_humano", humanoDe: "active" });
    expect(await planejar(audio, "reabrir", falha)).toMatchObject({ acao: "passar_para_humano", humanoDe: "resolved" });
    expect(await planejar(audio, "humano", falha)).toMatchObject({ acao: "passar_para_humano", humanoDe: null });
  });

  it("áudio transcrito vai ao robô como texto; em conversa que o robô não atende, entra sem robô", async () => {
    expect(await planejar(audio, "robo", transcreve)).toEqual({ acao: "turno", texto: "Quero visitar no sábado" });
    expect(await planejar(audio, "humano", transcreve)).toEqual({
      acao: "anexar", corpo: "Quero visitar no sábado", desfecho: "human_turn", detalhe: null, humanoDe: null,
    });
  });

  it("'human' não chama o robô e 'resolved' reabre como 'human'", async () => {
    expect(await planejar(texto, "humano", naoLe)).toEqual({
      acao: "anexar", corpo: "Alô?", desfecho: "human_turn", detalhe: null, humanoDe: null,
    });
    expect(await planejar(texto, "reabrir", naoLe)).toMatchObject({ acao: "anexar", humanoDe: "resolved" });
  });

  it("imagem não chama o robô: marcador na conversa e aviso ao SDR", async () => {
    const imagem = { tipo: "imagem" as const, text: "" };
    expect(await planejar(imagem, "robo", naoLe)).toEqual({
      acao: "anexar", corpo: "[imagem]", desfecho: "agent_error", detalhe: "mídia não suportada: imagem", humanoDe: null,
    });
    expect(await planejar(imagem, "reabrir", naoLe)).toMatchObject({ desfecho: "human_turn", humanoDe: "resolved" });
  });
});

describe("teto diário e arquivo do áudio", () => {
  it("o dia começa às 00:00 de São Paulo, não à meia-noite UTC", () => {
    expect(inicioDoDiaEmSaoPaulo(new Date("2026-09-11T02:00:00Z"))).toBe("2026-09-10T03:00:00.000Z");
    expect(inicioDoDiaEmSaoPaulo(new Date("2026-09-11T12:00:00Z"))).toBe("2026-09-11T03:00:00.000Z");
  });

  it("a posição (reservas do telefone no dia) conta a do próprio áudio: o 15º passa e o 16º é recusado", () => {
    expect(AUDIOS_POR_TELEFONE_DIA).toBe(15);
    expect(passouDoTetoDeAudios(1)).toBe(false);
    expect(passouDoTetoDeAudios(15)).toBe(false);
    expect(passouDoTetoDeAudios(16)).toBe(true);
  });

  it("a retomada começa pelo marcador da reserva, que é como a varredura e o fechamento a acham", () => {
    expect(RESERVA_DO_AUDIO).toBe("áudio em processamento");
    expect(RESERVA_RETOMADA.startsWith(RESERVA_DO_AUDIO)).toBe(true);
    expect(RESERVA_RETOMADA).not.toBe(RESERVA_DO_AUDIO);
  });

  it("reentrega: reserva recente pede 503, finalizada é duplicata, vencida é retomada uma vez só", () => {
    const agora = new Date("2026-09-11T23:10:00Z");
    const reserva = (detail: string | null, minutosAtras: number, outcome = "sdr_turn") =>
      ({ outcome, detail, reserved_at: new Date(agora.getTime() - minutosAtras * 60_000).toISOString() });

    // A edge morreu há 1 min: com 200 a Meta desistia e o áudio ficava preso até o próximo POST.
    expect(decidirReentrega(reserva(RESERVA_DO_AUDIO, 1), agora)).toBe("em_processamento");
    expect(decidirReentrega(reserva(RESERVA_DO_AUDIO, 6), agora)).toBe("retomar");
    // Retomada que também parou não é paga de novo: fica para a varredura.
    expect(decidirReentrega(reserva(RESERVA_RETOMADA, 6), agora)).toBe("em_processamento");
    expect(decidirReentrega(reserva(RESERVA_RETOMADA, 1), agora)).toBe("em_processamento");
    // Desfecho gravado, inclusive o turno do robô (sdr_turn sem o marcador).
    expect(decidirReentrega(reserva(null, 1), agora)).toBe("duplicata");
    expect(decidirReentrega(reserva("reserva fechada pela varredura: a mensagem já estava na conversa", 30), agora))
      .toBe("duplicata");
    expect(decidirReentrega(reserva("limite atingido", 1, "audio_falhou"), agora)).toBe("duplicata");
    expect(decidirReentrega(reserva(RESERVA_DO_AUDIO, 1, "agent_error"), agora)).toBe("duplicata");
  });

  it("a extensão segue o mime, com ogg (a nota de voz) no lugar do desconhecido", () => {
    expect(nomeDoAudio("audio/ogg; codecs=opus")).toBe("audio.ogg");
    expect(nomeDoAudio("audio/mpeg")).toBe("audio.mp3");
    expect(nomeDoAudio("audio/mp4")).toBe("audio.m4a");
    expect(nomeDoAudio(null)).toBe("audio.ogg");
  });
});
