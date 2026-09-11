import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";

export type AvisoAprendizado = { variacao: number | null; verba_atual: number | null; verba_nova: number | null };
export type RespostaAcaoMeta =
  | { tipo: "feito"; status: string; erro: string | null }
  | { tipo: "aprendizado"; aviso: AvisoAprendizado }
  | { tipo: "falha"; mensagem: string };

/**
 * Chama o executor único (`meta-campaign-action`), que atende a ação manual e
 * a decisão da fila do gestor IA. O 409 'aprendizado' volta como aviso, não
 * como falha; 200 sem status não vira sucesso na tela (`semStatus`).
 */
export async function invocarAcaoMeta(body: Record<string, unknown>, semStatus: string): Promise<RespostaAcaoMeta> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; status?: string; error?: string }>(
    "meta-campaign-action",
    { body },
  );
  if (error) {
    const resposta = (error as { context?: Response }).context;
    if (resposta?.status === 409) {
      const corpo = (await resposta.clone().json().catch(() => null)) as (AvisoAprendizado & { code?: string }) | null;
      if (corpo?.code === "aprendizado") {
        return {
          tipo: "aprendizado",
          aviso: { variacao: corpo.variacao ?? null, verba_atual: corpo.verba_atual ?? null, verba_nova: corpo.verba_nova ?? null },
        };
      }
    }
    return { tipo: "falha", mensagem: await functionErrorMessage(error, "Não foi possível falar com a Meta.") };
  }
  if (data?.ok && data.status) return { tipo: "feito", status: data.status, erro: data.error ?? null };
  return { tipo: "falha", mensagem: semStatus };
}
