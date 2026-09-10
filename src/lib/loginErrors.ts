/**
 * Por que a entrada falhou — separado da tela para poder ser testado.
 *
 * O ramo que importa é `rede`. Sem ele, uma falha de conexão caía no genérico
 * e o /login dizia "E-mail ou senha inválidos" (ou "Código inválido") para
 * quem tinha digitado a credencial CERTA: a pessoa troca a senha, pede outro
 * código, e nada disso é o problema. O GoTrue nem chegou a responder.
 *
 * O supabase-js embrulha falha de rede em `AuthRetryableFetchError`, com
 * `status` 0 quando o `fetch` nem saiu. 5xx entra no mesmo balde de propósito:
 * "o servidor não respondeu" é a mesma orientação para quem está na tela, e
 * nenhum dos dois casos diz nada sobre a credencial.
 *
 * A distinção entre `credencial` e "e-mail não cadastrado" continua NÃO
 * existindo: é ela que impede o /login de virar um verificador de quem
 * trabalha aqui.
 */
export type LoginFailure = "rede" | "rate" | "bloqueado" | "nao_confirmado" | "credencial";

type AuthErrorLike = {
  name?: string;
  status?: number;
  code?: string | null;
  message?: string | null;
};

export function classifyLoginError(error: AuthErrorLike | null | undefined): LoginFailure {
  if (!error) return "credencial";

  const status = typeof error.status === "number" ? error.status : null;
  const texto = `${error.name ?? ""} ${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();

  // Primeiro, porque uma falha de rede pode carregar qualquer texto (ou nenhum)
  // e não pode ser lida como recusa de credencial.
  if (
    error.name === "AuthRetryableFetchError" ||
    status === 0 ||
    (status !== null && status >= 500) ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet/.test(texto)
  ) {
    return "rede";
  }

  if (/rate|too many|seconds/.test(texto)) return "rate";
  if (/banned|blocked|disabled/.test(texto)) return "bloqueado";
  if (/not confirmed|not_confirmed/.test(texto)) return "nao_confirmado";
  return "credencial";
}
