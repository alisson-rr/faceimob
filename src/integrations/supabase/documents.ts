import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Documentos do negócio — upload com renomeação, download assinado e histórico.
 *
 * O banco resolve versionamento sozinho: `deal_documents_enforce_single` calcula
 * a `version` e `deal_documents_supersede` marca a anterior como substituída, os
 * dois no insert. O cliente não mexe em `version` nem em `superseded_at`; se
 * mexer, briga com o trigger.
 */

export const DEAL_DOCUMENTS_BUCKET = "deal-documents";

export type DocumentTypeRecord = {
  id: string;
  code: string;
  label: string;
  category: string;
  required_for_conversion: boolean;
  allows_multiple: boolean;
  naming_pattern: string | null;
  sort_order: number;
};

export type DealDocumentRecord = {
  id: string;
  deal_id: string;
  document_type_id: string;
  storage_path: string;
  original_name: string;
  stored_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  superseded_at: string | null;
  created_at: string;
};

export type DocumentReviewStatus = "draft" | "pending" | "returned" | "approved";

export type DealDocumentReview = {
  document_review_status: DocumentReviewStatus;
  document_review_requested_at: string | null;
  document_review_requested_by: string | null;
  document_reviewed_at: string | null;
  document_reviewed_by: string | null;
  document_review_reason: string | null;
};

export async function listDocumentTypes(): Promise<DocumentTypeRecord[]> {
  const { data, error } = await supabase
    .from("document_types")
    .select("id,code,label,category,required_for_conversion,allows_multiple,naming_pattern,sort_order")
    .eq("active", true)
    .order("sort_order");
  if (error) throw dbError("document_types", error);
  return (data ?? []) as DocumentTypeRecord[];
}

export async function listDealDocuments(dealId: string): Promise<DealDocumentRecord[]> {
  const { data, error } = await supabase
    .from("deal_documents")
    .select("id,deal_id,document_type_id,storage_path,original_name,stored_name,mime_type,size_bytes,version,superseded_at,created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("deal_documents", error);
  return (data ?? []) as DealDocumentRecord[];
}

export async function getDealDocumentReview(dealId: string): Promise<DealDocumentReview> {
  const { data, error } = await supabase
    .from("deals")
    .select("document_review_status,document_review_requested_at,document_review_requested_by,document_reviewed_at,document_reviewed_by,document_review_reason")
    .eq("id", dealId)
    .single();
  if (error) throw dbError("deals", error);
  return data as DealDocumentReview;
}

export async function listMyDealRoles(dealId: string, profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("deal_participants")
    .select("role")
    .eq("deal_id", dealId)
    .eq("profile_id", profileId);
  if (error) throw dbError("deal_participants", error);
  return (data ?? []).map((row) => row.role);
}

/** Remove acento e pontuação para o nome sobreviver a qualquer sistema de
 *  arquivos. Espelha o `slugify` do banco, mas para nome de arquivo. */
const slug = (value: string) =>
  value
    // NFD separa a letra do acento; \p{M} remove as marcas sem precisar de
    // caractere combinante literal no código-fonte.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "sem-nome";

const extensionOf = (fileName: string) => {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : "";
};

/**
 * Resolve o `naming_pattern` do tipo de documento.
 *
 * Placeholders documentados na migration 0003: {tipo}, {cliente}, {data} e
 * {negocio}. Placeholder desconhecido é removido em vez de aparecer literal no
 * nome do arquivo — "{obra}-joao.pdf" seria pior que "joao.pdf".
 */
export function resolveStoredName(
  pattern: string | null,
  parts: { tipo: string; cliente: string; negocio: string; data?: Date },
  originalName: string,
): string {
  const date = parts.data ?? new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const values: Record<string, string> = {
    tipo: slug(parts.tipo),
    cliente: slug(parts.cliente),
    negocio: slug(parts.negocio),
    data: iso,
  };

  const base = (pattern || "{tipo}-{cliente}-{data}")
    .replace(/\{(\w+)\}/g, (_, token: string) => values[token] ?? "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  const ext = extensionOf(originalName);
  const safeBase = base || slug(originalName);
  return ext ? `${safeBase}.${ext}` : safeBase;
}

export type UploadDealDocumentInput = {
  dealId: string;
  documentType: DocumentTypeRecord;
  file: File;
  clientName: string;
  dealCode: string;
};

/**
 * Envia o arquivo e registra a linha. Devolve o registro criado.
 *
 * O caminho no bucket carrega um sufixo de tempo porque `storage_path` é único
 * e a versão anterior continua existindo (é o histórico que o CCA pediu) — dois
 * envios do mesmo tipo colidiriam. O nome amigável fica em `stored_name`, que é
 * o que o usuário vê e baixa.
 */
export async function uploadDealDocument(input: UploadDealDocumentInput): Promise<DealDocumentRecord> {
  const { dealId, documentType, file, clientName, dealCode } = input;

  const storedName = resolveStoredName(
    documentType.naming_pattern,
    { tipo: documentType.code, cliente: clientName, negocio: dealCode },
    file.name,
  );
  const path = `${dealId}/${Date.now()}-${storedName}`;

  const { error: uploadError } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) throw dbError("enviar documento", uploadError);

  const { data, error } = await supabase
    .from("deal_documents")
    .insert({
      deal_id: dealId,
      document_type_id: documentType.id,
      storage_path: path,
      original_name: file.name,
      stored_name: storedName,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select("id,deal_id,document_type_id,storage_path,original_name,stored_name,mime_type,size_bytes,version,superseded_at,created_at")
    .single();

  if (error) {
    // Não deixa arquivo órfão no bucket quando o insert é barrado pela RLS —
    // mesmo cuidado que `uploadLeadAttachment` já tomava.
    await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([path]);
    throw dbError("registrar documento", error);
  }
  return data as DealDocumentRecord;
}

/** URL assinada de 5 minutos, já com o nome amigável no download. */
export async function signedDocumentUrl(doc: Pick<DealDocumentRecord, "storage_path" | "stored_name">): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 300, { download: doc.stored_name });
  if (error) throw dbError("gerar link do documento", error);
  return data.signedUrl;
}

/** Tipos exigidos que ainda não têm documento vigente. Alimenta o aviso antes
 *  de `submit_deal_for_manager_review`; a conversão do lead não exige anexo. */
export function missingRequiredTypes(
  types: DocumentTypeRecord[],
  documents: DealDocumentRecord[],
): DocumentTypeRecord[] {
  const present = new Set(
    documents.filter((d) => d.superseded_at === null).map((d) => d.document_type_id),
  );
  return types.filter((t) => t.required_for_conversion && !present.has(t.id));
}

/** Envia o dossiê completo para um dos gerentes participantes conferir. */
export async function submitDealForManagerReview(dealId: string): Promise<void> {
  const { error } = await supabase.rpc("submit_deal_for_manager_review", {
    p_deal_id: dealId,
  });
  if (error) throw dbError("submit_deal_for_manager_review", error);
}

/** Aprova e segue ao CCA, ou devolve ao corretor com motivo obrigatório. */
export async function reviewDealDocuments(input: {
  dealId: string;
  approve: boolean;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("review_deal_documents", {
    p_deal_id: input.dealId,
    p_approve: input.approve,
    p_reason: input.reason || undefined,
  });
  if (error) throw dbError("review_deal_documents", error);
}
