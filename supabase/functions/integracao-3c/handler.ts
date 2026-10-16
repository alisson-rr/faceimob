export type ApiResult = { status: number; body: Record<string, unknown> };
export type ThreeCRpc = (token: string, operation: string, data: Record<string, unknown>) => Promise<ApiResult>;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};
const json = ({ status, body }: ApiResult) => new Response(JSON.stringify(body), { status, headers });
const failure = (status: number, erro: string, mensagem: string) => json({ status, body: { erro, mensagem } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function timestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) return false;
  const [, y, mo, d, h, mi, sec = "0"] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() + 1 === Number(mo)
    && date.getUTCDate() === Number(d) && Number(h) < 24 && Number(mi) < 60 && Number(sec) < 60;
}

function validate(data: Record<string, unknown>, allowed: string[], required: string[] = []): string | null {
  if (Object.keys(data).some((key) => !allowed.includes(key))) return "Há campos não aceitos nesta operação.";
  if (required.some((key) => !(key in data))) return "Faltam campos obrigatórios.";
  for (const [key, value] of Object.entries(data)) {
    if (["id", "lead_id", "agenda_id"].includes(key)) {
      if (typeof value !== "string" || !uuid.test(value)) return `Informe ${key} válido.`;
    } else if (["inicio", "fim", "data"].includes(key)) {
      if (!timestamp(value)) return `Informe ${key} em ISO 8601 com fuso explícito.`;
      // ISO 8601 permite omitir segundos; o contrato interno do banco os recebe explícitos.
      data[key] = (value as string).replace(/(T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, "$1:00$2");
    } else if (["duracao_min", "duracao_seg"].includes(key)) {
      const max = key === "duracao_min" ? 2147483647 : 86400;
      if (typeof value !== "number" || !Number.isInteger(value) || value < (key === "duracao_seg" ? 0 : 1) || value > max) {
        return `Informe ${key} válido.`;
      }
    } else if (key === "dados_adicionais") {
      if (!isObject(value)) return "dados_adicionais deve ser um objeto JSON.";
    } else if (key === "telefone") {
      if (typeof value !== "string" || value.length > 40 || !/^[+\d().\s-]+$/.test(value)
        || !/^\d{10,15}$/.test(value.replace(/\D/g, ""))) return "Informe telefone com DDI e DDD.";
    } else if (key === "email") {
      if (value !== null && (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
        return "Informe e-mail válido ou null.";
      }
    } else {
      const max = ["observacao", "resumo"].includes(key) ? 10000
        : ["nome", "titulo"].includes(key) ? 200 : key === "origem" ? 100 : 64;
      if (value === null && key === "observacao") continue;
      if (typeof value !== "string" || !value.trim() || value.length > max) return `Informe ${key} válido (até ${max} caracteres).`;
    }
  }
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) return null;
  if (Number(req.headers.get("content-length")) > 65536) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** Transporte REST; autenticação fresca, autorização e transações ficam na RPC restrita. */
export async function handleRequest(req: Request, rpc: ThreeCRpc): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const token = /^Bearer\s+(\S{1,512})$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return failure(401, "CHAVE_INVALIDA", "Chave ausente ou inválida.");
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(?:functions\/v1\/)?integracao-3c(?=\/|$)/, "").replace(/\/$/, "") || "/";
  let operation: string;
  let data: Record<string, unknown> = {};
  const leadPath = /^\/leads\/([^/]+)(\/ligacoes)?$/.exec(path);
  const leadFields = ["nome", "telefone", "email", "etapa_id", "observacao", "dados_adicionais"];

  if (req.method === "GET") {
    const params = [...url.searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length) {
      return failure(400, "DADOS_INVALIDOS", "Não repita parâmetros da consulta.");
    }
    data = Object.fromEntries(params);
    let invalid: string | null = null;
    if (path === "/leads") {
      operation = "buscar_lead";
      if (params.length !== 1) invalid = "Use exatamente um filtro: telefone, email ou id.";
      invalid ??= validate(data, ["telefone", "email", "id"]);
    } else if (path === "/agenda/disponibilidade") {
      operation = "disponibilidade";
      if (typeof data.duracao_min === "string" && /^\d{1,10}$/.test(data.duracao_min)) data.duracao_min = Number(data.duracao_min);
      invalid = validate(data, ["inicio", "fim", "duracao_min", "agenda_id"], ["inicio", "fim", "duracao_min"]);
    } else if (path === "/etapas" || path === "/agendas") {
      operation = path === "/etapas" ? "etapas" : "agendas";
      invalid = validate(data, []);
    } else return failure(404, "ROTA_INEXISTENTE", "Operação não encontrada.");
    if (invalid) return failure(400, "DADOS_INVALIDOS", invalid);
  } else if (req.method === "POST" || req.method === "PATCH") {
    if (url.search) return failure(400, "DADOS_INVALIDOS", "Envie os campos no corpo JSON.");
    const parsed = await readBody(req);
    if (!parsed) return failure(400, "DADOS_INVALIDOS", "Envie um objeto JSON válido de até 64 KiB.");
    data = parsed;
    let invalid: string | null;
    if (path === "/leads" && req.method === "POST") {
      operation = "criar_lead";
      invalid = validate(data, [...leadFields, "origem"], ["nome", "telefone"]);
    } else if (leadPath && req.method === "PATCH" && !leadPath[2]) {
      operation = "atualizar_lead";
      invalid = Object.keys(data).length ? validate(data, leadFields) : "Envie ao menos um campo para atualizar.";
    } else if (leadPath?.[2] && req.method === "POST") {
      operation = "registrar_ligacao";
      invalid = validate(data, ["data", "duracao_seg", "desfecho", "resumo"], ["data", "duracao_seg", "desfecho", "resumo"]);
    } else if (path === "/agenda/eventos" && req.method === "POST") {
      operation = "criar_evento";
      invalid = validate(data, ["lead_id", "agenda_id", "inicio", "fim", "tipo", "titulo", "observacao", "origem"],
        ["lead_id", "agenda_id", "inicio", "fim", "tipo", "titulo", "origem"]);
    } else return failure(405, "METODO_NAO_PERMITIDO", "Método não permitido nesta rota.");
    if (invalid) return failure(400, "DADOS_INVALIDOS", invalid);
    if (leadPath) {
      if (!uuid.test(leadPath[1])) return failure(400, "DADOS_INVALIDOS", "Informe id válido.");
      data.id = leadPath[1];
    }
    const key = req.headers.get("idempotency-key");
    if (key !== null) {
      if (!["criar_evento", "registrar_ligacao"].includes(operation) || !/^[\x21-\x7e]{1,128}$/.test(key)) {
        return failure(400, "DADOS_INVALIDOS", "Idempotency-Key deve ter de 1 a 128 caracteres e ser usada em eventos ou ligações.");
      }
      data._idempotency_key = key;
    }
  } else return failure(405, "METODO_NAO_PERMITIDO", "Método não permitido nesta rota.");

  try {
    const result = await rpc(token, operation, data);
    if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599 || !isObject(result.body)) {
      return failure(500, "ERRO_INTERNO", "Não foi possível concluir a operação.");
    }
    return json(result);
  } catch {
    return failure(500, "ERRO_INTERNO", "Não foi possível concluir a operação.");
  }
}
