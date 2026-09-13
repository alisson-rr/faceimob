type FunctionError = {
  name?: string;
  message?: string;
  context?: Response;
};

/** Extrai a mensagem JSON devolvida por uma Edge Function em respostas não-2xx. */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const functionError = error as FunctionError;

  try {
    const body = await functionError.context?.clone().json() as { error?: unknown; message?: unknown } | undefined;
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
    if (typeof body?.message === "string" && body.message.trim()) return body.message;
  } catch {
    // A resposta pode não ser JSON; aí vale o que vem abaixo.
  }

  // Erro do próprio SDK de functions (FunctionsHttpError/FetchError/RelayError)
  // traz frase em inglês ("Edge Function returned a non-2xx status code"), que
  // chegava crua ao toast. Nesse caso a frase de quem chamou, em pt-BR, é melhor.
  if (functionError.name?.startsWith("Functions")) return fallback;
  return functionError.message || fallback;
}
