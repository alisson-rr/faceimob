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

/** Construtoras que são CCA próprio (o selo do site), pela chave do nome. */
export async function construtorasDoCcaProprio(): Promise<Set<string>> {
  return new Set((await selosDoCca()).keys());
}

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
  slug: string;
  title: string;
  city: string;
  neighborhood: string | null;
  price: number | null;
  price_from: number | null;
  status: StatusDoImovel;
  bedrooms: number | null;
  developer: string | null;
  imagem: string | null;
  cca: string | null;
};

/** Endereço público do site, para abrir a página do imóvel (`/imovel/:slug`). */
export const SITE_PUBLICO = "https://faceimob.com.br";
export const BUCKET_DE_FOTOS = "property-images";

/**
 * A foto pelo arquivo do bucket, como o site faz: o `url` gravado pode
 * apontar para o armazenamento antigo (Lovable) e não abrir mais — era por isso
 * que algumas miniaturas do mapa ficavam vazias (04/10/2026).
 */
export function urlDaFoto(f: { url: string; storage_path: string | null }): string {
  if (!f.storage_path) return f.url;
  return supabase.storage.from(BUCKET_DE_FOTOS).getPublicUrl(f.storage_path).data.publicUrl || f.url;
}

/** Imóveis ativos do site, com a primeira foto e o selo do CCA — base do Mapa de Imóveis. */
export async function listarImoveisDoMapa(): Promise<ImovelDoMapa[]> {
  const [imoveis, selos] = await Promise.all([
    site().from("properties")
      .select("id,slug,title,city,neighborhood,price,price_from,status,bedrooms,developer")
      .eq("active", true).order("title"),
    selosDoCca(),
  ]);
  if (imoveis.error) throw imoveis.error;
  type Linha = Omit<ImovelDoMapa, "imagem" | "cca">;
  const linhas = (imoveis.data ?? []) as Linha[];
  const fotos = new Map<string, string>();
  if (linhas.length > 0) {
    const { data, error } = await site().from("property_images")
      .select("property_id,url,storage_path").in("property_id", linhas.map((l) => l.id)).order("sort_order");
    if (error) throw error;
    for (const f of (data ?? []) as { property_id: string; url: string; storage_path: string | null }[]) {
      if (!fotos.has(f.property_id)) fotos.set(f.property_id, urlDaFoto(f));
    }
  }
  return linhas.map((l) => ({
    ...l,
    imagem: fotos.get(l.id) ?? null,
    cca: selos.get(chaveDaConstrutora(l.developer)) ?? null,
  }));
}

/**
 * Cadastro de imóveis e preços no CRM (05/10/2026, etapa 2 de trazer a
 * administração do site): mesma tabela do site, com a RLS de lá — só admin e
 * sócio gravam (`site.has_role(…, 'admin')`).
 */
export const STATUS_DO_IMOVEL = {
  lancamento: "Lançamento",
  em_obras: "Em obras",
  pronto_para_morar: "Pronto para morar",
  entregue: "Entregue",
} as const;
export type StatusDoImovel = keyof typeof STATUS_DO_IMOVEL;

export type ImovelDoCadastro = {
  id: string;
  code: string;
  slug: string;
  title: string;
  city: string;
  neighborhood: string | null;
  developer: string | null;
  price: number | null;
  price_from: number | null;
  bedrooms: number | null;
  status: StatusDoImovel;
  active: boolean;
  featured: boolean;
};

export type AlteracaoDoImovel = Partial<Omit<ImovelDoCadastro, "id" | "code" | "slug">>;

export async function listarImoveisDoCadastro(): Promise<ImovelDoCadastro[]> {
  const { data, error } = await site().from("properties")
    .select("id,code,slug,title,city,neighborhood,developer,price,price_from,bedrooms,status,active,featured")
    .order("developer").order("code");
  if (error) throw error;
  // numeric chega como string pelo PostgREST quando passa de 15 dígitos; aqui são preços.
  return ((data ?? []) as ImovelDoCadastro[]).map((i) => ({
    ...i,
    price: i.price == null ? null : Number(i.price),
    price_from: i.price_from == null ? null : Number(i.price_from),
  }));
}

/** Grava e confere: sem permissão a RLS devolve 0 linhas em vez de erro. */
export async function salvarImovel(id: string, alteracao: AlteracaoDoImovel): Promise<void> {
  const { data, error } = await site().from("properties").update(alteracao).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Sem permissão para alterar este imóvel.");
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

export type MaterialDaAula = { name: string; url: string };

export type AulaDaUniversidade = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  video_url: string | null;
  duration_label: string | null;
  views_count: number;
  materials: MaterialDaAula[];
  concluida: boolean;
};

