import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { BUCKET_DE_FOTOS, urlDaFoto, type StatusDoImovel } from "./central";
import { slugify } from "@/lib/utils";

/**
 * Cadastro completo do imóvel do site dentro do CRM (05/10/2026: "deixar tudo
 * no CRM"). Mesmas tabelas e buckets do painel do site, com a RLS de lá: só
 * admin e sócio gravam (`site.has_role(…, 'admin')`).
 */
const site = () => (supabase as unknown as SupabaseClient).schema("site");
const BUCKET_DO_BOOK = "property-docs";

export type FichaDoImovel = {
  code: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  city: string;
  neighborhood: string | null;
  state: string;
  address: string | null;
  price: number | null;
  price_from: number | null;
  monthly_installment: number | null;
  down_payment: number | null;
  subsidy_estimate: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_spots: number | null;
  area_sqm: number | null;
  status: StatusDoImovel;
  delivery_date: string | null;
  developer: string | null;
  is_mcmv: boolean;
  featured: boolean;
  active: boolean;
  amenities: string[];
  differentials: string[];
  video_url: string | null;
  tour_url: string | null;
  highlight_text: string | null;
  seo_title: string | null;
  seo_description: string | null;
  book_url: string | null;
  book_path: string | null;
};

export type Proprietario = { owner_name: string; owner_phone: string };

export type FotoDoImovel = { id: string; url: string; storage_path: string | null; sort_order: number; src: string };

const COLUNAS =
  "code,slug,title,subtitle,description,city,neighborhood,state,address,price,price_from,monthly_installment," +
  "down_payment,subsidy_estimate,bedrooms,bathrooms,parking_spots,area_sqm,status,delivery_date,developer," +
  "is_mcmv,featured,active,amenities,differentials,video_url,tour_url,highlight_text,seo_title,seo_description," +
  "book_url,book_path";

const NUMERICOS = ["price", "price_from", "monthly_installment", "down_payment", "subsidy_estimate", "area_sqm"] as const;

export const fichaVazia = (code: string): FichaDoImovel => ({
  code, slug: "", title: "", subtitle: null, description: null, city: "", neighborhood: null, state: "RS",
  address: null, price: null, price_from: null, monthly_installment: null, down_payment: null,
  subsidy_estimate: null, bedrooms: null, bathrooms: null, parking_spots: null, area_sqm: null,
  status: "lancamento", delivery_date: null, developer: null, is_mcmv: false, featured: false, active: true,
  amenities: [], differentials: [], video_url: null, tour_url: null, highlight_text: null, seo_title: null,
  seo_description: null, book_url: null, book_path: null,
});

