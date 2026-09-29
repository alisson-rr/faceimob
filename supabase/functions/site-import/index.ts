import { requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { getSecret } from "../_shared/secrets.ts";

/**
 * Cópia do site (Lovable Cloud) para o schema `site` deste banco
 * (docs/migracao-site.md, etapa 2).
 *
 * Puxa da rota de exportação do site — só leitura, protegida pelo token
 * combinado — e grava pelas RPCs `site_import_*`, que só a service role chama.
 * Cada chamada faz um pedaço (uma página de tabela, um lote de arquivos) para
 * caber no tempo da edge function; a tela repete até acabar. Repetir não
 * duplica: tudo é upsert pela chave primária, e arquivo é regravado no mesmo
 * caminho.
 *
 * Porta: `settings.integrations` (administrador e sócio), a mesma do cofre.
 * Nada aqui apaga dado, nem no site nem no CRM.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKETS = ["property-images", "property-docs", "campaign-images", "blog-images", "support-docs"];
const ARQUIVOS_POR_LOTE = 25;
const ARQUIVOS_EM_PARALELO = 5;
// Arquivo grande vai sozinho: cinco vídeos juntos não cabem numa chamada.
const BYTES_POR_GRUPO = 8 * 1024 * 1024;
// A chamada inteira precisa voltar antes do tempo do gateway (~60 s): depois
// de PRAZO nenhum grupo novo começa, e em CORTE os downloads em curso param.
// O que parou é refeito na próxima chamada; a tela continua de onde parou.
const PRAZO_DO_LOTE_MS = 15_000;
const CORTE_DA_CHAMADA_MS = 40_000;

type Pedido =
  | { action: "status" }
  | { action: "usuarios" }
  | { action: "tabela"; nome: string; pagina: number }
  | { action: "arquivos"; bucket: string; de: number };

function lerPedido(body: unknown): Pedido | null {
  const b = body as Record<string, unknown> | null;
  if (b?.action === "status" || b?.action === "usuarios") return { action: b.action };
  if (b?.action === "tabela" && typeof b.nome === "string" && /^[a-z_]{1,40}$/.test(b.nome)
      && Number.isInteger(b.pagina) && (b.pagina as number) >= 0) {
    return { action: "tabela", nome: b.nome, pagina: b.pagina as number };
  }
  if (b?.action === "arquivos" && typeof b.bucket === "string" && BUCKETS.includes(b.bucket)
      && Number.isInteger(b.de) && (b.de as number) >= 0) {
    return { action: "arquivos", bucket: b.bucket, de: b.de as number };
  }
  return null;
}

class FalhaNoSite extends Error {}

/** Um pedido à rota de exportação do site. Token só no header; URL nunca vai para log. */
async function doSite<T>(base: string, token: string, query: Record<string, string>, corpo?: unknown): Promise<T> {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: corpo === undefined ? "GET" : "POST",
      headers: { "x-migracao-token": token, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new FalhaNoSite("O site não respondeu (rede ou tempo esgotado).");
  }
  if (res.status === 404) {
    throw new FalhaNoSite(
      "O site não achou a exportação: ou a versão com a rota ainda não foi publicada no Lovable (Publish → Update), ou falta o secret MIGRACAO_TOKEN.",
    );
  }
  if (res.status === 401) throw new FalhaNoSite("O token do cofre não é o mesmo do secret MIGRACAO_TOKEN do Lovable.");
  if (!res.ok) {
    // A rota devolve o motivo (tabela ou etapa e a mensagem do banco) para
    // quem tem o token; sem ele, "HTTP 500" não diz o que corrigir.
    const corpo = await res.json().catch(() => null) as { recurso?: unknown; detalhe?: unknown } | null;
    const detalhe = typeof corpo?.detalhe === "string" ? corpo.detalhe.slice(0, 300) : null;
    const etapa = typeof corpo?.recurso === "string" ? corpo.recurso : query.recurso ?? "links";
    throw new FalhaNoSite(
      `O site falhou ao ler (${etapa}, HTTP ${res.status})${detalhe ? `: ${detalhe}` : "."}`,
    );
  }
  return await res.json() as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const gate = await requireUserPermission(req, "settings.integrations", corsHeaders as unknown as Headers);
  if (gate.denied) return gate.denied;

  const pedido = lerPedido(await req.json().catch(() => null));
  if (!pedido) return json({ error: "Pedido inválido." }, 422);

  const [base, token] = await Promise.all([getSecret("SITE_MIGRACAO_URL"), getSecret("SITE_MIGRACAO_TOKEN")]);
  if (!base || !token) {
    return json({ error: "Cadastre em Integrações o endereço e o token da exportação do site." }, 409);
  }
  if (!base.startsWith("https://")) return json({ error: "O endereço da exportação precisa ser https." }, 409);

  const db = serviceClient();

  try {
    if (pedido.action === "status") {
      const [fonte, destino, mapa] = await Promise.all([
        doSite<{ tabelas: Record<string, number>; buckets: { id: string; public: boolean }[] }>(base, token, { recurso: "contagem" }),
        db.rpc("site_import_contagem"),
        db.rpc("site_import_sem_par"),
      ]);
      if (destino.error) throw destino.error;
      return json({
        fonte,
        destino: destino.data,
        // Sem par no CRM: a lista que o admin resolve antes da virada.
        sem_par: mapa.error ? null : mapa.data,
      });
    }

    if (pedido.action === "usuarios") {
      let resumo: unknown = null;
      for (let pagina = 0; pagina < 500; pagina++) {
        const lote = await doSite<{ usuarios: unknown[]; ultima: boolean }>(base, token, { recurso: "usuarios", pagina: String(pagina) });
        const { data, error } = await db.rpc("site_import_usuarios", { p_usuarios: lote.usuarios });
        if (error) throw error;
        resumo = data;
        if (lote.ultima) break;
      }
      return json({ ok: true, resumo });
    }

    if (pedido.action === "tabela") {
      const lote = await doSite<{ linhas: unknown[]; ultima: boolean }>(base, token, {
        recurso: "tabela", nome: pedido.nome, pagina: String(pedido.pagina),
      });
      const { data, error } = await db.rpc("site_import_linhas", { p_tabela: pedido.nome, p_linhas: lote.linhas });
      if (error) throw error;
      return json({ ok: true, resultado: data, ultima: lote.ultima });
    }

    // Arquivos: um lote por chamada, mesmo caminho do site. O site que já
    // pagina (`de`/`limite`, devolvendo `total`) manda só o lote; o anterior
    // manda a lista inteira e o recorte é feito aqui.
    const inicio = Date.now();
    const listagem = await doSite<{ arquivos: { caminho: string; tamanho: number; tipo: string | null }[]; total?: number }>(
      base, token, { recurso: "arquivos", bucket: pedido.bucket, de: String(pedido.de), limite: String(ARQUIVOS_POR_LOTE) },
    );
    const paginado = typeof listagem.total === "number";
    const total = paginado ? listagem.total as number : listagem.arquivos.length;
    const lote = paginado
      ? listagem.arquivos.slice(0, ARQUIVOS_POR_LOTE)
      : listagem.arquivos.slice(pedido.de, pedido.de + ARQUIVOS_POR_LOTE);
    if (pedido.de === 0) {
      const { buckets } = await doSite<{ buckets: { id: string; public: boolean }[] }>(base, token, { recurso: "contagem" });
      const origem = buckets.find((b) => b.id === pedido.bucket);
      if (origem) {
        const { error } = await db.storage.updateBucket(pedido.bucket, { public: origem.public });
        if (error) throw error;
      }
    }
    const falhas: string[] = [];
    let feitos = 0;
    if (lote.length) {
      const { links } = await doSite<{ links: { caminho: string; url: string | null }[] }>(
        base, token, {}, { bucket: pedido.bucket, caminhos: lote.map((a) => a.caminho) },
      );
      const corte = AbortSignal.timeout(Math.max(1_000, CORTE_DA_CHAMADA_MS - (Date.now() - inicio)));
      /** `false` = cortado pelo tempo da chamada: não conta como feito nem como falha. */
      const copiar = async (arquivo: { caminho: string; tamanho: number; tipo: string | null }): Promise<boolean> => {
        const link = links.find((l) => l.caminho === arquivo.caminho)?.url;
        try {
          if (!link) throw new Error("sem link");
          const res = await fetch(link, { signal: corte });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (arquivo.tamanho && blob.size !== arquivo.tamanho) throw new Error("tamanho diferente");
          const { error } = await db.storage.from(pedido.bucket).upload(arquivo.caminho, blob, {
            upsert: true, contentType: arquivo.tipo ?? undefined,
          });
          if (error) throw error;
          return true;
        } catch (e) {
          if (corte.aborted) return false;
          falhas.push(`${arquivo.caminho}: ${e instanceof Error ? e.message : "falhou"}`);
          return true;
        }
      };
      while (feitos < lote.length && (feitos === 0 || Date.now() - inicio < PRAZO_DO_LOTE_MS)) {
        const grupo = [lote[feitos]];
        let bytes = lote[feitos].tamanho;
        while (grupo.length < ARQUIVOS_EM_PARALELO && feitos + grupo.length < lote.length
               && bytes + lote[feitos + grupo.length].tamanho <= BYTES_POR_GRUPO) {
          bytes += lote[feitos + grupo.length].tamanho;
          grupo.push(lote[feitos + grupo.length]);
        }
        const concluidos = await Promise.all(grupo.map(copiar));
        const cortado = concluidos.indexOf(false);
        if (cortado === -1) {
          feitos += grupo.length;
          continue;
        }
        // Um arquivo que sozinho não cabe numa chamada iria travar a cópia
        // para sempre: vira falha (com o tamanho) e a cópia segue.
        if (feitos === 0 && cortado === 0) {
          const mb = (grupo[0].tamanho / 1024 / 1024).toFixed(1);
          falhas.push(`${grupo[0].caminho}: grande demais para copiar por aqui (${mb} MB)`);
          feitos = 1;
        } else {
          feitos += cortado;
        }
        break;
      }
    }
    const proximo = pedido.de + feitos;
    return json({
      ok: falhas.length === 0,
      total,
      proximo,
      ultima: proximo >= total,
      falhas,
    });
  } catch (e) {
    if (e instanceof FalhaNoSite) return json({ error: e.message }, 502);
    const msg = (e as { message?: string } | null)?.message ?? "erro";
    console.error("site-import falhou", pedido.action, msg);
    return json({ error: msg }, 500);
  }
});