export type SecaoDaUniversidade = {
  id: string;
  title: string;
  description: string | null;
  aulas: AulaDaUniversidade[];
};

export type Universidade = {
  secoes: SecaoDaUniversidade[];
  experiencia: number;
  nivel: number;
};

/** Materiais da aula: só itens com nome e link válidos. */
export function materiaisDaAula(valor: unknown): MaterialDaAula[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((m): MaterialDaAula[] =>
    typeof m === "object" && m !== null && "name" in m && "url" in m
      && typeof m.name === "string" && typeof m.url === "string" && /^https?:\/\//i.test(m.url)
      ? [{ name: m.name, url: m.url }]
      : []);
}

/**
 * Universidade dentro do CRM (etapa 1 da administração do site no CRM,
 * 04/10/2026): seções e aulas ativas do site, o que o corretor já concluiu e o
 * XP dele. Mesma RLS do site (0169).
 */
export async function carregarUniversidade(userId: string): Promise<Universidade> {
  const [secoes, aulas, vistas, evolucao] = await Promise.all([
    site().from("university_sections").select("id,title,description").eq("active", true).order("sort_order"),
    site().from("university_videos")
      .select("id,section_id,title,description,cover_url,video_url,duration_label,views_count,materials")
      .eq("active", true).order("sort_order"),
    site().from("university_watched").select("video_id,completed_at").eq("user_id", userId),
    site().from("evolucao_universidade").select("experiencia,nivel").eq("user_id", userId).maybeSingle(),
  ]);
  for (const r of [secoes, aulas, vistas, evolucao]) if (r.error) throw r.error;
  const concluidas = new Set(((vistas.data ?? []) as { video_id: string; completed_at: string | null }[])
    .filter((v) => v.completed_at).map((v) => v.video_id));
  type LinhaAula = Omit<AulaDaUniversidade, "materials" | "concluida"> & { section_id: string; materials: unknown };
  const porSecao = new Map<string, AulaDaUniversidade[]>();
  for (const a of (aulas.data ?? []) as LinhaAula[]) {
    const { section_id, materials, ...resto } = a;
    porSecao.set(section_id, [...(porSecao.get(section_id) ?? []),
      { ...resto, views_count: resto.views_count ?? 0, materials: materiaisDaAula(materials), concluida: concluidas.has(a.id) }]);
  }
  const evo = evolucao.data as { experiencia: number; nivel: number } | null;
  return {
    secoes: ((secoes.data ?? []) as Omit<SecaoDaUniversidade, "aulas">[])
      .map((s) => ({ ...s, aulas: porSecao.get(s.id) ?? [] }))
      .filter((s) => s.aulas.length > 0),
    experiencia: evo?.experiencia ?? 0,
    nivel: evo?.nivel ?? 1,
  };
}

export async function registrarVisualizacao(aulaId: string): Promise<void> {
  const { error } = await (supabase as unknown as SupabaseClient)
    .rpc("universidade_registrar_visualizacao", { p_video: aulaId });
  if (error) throw error;
}

export type ConclusaoDaAula = { primeira: boolean; experiencia: number; nivel: number };

export async function concluirAula(aulaId: string): Promise<ConclusaoDaAula> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .rpc("universidade_concluir_aula", { p_video: aulaId });
  if (error) throw error;
  return data as ConclusaoDaAula;
}

/** Endereço de player embutido: YouTube e Vimeo viram iframe; o resto, arquivo de vídeo. */
export function playerDaAula(url: string | null): { tipo: "iframe" | "video"; src: string } | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { tipo: "iframe", src: `https://www.youtube.com/embed/${yt[1]}?rel=0` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { tipo: "iframe", src: `https://player.vimeo.com/video/${vm[1]}` };
  return /^https?:\/\//i.test(url) ? { tipo: "video", src: url } : null;
}

/** "12:30" ou "1:02:03" em segundos; sem formato, `null`. */
export function segundosDaDuracao(rotulo: string | null): number | null {
  const partes = (rotulo ?? "").trim().split(":").map(Number);
  if (partes.length < 2 || partes.some((n) => !Number.isFinite(n))) return null;
  return partes.reduce((total, n) => total * 60 + n, 0);
}