/** Próximo código livre no padrão do site (FI-001, FI-002…). */
export async function proximoCodigo(): Promise<string> {
  const { data, error } = await site().from("properties").select("code").ilike("code", "FI-%")
    .order("code", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const ultimo = (data as { code: string } | null)?.code.match(/FI-(\d+)/)?.[1];
  return `FI-${String(ultimo ? Number(ultimo) + 1 : 1).padStart(3, "0")}`;
}

export async function carregarFicha(id: string): Promise<{ ficha: FichaDoImovel; dono: Proprietario }> {
  const [imovel, dono] = await Promise.all([
    site().from("properties").select(COLUNAS).eq("id", id).maybeSingle(),
    site().from("property_owners").select("owner_name,owner_phone").eq("property_id", id).maybeSingle(),
  ]);
  if (imovel.error) throw imovel.error;
  if (dono.error) throw dono.error;
  if (!imovel.data) throw new Error("Imóvel não encontrado.");
  const bruto = imovel.data as unknown as FichaDoImovel;
  const ficha = { ...bruto, amenities: bruto.amenities ?? [], differentials: bruto.differentials ?? [] };
  // numeric chega como string pelo PostgREST.
  for (const k of NUMERICOS) ficha[k] = ficha[k] == null ? null : Number(ficha[k]);
  const d = dono.data as { owner_name: string | null; owner_phone: string | null } | null;
  return { ficha, dono: { owner_name: d?.owner_name ?? "", owner_phone: d?.owner_phone ?? "" } };
}

/** Cria (sem `id`) ou atualiza o imóvel e o contato do proprietário; devolve o id. */
export async function salvarFicha(id: string | null, ficha: FichaDoImovel, dono: Proprietario): Promise<string> {
  const dados = { ...ficha, slug: ficha.slug.trim() || slugify(ficha.title) };
  let imovelId = id;
  if (imovelId) {
    const { data, error } = await site().from("properties").update(dados).eq("id", imovelId).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Sem permissão para alterar este imóvel.");
  } else {
    const { data, error } = await site().from("properties").insert(dados).select("id").single();
    if (error) throw error;
    imovelId = (data as { id: string }).id;
  }
  const nome = dono.owner_name.trim();
  const fone = dono.owner_phone.trim();
  const r = nome || fone
    ? await site().from("property_owners")
      .upsert({ property_id: imovelId, owner_name: nome || null, owner_phone: fone || null }, { onConflict: "property_id" })
    : await site().from("property_owners").delete().eq("property_id", imovelId);
  if (r.error) throw r.error;
  return imovelId;
}

const nomeSeguro = (nome: string) => `${Date.now()}-${nome.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

export async function listarFotos(imovelId: string): Promise<FotoDoImovel[]> {
  const { data, error } = await site().from("property_images").select("id,url,storage_path,sort_order")
    .eq("property_id", imovelId).order("sort_order");
  if (error) throw error;
  return ((data ?? []) as Omit<FotoDoImovel, "src">[]).map((f) => ({ ...f, src: urlDaFoto(f) }));
}

/** Sobe as fotos (já otimizadas) no fim da galeria; devolve quantas entraram. */
export async function subirFotos(imovelId: string, arquivos: File[], ordemInicial: number): Promise<number> {
  let ok = 0;
  for (const arquivo of arquivos) {
    const caminho = `${imovelId}/${nomeSeguro(arquivo.name)}`;
    const up = await supabase.storage.from(BUCKET_DE_FOTOS)
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || "image/webp" });
    if (up.error) throw up.error;
    const { error } = await site().from("property_images")
      .insert({ property_id: imovelId, url: "", storage_path: caminho, kind: "photo", sort_order: ordemInicial + ok });
    if (error) {
      await supabase.storage.from(BUCKET_DE_FOTOS).remove([caminho]);
      throw error;
    }
    ok++;
  }
  return ok;
}

export async function removerFotos(fotos: FotoDoImovel[]): Promise<void> {
  if (fotos.length === 0) return;
  const { error } = await site().from("property_images").delete().in("id", fotos.map((f) => f.id));
  if (error) throw error;
  const caminhos = fotos.map((f) => f.storage_path).filter((c): c is string => Boolean(c));
  // Arquivo órfão no bucket não aparece no site; a linha já saiu.
  if (caminhos.length) await supabase.storage.from(BUCKET_DE_FOTOS).remove(caminhos);
}

/** Grava a ordem da galeria: a primeira é a capa. */
export async function ordenarFotos(fotos: FotoDoImovel[]): Promise<void> {
  const r = await Promise.all(fotos.map((f, i) => site().from("property_images").update({ sort_order: i }).eq("id", f.id)));
  const erro = r.find((x) => x.error)?.error;
  if (erro) throw erro;
}

export async function subirBook(imovelId: string, pdf: File, anterior: string | null): Promise<{ book_path: string; book_url: string }> {
  const caminho = `${imovelId}/${nomeSeguro(pdf.name)}`;
  const up = await supabase.storage.from(BUCKET_DO_BOOK).upload(caminho, pdf, { upsert: false, contentType: "application/pdf" });
  if (up.error) throw up.error;
  const book = { book_path: caminho, book_url: supabase.storage.from(BUCKET_DO_BOOK).getPublicUrl(caminho).data.publicUrl };
  const { error } = await site().from("properties").update(book).eq("id", imovelId);
  if (error) {
    await supabase.storage.from(BUCKET_DO_BOOK).remove([caminho]);
    throw error;
  }
  if (anterior && anterior !== caminho) await supabase.storage.from(BUCKET_DO_BOOK).remove([anterior]);
  return book;
}

export async function removerBook(imovelId: string, caminho: string): Promise<void> {
  const { error } = await site().from("properties").update({ book_path: null, book_url: null }).eq("id", imovelId);
  if (error) throw error;
  await supabase.storage.from(BUCKET_DO_BOOK).remove([caminho]);
}

export async function linkDoBook(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DO_BOOK).createSignedUrl(caminho, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
