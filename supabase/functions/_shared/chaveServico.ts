/**
 * Prova de que quem chama tem a chave de serviço: o token é IGUAL a uma das
 * chaves configuradas. Sem Deno, para o vitest alcançar.
 *
 * Não existe aqui "JWT que se diz service_role". Ler o papel do payload sem
 * conferir a assinatura aceitava token forjado nas functions com
 * `verify_jwt = false` (meta-ads-webhook), onde o gateway não confere nada.
 */

/** O laço anda pelo comprimento da CHAVE: o token não decide quantas voltas
 *  ele dá — nem por prefixo acertado, nem por ser mais curto ou mais longo. */
function igualEmTempoConstante(token: string, chave: string): boolean {
  let diff = token.length ^ chave.length;
  // Além do fim do token, charCodeAt dá NaN, que o XOR lê como 0; a diferença
  // de comprimento já ficou marcada acima.
  for (let i = 0; i < chave.length; i++) diff |= token.charCodeAt(i) ^ chave.charCodeAt(i);
  return diff === 0;
}

export function tokenEhChaveDeServico(
  token: string,
  chaves: ReadonlyArray<string | null | undefined>,
): boolean {
  if (!token) return false;
  let ok = false;
  for (const chave of chaves) {
    // Chave ausente ou vazia não casa com nada. Sem curto-circuito entre as
    // chaves: todas são comparadas, tenha a primeira casado ou não.
    if (chave) ok = igualEmTempoConstante(token, chave) || ok;
  }
  return ok;
}
