/**
 * Anúncio da Graph → linha de `meta_anuncios` (0265). Puro: sem rede nem banco.
 *
 * A copy e a arte moram em lugares diferentes conforme o tipo do criativo:
 * imagem e link em `object_story_spec.link_data`, vídeo em `video_data`,
 * carrossel em `link_data.child_attachments`, e criativo dinâmico em
 * `asset_feed_spec`. Os campos de topo (`body`, `title`, `image_url`) vêm
 * primeiro quando existem.
 */

export type GraphAnuncio = {
  id?: unknown;
  name?: unknown;
  effective_status?: unknown;
  preview_shareable_link?: unknown;
  campaign?: { id?: unknown; name?: unknown } | null;
  creative?: {
    object_type?: unknown;
    title?: unknown;
    body?: unknown;
    image_url?: unknown;
    thumbnail_url?: unknown;
    video_id?: unknown;
    object_story_spec?: {
      link_data?: {
        message?: unknown;
        name?: unknown;
        picture?: unknown;
        child_attachments?: Array<{ picture?: unknown; image_url?: unknown }> | null;
      } | null;
      video_data?: { message?: unknown; title?: unknown; image_url?: unknown; video_id?: unknown } | null;
    } | null;
    asset_feed_spec?: {
      bodies?: Array<{ text?: unknown }> | null;
      titles?: Array<{ text?: unknown }> | null;
      videos?: Array<{ thumbnail_url?: unknown }> | null;
    } | null;
  } | null;
};

export type LinhaAnuncio = {
  ad_id: string;
  nome: string | null;
  campanha_id: string | null;
  campanha_nome: string | null;
  status: string | null;
  formato: "imagem" | "video" | "carrossel";
  copy: string | null;
  titulo: string | null;
  imagem_meta_url: string | null;
  imagens_meta: string[];
  preview_url: string | null;
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Só https: a arte vira download e `<img>` — nada de `javascript:` nem http. */
const link = (v: unknown): string | null => {
  const t = texto(v);
  return t && /^https:\/\//i.test(t) ? t : null;
};
const primeiro = (...v: unknown[]) => v.map(texto).find((t) => t !== null) ?? null;
const primeiroLink = (...v: unknown[]) => v.map(link).find((t) => t !== null) ?? null;

/** `null` quando o anúncio não tem id numérico: não há o que gravar. */
export function montarAnuncio(ad: GraphAnuncio): LinhaAnuncio | null {
  const id = texto(ad.id);
  if (!id || !/^\d+$/.test(id)) return null;
  const c = ad.creative ?? {};
  const linkData = c.object_story_spec?.link_data ?? null;
  const videoData = c.object_story_spec?.video_data ?? null;
  const feed = c.asset_feed_spec ?? null;

  const filhos = (linkData?.child_attachments ?? [])
    .map((f) => primeiroLink(f?.picture, f?.image_url))
    .filter((u): u is string => u !== null)
    .slice(0, 10);
  const video = texto(c.video_id) !== null || texto(videoData?.video_id) !== null
    || texto(c.object_type) === "VIDEO" || (feed?.videos?.length ?? 0) > 0;
  const formato = filhos.length > 1 ? "carrossel" : video ? "video" : "imagem";

  return {
    ad_id: id,
    nome: texto(ad.name),
    campanha_id: texto(ad.campaign?.id),
    campanha_nome: texto(ad.campaign?.name),
    status: texto(ad.effective_status),
    formato,
    copy: primeiro(c.body, linkData?.message, videoData?.message, feed?.bodies?.[0]?.text),
    titulo: primeiro(c.title, linkData?.name, videoData?.title, feed?.titles?.[0]?.text),
    imagem_meta_url: formato === "carrossel"
      ? filhos[0]
      : primeiroLink(c.image_url, videoData?.image_url, linkData?.picture, feed?.videos?.[0]?.thumbnail_url, c.thumbnail_url),
    imagens_meta: formato === "carrossel" ? filhos : [],
    preview_url: link(ad.preview_shareable_link),
  };
}

/** Campos pedidos à Graph; a miniatura em 1080 para a arte não sair borrada. */
export const CAMPOS_ANUNCIO =
  "id,name,effective_status,preview_shareable_link,campaign{id,name}," +
  "creative.thumbnail_width(1080).thumbnail_height(1080){object_type,title,body,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec}";

/** O mesmo sem a miniatura grande, se a Graph recusar o modificador. */
export const CAMPOS_ANUNCIO_SIMPLES =
  "id,name,effective_status,preview_shareable_link,campaign{id,name}," +
  "creative{object_type,title,body,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec}";
