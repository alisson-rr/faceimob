/**
 * Cliente da Marketing API da Meta (Graph), sem o cofre.
 *
 * As edge functions importam tudo de `metaAds.ts`, que reexporta daqui e junta o
 * token do cofre. A separação existe para o vitest carregar este arquivo:
 * `secrets.ts` importa o supabase-js por URL do Deno, e a paginação, a retirada
 * do token das URLs e a tradução dos erros precisam de teste. Único import:
 * `metaErros.ts`, que também é puro.
 *
 * Três garantias:
 *  1. Token SÓ no header Authorization. Nenhuma URL sai daqui com ele — nem a
 *     `paging.next` que a Meta devolve, que costuma trazer o token de volta na
 *     query. No sistema antigo o token ia parar em log por esse caminho.
 *  2. Paginação que não trunca em silêncio: passou do teto de páginas com
 *     `paging.next` ainda presente, lança. A sincronização apaga a janela antes
 *     de gravar os dias; receber só parte deles encolheria o gasto sem aviso.
 *  3. Erro da Meta vira `MetaApiError` com a frase de `descreverFalhaMeta`, e
 *     nenhuma URL entra na mensagem.
 */
import { descreverFalhaMeta } from "./metaErros.ts";

/**
 * Versão da Graph num lugar só.
 *
 * v25.0, e não a v21.0 do desenho: na tabela oficial de versões (lida em
 * 11/09/2026) a v21.0 da MARKETING API expirou em 09/09/2025, e chamada de
 * anúncio em versão expirada volta com o erro 2635. A v25.0 vale para a
 * Marketing API (sem data de fim publicada) e para a Graph comum até 29/07/2028,
 * então serve também ao WhatsApp e ao Lead Ads. Trocar é esta linha.
 */
export const META_GRAPH = "https://graph.facebook.com/v25.0";

const ORIGEM_GRAPH = new URL(META_GRAPH).origin;
const TIMEOUT_MS = 30_000;

/**
 * Falha de uma chamada à Meta, com a frase pronta em `message`.
 * `status` 0 = sem resposta (tempo esgotado ou rede); `code`/`subcode` são os
 * da Graph, quando a Meta os mandou.
 */
export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * Ids da Graph (`123`, `act_123`) e arestas (`insights`, `me/adaccounts`).
 * Qualquer outra coisa é recusada: um external_id digitado com `?` ou `..`
 * mudaria a chamada, e o URL resolve `..` mesmo codificado.
 */
const CAMINHO = /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/;

/** `act_123`, a partir de `123` ou `act_123`. O valor vira caminho de URL e o
 *  banco só aceita '^act_[0-9]+$', então o resto é recusado. */
export function actId(id: string): string {
  const digitos = id.trim().replace(/^act_/, "");
  if (!/^\d+$/.test(digitos)) {
    throw new Error("Id de conta de anúncios inválido: esperado act_ seguido de números.");
  }
  return `act_${digitos}`;
}

/** A URL sem o token, e só se for da própria Graph: o header com o token nunca
 *  segue um link para outro lugar. */
function semToken(url: URL): string {
  if (url.origin !== ORIGEM_GRAPH) throw new Error("A Meta devolveu um link de página fora da Graph API.");
  url.searchParams.delete("access_token");
  return url.toString();
}

function montarUrl(path: string, params: Record<string, string>): string {
  const limpo = path.replace(/^\/+/, "");
  if (!CAMINHO.test(limpo)) throw new Error("Caminho da Graph inválido: só ids e arestas da Meta.");
  const url = new URL(`${META_GRAPH}/${limpo}`);
  for (const [chave, valor] of Object.entries(params)) url.searchParams.set(chave, valor);
  return semToken(url);
}

function proximaPagina(next: string): string {
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    throw new Error("A Meta devolveu um link de próxima página inválido.");
  }
  return semToken(url);
}

const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};

async function pedir(url: string, token: string, form?: URLSearchParams): Promise<unknown> {
  const escrita = form !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: escrita ? "POST" : "GET",
      headers: escrita
        ? { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }
        : { Authorization: `Bearer ${token}` },
      body: form?.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // A mensagem original do fetch pode trazer a URL; a nossa não traz.
    const expirou = (e as { name?: string } | null)?.name === "TimeoutError";
    throw new MetaApiError(
      (expirou ? "A Meta não respondeu em 30 s." : "Não consegui falar com a Meta (falha de rede).") +
        // Sem resposta não prova que nada mudou: o POST pode ter chegado.
        (escrita ? " O pedido pode ter sido aplicado mesmo assim: confira no Gerenciador de Anúncios antes de repetir." : ""),
      0,
    );
  }

  const corpo: unknown = await res.json().catch(() => null);
  const erro = (corpo as { error?: { code?: unknown; error_subcode?: unknown } } | null)?.error;
  if (!res.ok || corpo === null || erro) {
    throw new MetaApiError(
      corpo === null ? `A Meta respondeu ${res.status} sem detalhe legível.` : descreverFalhaMeta(corpo, "anuncios"),
      res.status,
      numero(erro?.code),
      numero(erro?.error_subcode),
    );
  }
  return corpo;
}

export async function metaGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  return (await pedir(montarUrl(path, params), token)) as T;
}

/**
 * Todas as páginas de uma aresta paginada.
 *
 * Passou de `maxPages` com `paging.next` ainda presente: LANÇA. Devolver o que
 * veio até ali faria a sincronização apagar a janela e gravar só parte dos dias.
 */
export async function metaGetAll<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  maxPages = 50,
): Promise<T[]> {
  const itens: T[] = [];
  let url: string | null = montarUrl(path, params);
  for (let pagina = 1; url; pagina++) {
    if (pagina > maxPages) {
      throw new Error(
        `A Meta tem mais de ${maxPages} páginas para esta consulta e a leitura parou para não gravar um período pela metade. Peça um período menor.`,
      );
    }
    const corpo = (await pedir(url, token)) as { data?: unknown; paging?: { next?: unknown } };
    // Lista ausente não vira lista vazia: seria "nenhuma campanha" inventado.
    if (!Array.isArray(corpo.data)) throw new Error("A Meta devolveu uma página sem a lista de dados.");
    itens.push(...(corpo.data as T[]));
    const next = corpo.paging?.next;
    url = typeof next === "string" && next ? proximaPagina(next) : null;
  }
  return itens;
}

/** POST x-www-form-urlencoded, token no header. Devolve o corpo da Meta. */
export async function metaPost(path: string, form: Record<string, string>, token: string): Promise<unknown> {
  const corpo = new URLSearchParams(form);
  corpo.delete("access_token");
  return await pedir(montarUrl(path, {}), token, corpo);
}
