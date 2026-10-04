import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";

/**
 * Central do Corretor (03/10/2026: "um acesso só, pelo CRM"). Os dados são os
 * do site, no schema `site` do mesmo banco (0169): o CRM lê direto, com a RLS
 * de lá (`site.has_role` responde pelo papel do CRM). O schema `site` ainda não
 * está no `types.ts` gerado.
 */
const site = () => (supabase as unknown as SupabaseClient).schema("site");

export const BUCKET_SUPORTE = "support-docs";

export type LinkDoCorretor = {
  id: string;
  key: string;
  label: string;
  url: string | null;
  description: string | null;
};

/**
 * Cartões que levavam ao sistema antigo (Pipeline do Bubble e app do Leadfy)
 * ou ao próprio CRM ("CRM Faceimob"): dentro do CRM quem leva a Negócios e a
 * Leads são os cartões da própria Central. Pedidos de 03/10/2026. O "drive"
 * virou a tela /central/drive (04/10/2026).
 */
const FORA_DA_CENTRAL = new Set(["pipeline", "leads_app", "drive"]);
const HOSTS_DO_CRM = new Set(["app.faceimob.com.br"]);

export function apontaParaOCrm(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return HOSTS_DO_CRM.has(host) || host === window.location.host.toLowerCase();
  } catch {
    return false;
  }
}

export async function listarLinksDoCorretor(): Promise<LinkDoCorretor[]> {
  const { data, error } = await site()
    .from("broker_links")
    .select("id,key,label,url,description")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return ((data ?? []) as LinkDoCorretor[]).filter((l) => !FORA_DA_CENTRAL.has(l.key) && !apontaParaOCrm(l.url));
}

/** Selo "CCA próprio" por construtora (chave: nome em minúsculas, sem espaços nas pontas). */
async function selosDoCca(): Promise<Map<string, string>> {
  const { data, error } = await site().from("cca_developers").select("developer,label").eq("active", true);
  if (error) throw error;
  return new Map(((data ?? []) as { developer: string; label: string }[])
    .map((r) => [chaveDaConstrutora(r.developer), r.label]));
}

export const chaveDaConstrutora = (nome: string | null | undefined) => (nome ?? "").trim().toLowerCase();

export type LinkDoDrive = { name: string; url: string };
export type PastaDoDrive = {
  id: string;
  developer: string;
  logo_url: string | null;
  links: LinkDoDrive[];
  cca: string | null;
};

/**
 * Drive de Construtoras (página do site trazida ao CRM em 04/10/2026). Até 3
 * links por construtora; sem lista, vale o `drive_url`. As pastas são do
 * Google Drive das construtoras — abrir o arquivo é lá, não tem como trazer.
 */
export function linksDaPasta(p: { drive_url: string | null; links: unknown }): LinkDoDrive[] {
  const lista = Array.isArray(p.links)
    ? p.links.flatMap((l): LinkDoDrive[] => {
      if (typeof l !== "object" || l === null || !("url" in l) || typeof l.url !== "string" || !l.url) return [];
      const nome = "name" in l && typeof l.name === "string" ? l.name.trim() : "";
      return [{ name: nome, url: l.url }];
    })
    : [];
  if (lista.length > 0) return lista.slice(0, 3);
  return p.drive_url ? [{ name: "Abrir Drive", url: p.drive_url }] : [];
}

export async function listarPastasDoDrive(): Promise<PastaDoDrive[]> {
  const [pastas, selos] = await Promise.all([
    site().from("developer_folders")
      .select("id,developer,drive_url,logo_url,links")
      .eq("active", true).order("sort_order").order("developer"),
    selosDoCca(),
  ]);
  if (pastas.error) throw pastas.error;
  type Linha = { id: string; developer: string; drive_url: string | null; logo_url: string | null; links: unknown };
  return ((pastas.data ?? []) as Linha[]).map((p) => ({
    id: p.id,
    developer: p.developer,
    logo_url: p.logo_url,
    links: linksDaPasta(p),
    cca: selos.get(chaveDaConstrutora(p.developer)) ?? null,
  }));
}

export type ImovelDoMapa = {
  id: string;
  title: string;
  city: string;
  neighborhood: string | null;
  price: number | null;
  price_from: number | null;
  status: string;
  bedrooms: number | null;
  developer: string | null;
  imagem: string | null;
  cca: string | null;
};

/** Imóveis ativos do site, com a primeira foto e o selo do CCA — base do Mapa de Imóveis. */
export async function listarImoveisDoMapa(): Promise<ImovelDoMapa[]> {
  const [imoveis, selos] = await Promise.all([
    site().from("properties")
      .select("id,title,city,neighborhood,price,price_from,status,bedrooms,developer")
      .eq("active", true).order("title"),
    selosDoCca(),
  ]);
  if (imoveis.error) throw imoveis.error;
  type Linha = Omit<ImovelDoMapa, "imagem" | "cca">;
  const linhas = (imoveis.data ?? []) as Linha[];
  const fotos = new Map<string, string>();
  if (linhas.length > 0) {
    const { data, error } = await site().from("property_images")
      .select("property_id,url").in("property_id", linhas.map((l) => l.id)).order("sort_order");
    if (error) throw error;
    for (const f of (data ?? []) as { property_id: string; url: string }[]) {
      if (!fotos.has(f.property_id)) fotos.set(f.property_id, f.url);
    }
  }
  return linhas.map((l) => ({
    ...l,
    imagem: fotos.get(l.id) ?? null,
    cca: selos.get(chaveDaConstrutora(l.developer)) ?? null,
  }));
}

