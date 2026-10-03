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
 * Leads são os cartões da própria Central. Pedidos de 03/10/2026.
 */
const FORA_DA_CENTRAL = new Set(["pipeline", "leads_app"]);
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

export type ProgressoUniversidade = { assistidas: number; total: number };

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
