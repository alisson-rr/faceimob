type FunctionError = {
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
    // A resposta pode não ser JSON; nesse caso usamos a mensagem do SDK.
  }

  return functionError.message || fallback;
}