export type ProgressoUniversidade ={ assistidas: number; total: number };

export async function progressoDaUniversidade(userId: string): Promise<ProgressoUniversidade> {
  const [videos, vistos] = await Promise.all([
    site().from("university_videos").select("id", { count: "exact", head: true }).eq("active", true),
    site().from("university_watched").select("video_id", { count: "exact", head: true })
      .eq("user_id", userId).not("completed_at", "is", null),
  ]);
  if (videos.error) throw videos.error;
  if (vistos.error) throw vistos.error;
  return { assistidas: vistos.count ?? 0, total: videos.count ?? 0 };
}

export type DocumentoDeSuporte = {
  id: string;
  title: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  sort_order: number;
  active: boolean;
};

/** Vem com os ocultos: a policy do site (0169) não filtra `active` — a tela filtra para quem não gerencia. */
export async function listarDocumentosDeSuporte(): Promise<DocumentoDeSuporte[]> {
  const { data, error } = await site()
    .from("support_documents")
    .select("id,title,description,file_path,file_name,file_type,file_size,sort_order,active")
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as DocumentoDeSuporte[];
}

/** Admin (e sócio) ou editor cadastrado em `support_doc_editors`. */
export async function podeGerenciarSuporte(userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const { data, error } = await site()
    .from("support_doc_editors").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function linkParaBaixar(doc: DocumentoDeSuporte): Promise<string> {
  if (!doc.file_path) throw new Error("Documento sem arquivo.");
  const { data, error } = await supabase.storage.from(BUCKET_SUPORTE)
    .createSignedUrl(doc.file_path, 120, { download: nomeDoArquivo(doc) });
  if (error) throw error;
  return data.signedUrl;
}

export const extensaoDe = (doc: Pick<DocumentoDeSuporte, "file_name" | "file_path">) =>
  ((doc.file_name || doc.file_path || "").split(".").pop() ?? "").toLowerCase();

export const nomeDoArquivo = (doc: DocumentoDeSuporte) =>
  doc.file_name || `${doc.title}.${extensaoDe(doc) || "pdf"}`;

export type DocumentoEditado = {
  id?: string;
  title: string;
  description: string;
  active: boolean;
  sort_order: number;
  arquivoAtual: Pick<DocumentoDeSuporte, "file_path" | "file_name" | "file_type" | "file_size">;
  arquivoNovo: File | null;
};

/** Sobe o arquivo novo (se houver), grava a linha e só então apaga o antigo. */
export async function salvarDocumentoDeSuporte(doc: DocumentoEditado): Promise<void> {
  let arquivo = doc.arquivoAtual;
  if (doc.arquivoNovo) {
    const ext = doc.arquivoNovo.name.split(".").pop()?.toLowerCase() || "pdf";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET_SUPORTE).upload(path, doc.arquivoNovo, {
      cacheControl: "3600", upsert: false, contentType: doc.arquivoNovo.type || undefined,
    });
    if (error) throw error;
    arquivo = {
      file_path: path,
      file_name: doc.arquivoNovo.name,
      file_type: doc.arquivoNovo.type || ext,
      file_size: doc.arquivoNovo.size,
    };
  }
  const linha = {
    title: doc.title.trim(),
    description: doc.description.trim() || null,
    active: doc.active,
    sort_order: doc.sort_order,
    ...arquivo,
  };
  const { error } = doc.id
    ? await site().from("support_documents").update(linha).eq("id", doc.id).select("id").single()
    : await site().from("support_documents").insert(linha).select("id").single();
  if (error) {
    if (doc.arquivoNovo && arquivo.file_path) await supabase.storage.from(BUCKET_SUPORTE).remove([arquivo.file_path]);
    throw error;
  }
  const antigo = doc.arquivoAtual.file_path;
  if (doc.arquivoNovo && antigo) await supabase.storage.from(BUCKET_SUPORTE).remove([antigo]);
}

export async function alternarDocumentoVisivel(doc: DocumentoDeSuporte): Promise<void> {
  const { error } = await site().from("support_documents")
    .update({ active: !doc.active }).eq("id", doc.id).select("id").single();
  if (error) throw error;
}

export async function excluirDocumentoDeSuporte(doc: DocumentoDeSuporte): Promise<void> {
  const { error } = await site().from("support_documents").delete().eq("id", doc.id).select("id").single();
  if (error) throw error;
  if (doc.file_path) await supabase.storage.from(BUCKET_SUPORTE).remove([doc.file_path]);
}
