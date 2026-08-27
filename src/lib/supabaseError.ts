/**
 * Erro do Postgres → frase em pt-BR.
 *
 * O `message` cru do Postgres vem em inglês e cita tabela, coluna e constraint
 * ("permission denied for table leads", "duplicate key value violates unique
 * constraint leads_document_key"). Jogar isso num toast entrega o schema a quem
 * estiver olhando a tela e não diz ao corretor o que fazer. Aqui a tradução é
 * por `code`; quando o código não é conhecido, vale o `fallback` da tela — nunca
 * a mensagem crua.
 *
 * A exceção são os códigos que as nossas próprias funções levantam (`P0001`,
 * `P0002`): a mensagem foi escrita em pt-BR na migration e é justamente o que o
 * usuário precisa ler ("Lead já convertido no negócio X.").
 */

type DbErrorLike = { code?: string | null; message?: string | null };

const BY_CODE: Record<string, string> = {
  "23505": "Já existe um registro com esses dados.",
  "23503": "Existe outro registro ligado a este; desfaça o vínculo antes.",
  "22P02": "Um dos campos está em formato inválido.",
  "23514": "Um dos campos está fora do valor permitido.",
  "42501": "Você não tem permissão para esta ação.",
};

/** Códigos das nossas `raise exception`: a mensagem já está em pt-BR. */
const OWN_MESSAGE = new Set(["P0001", "P0002"]);

/**
 * Empacota o erro do Postgres num `Error` mantendo o objeto original acessível.
 * A mensagem completa (com rótulo) fica para o log; a tela usa `describeError`.
 */
export function dbError(label: string, error: DbErrorLike): Error {
  const err = new Error(`${label}: ${error.message || "falha ao consultar o banco"}`);
  (err as Error & { db?: DbErrorLike }).db = error;
  return err;
}

export function describeError(error: unknown, fallback: string): string {
  const source = unwrap(error);
  const code = typeof source?.code === "string" ? source.code : null;
  if (!code) return fallback;
  if (OWN_MESSAGE.has(code)) return source?.message?.trim() || fallback;
  return BY_CODE[code] ?? fallback;
}

function unwrap(error: unknown): DbErrorLike | null {
  if (!error || typeof error !== "object") return null;
  return (error as { db?: DbErrorLike }).db ?? (error as DbErrorLike);
}
