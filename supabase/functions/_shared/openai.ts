import { DEFAULT_OPENAI_MODEL } from "./sdrAgent.ts";
import { requireSecret } from "./secrets.ts";

/**
 * As chamadas de IA do marketing (nota por anúncio, gestor de tráfego,
 * planejador) e a transcrição dos áudios do WhatsApp — num lugar só.
 *
 * Mesma chave e mesmo lugar no cofre que o SDR já usa (openai/api_key): nenhuma
 * credencial nova. Custo previsível: teto de tokens obrigatório, timeout e
 * NENHUMA nova tentativa automática — quem chama decide, e a falha aparece como
 * falha. `sdrAgent.ts` não passa por aqui (continua com a própria chamada).
 */

export const MODELO_IA_MARKETING = DEFAULT_OPENAI_MODEL;
export const MODELO_TRANSCRICAO = "gpt-4o-mini-transcribe";

const OPENAI = "https://api.openai.com/v1";

type RespostaOpenAI = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  text?: unknown;
  error?: { message?: string };
};

async function pedir(
  caminho: string,
  body: string | FormData,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RespostaOpenAI> {
  const chave = await requireSecret("OPENAI_API_KEY");
  let res: Response;
  try {
    res = await fetch(`${OPENAI}${caminho}`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${chave}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const expirou = (e as { name?: string } | null)?.name === "TimeoutError";
    throw new Error(expirou ? `A OpenAI não respondeu em ${timeoutMs / 1000} s.` : "Não consegui falar com a OpenAI (falha de rede).");
  }
  const corpo = (await res.json().catch(() => ({}))) as RespostaOpenAI;
  // O texto do 401 repete parte da chave: não vai para a tela nem para o banco.
  if (res.status === 401) throw new Error("A OpenAI recusou a chave de API (401). Confira a chave em Admin → Integrações.");
  if (!res.ok) throw new Error(`A OpenAI recusou (${res.status}): ${corpo.error?.message ?? "sem detalhe"}`.slice(0, 400));
  return corpo;
}

/**
 * Uma chamada que devolve um objeto JSON. response_format json_object,
 * temperature 0.2, timeout de 45 s. Lança em JSON inválido ou cortado pelo teto
 * — nunca devolve objeto vazio no lugar da resposta.
 */
export async function chatJson<T>(p: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<{ data: T; model: string; tokensIn: number; tokensOut: number }> {
  if (!Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > 16_000) {
    throw new Error("maxTokens precisa ser um inteiro entre 1 e 16.000.");
  }
  // O modo json_object recusa (400) a conversa que não cita "JSON".
  const system = /json/i.test(p.system + p.user) ? p.system : `${p.system}\n\nResponda só com um objeto JSON.`;
  const corpo = await pedir(
    "/chat/completions",
    JSON.stringify({
      model: MODELO_IA_MARKETING,
      messages: [
        { role: "system", content: system },
        { role: "user", content: p.user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_completion_tokens: p.maxTokens,
    }),
    { "Content-Type": "application/json" },
    45_000,
  );

  const escolha = corpo.choices?.[0];
  let data: unknown;
  try {
    data = JSON.parse(escolha?.message?.content ?? "");
  } catch {
    data = undefined;
  }
  if (data === null || typeof data !== "object") {
    throw new Error(
      escolha?.finish_reason === "length"
        ? "A resposta da IA passou do teto de tokens e veio cortada."
        : "A IA não devolveu um objeto JSON válido.",
    );
  }
  return {
    data: data as T,
    model: corpo.model ?? MODELO_IA_MARKETING,
    tokensIn: corpo.usage?.prompt_tokens ?? 0,
    tokensOut: corpo.usage?.completion_tokens ?? 0,
  };
}

/**
 * Texto de um áudio em português. Uma chamada, timeout de 60 s. Lança em áudio
 * vazio (sem gastar a chamada) e em transcrição vazia. O teto de tamanho fica
 * em quem baixa a mídia (`downloadWhatsAppMedia`), que é por onde os bytes entram.
 */
export async function transcreverAudio(audio: Blob, filename: string): Promise<string> {
  if (audio.size === 0) throw new Error("Áudio vazio: nada para transcrever.");
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", MODELO_TRANSCRICAO);
  form.append("language", "pt");
  form.append("response_format", "json");
  const corpo = await pedir("/audio/transcriptions", form, {}, 60_000);
  const texto = typeof corpo.text === "string" ? corpo.text.trim() : "";
  if (!texto) throw new Error("A transcrição do áudio voltou vazia.");
  return texto;
}
