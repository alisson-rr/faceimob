import { dbError } from "@/lib/supabaseError";

/**
 * Rejeita se `promessa` não terminar em `ms`, com `mensagem` para a tela.
 *
 * Existe porque o upload e as RPCs não têm prazo: um envio que a rede deixa
 * pendurado deixava o botão girando para sempre ("converter lead com doc ficou
 * carregando", 29/09/2026). O prazo não cancela o que já saiu — só devolve a
 * tela à pessoa com um motivo e um caminho.
 */
export function comPrazo<T>(promessa: Promise<T>, ms: number, mensagem: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(dbError("prazo esgotado", { code: "P0001", message: mensagem })), ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(timer));
}
