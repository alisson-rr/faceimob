import { getSecret } from "./secrets.ts";

/**
 * Porta de entrada da Marketing API para as edge functions: o cliente
 * (`metaGraph.ts`, puro e testado no vitest) mais o token, que vem do cofre.
 *
 * Token: par meta/marketing_access_token (`META_MARKETING_ACCESS_TOKEN`), um
 * token de usuário de sistema com ads_read e ads_management. O cliente só o
 * coloca no header Authorization — nunca em URL nem em log.
 */
export { actId, META_GRAPH, MetaApiError, metaGet, metaGetAll, metaPost } from "./metaGraph.ts";

/** O token, ou `null` quando não há nem no cofre nem no ambiente. Quem chama
 *  responde 409 com a frase, em vez de chamar a Meta sem credencial. */
export async function metaToken(): Promise<string | null> {
  return await getSecret("META_MARKETING_ACCESS_TOKEN");
}
