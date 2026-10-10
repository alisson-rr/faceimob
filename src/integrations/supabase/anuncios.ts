import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";

/** Anúncio da Meta com arte e copy (0265), sincronizado de hora em hora. */
export type Anuncio = {
  ad_id: string;
  nome: string | null;
  campanha_nome: string | null;
  status: string | null;
  ativo: boolean;
  formato: "imagem" | "video" | "carrossel";
  copy: string | null;
  titulo: string | null;
  imagem_meta_url: string | null;
  imagem_path: string | null;
  imagens: Array<{ meta_url: string; path: string | null }>;
  preview_url: string | null;
  synced_at: string;
};

export const ROTULO_FORMATO: Record<Anuncio["formato"], string> = {
  imagem: "Estática",
  video: "Vídeo",
  carrossel: "Carrossel",
};

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `meta_anuncios` nasceu na 0265, depois do último `supabase gen types`: a
 * forma vem declarada aqui até a próxima geração do `types.ts`, que não se
 * edita à mão. Leitura liberada a todo autenticado.
 */
const COLUNAS = "ad_id,nome,campanha_nome,status,ativo,formato,copy,titulo,imagem_meta_url,imagem_path,imagens,preview_url,synced_at";
const db = supabase as unknown as {
  from(tabela: "meta_anuncios"): {
    select(colunas: typeof COLUNAS): {
      eq(coluna: "ativo", valor: true): { order(coluna: "campanha_nome", opcoes: { ascending: boolean }): Resultado<Anuncio[]> };
      eq(coluna: "ad_id", valor: string): { maybeSingle(): Resultado<Anuncio> };
    };
  };
};

export async function listAnunciosAtivos(): Promise<Anuncio[]> {
  const { data, error } = await db.from("meta_anuncios").select(COLUNAS).eq("ativo", true).order("campanha_nome", { ascending: true });
  if (error) throw dbError("meta_anuncios", error);
  return data ?? [];
}

/** O anúncio do lead; `null` se ainda não foi sincronizado. */
export async function anuncioPorId(adId: string): Promise<Anuncio | null> {
  const { data, error } = await db.from("meta_anuncios").select(COLUNAS).eq("ad_id", adId).maybeSingle();
  if (error) throw dbError("meta_anuncios", error);
  return data;
}

/** Cópia no bucket quando existe; senão o link da Meta (pode ter expirado). */
export function urlDaArte(path: string | null, metaUrl: string | null): string | null {
  if (path) return supabase.storage.from("anuncios").getPublicUrl(path).data.publicUrl;
  return metaUrl && /^https:\/\//i.test(metaUrl) ? metaUrl : null;
}

/** Todas as artes do anúncio, na ordem (carrossel), ou só a principal. */
export function artesDoAnuncio(a: Pick<Anuncio, "imagens" | "imagem_path" | "imagem_meta_url">): string[] {
  const doCarrossel = (a.imagens ?? []).map((i) => urlDaArte(i.path, i.meta_url)).filter((u): u is string => u !== null);
  if (doCarrossel.length > 0) return doCarrossel;
  const principal = urlDaArte(a.imagem_path, a.imagem_meta_url);
  return principal ? [principal] : [];
}

/** "Atualizar" da tela: roda a sincronização dos anúncios agora. */
export async function atualizarAnuncios(): Promise<void> {
  const { error } = await supabase.functions.invoke("meta-sync", { body: { modo: "anuncios" } });
  if (error) throw new Error(await functionErrorMessage(error, "Não consegui atualizar os anúncios agora."));
}
