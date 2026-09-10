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

/**
 * Fronteira do upload: nada de tamanho nem de extensão era conferido antes de o
 * arquivo subir. O bucket ganhou teto de servidor na migration 0059 — este
 * limite existe para o usuário ver a recusa ANTES de esperar o envio inteiro.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Extensões aceitas no dossiê. Lista curta de propósito: documento de crédito
 *  é PDF, foto ou planilha — executável e pacote compactado não entram. */
export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf", "jpg", "jpeg", "png", "webp", "heic", "heif",
  "doc", "docx", "xls", "xlsx", "csv", "txt",
] as const;

/** Motivo da recusa em pt-BR, ou `null` quando o arquivo serve. É a MESMA regra
 *  que `uploadDealDocument` aplica; a tela a usa antes só para poder dizer qual
 *  dos arquivos escolhidos não passou. */
export function validateDocumentFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `"${file.name}" passa de ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`;
  }
  const ext = extensionOf(file.name);
  if (!ext) return `"${file.name}" está sem extensão.`;
  if (!(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    return `"${file.name}" tem extensão .${ext}, que não é aceita no dossiê.`;
  }
  return null;
}

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

/**
 * Quem pode ANEXAR agora — a mesma cláusula que `deal_documents_insert` cobra
 * desde a 0077.
 *
 * A partir do envio ao gerente o dossiê é prova: trocar a versão que o gerente
 * aprovou e que o analista vai baixar, sem deixar rastro, era o furo. O CCA
 * continua podendo juntar documento depois (retorno do banco, laudo), e por
 * isso ele entra por `cca.review` em vez de o estado travar todo mundo.
 */
export function canAttachNow(input: {
  status: DocumentReviewStatus;
  isAdmin: boolean;
  hasCcaReview: boolean;
}): boolean {
  return input.isAdmin || input.hasCcaReview
    || input.status === "draft" || input.status === "returned";
}

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

/**
 * Nome de cada participante do negócio, por `profile_id`.
 *
 * A auditoria da conferência (quem enviou, quem aprovou/devolveu) só existia em
 * `deals.document_review_*`, e a tela mostrava nada. Ler `profiles` direto não
 * serve: `profiles_select` é `auth_visible_profiles()`, e o corretor **não
 * enxerga o perfil do gerente** — a linha voltaria vazia justamente para quem
 * mais precisa saber quem devolveu o dossiê. A RPC `deal_participant_names`
 * (0027) é `security definer` e existe para isto: nome de quem participa de um
 * negócio que a pessoa já pode abrir, sem ampliar a visibilidade de perfis.
 *
 * O filtro por `deal_id` vai no PostgREST: a função devolve os participantes de
 * TODOS os negócios visíveis, e o modal precisa de um só.
 */
export async function dealParticipantNames(dealId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .rpc("deal_participant_names")
    .eq("deal_id", dealId);
  if (error) throw dbError("deal_participant_names", error);
  const nomes: Record<string, string> = {};
  for (const row of (data ?? []) as { profile_id: string; full_name: string | null }[]) {
    if (row.full_name) nomes[row.profile_id] = row.full_name;
  }
  return nomes;
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
 *
 * `distinguir` existe por causa de `allows_multiple`. Nenhum placeholder do
 * padrão varia entre dois arquivos do MESMO tipo, no mesmo negócio, no mesmo
 * dia: dois anexos em "Outros" viravam os dois `outros-<cliente>-<data>.pdf`,
 * a lista mostrava duas linhas idênticas e os dois "Baixar" entregavam arquivos
 * diferentes com o mesmo nome. Nos tipos que versionam isso não acontece (só um
 * vigente por vez), por isso o sufixo entra apenas onde há de fato vários.
 *
 * ponytail: dois arquivos com o MESMO nome original (de pastas diferentes)
 * continuam colidindo no nome exibido — o `storage_path` já carrega o timestamp
 * e não colide. Evoluir para um sufixo numérico se aparecer caso real.
 */
export function resolveStoredName(
  pattern: string | null,
  parts: { tipo: string; cliente: string; negocio: string; data?: Date },
  originalName: string,
  options?: { distinguir?: boolean },
): string {
  const date = parts.data ?? new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const values: Record<string, string> = {
    tipo: slug(parts.tipo),
    cliente: slug(parts.cliente),
    negocio: slug(parts.negocio),
    data: iso,
  };

  const ext = extensionOf(originalName);
  const semExtensao = ext ? originalName.slice(0, -(ext.length + 1)) : originalName;

  const base = (pattern || "{tipo}-{cliente}-{data}")
    .replace(/\{(\w+)\}/g, (_, token: string) => values[token] ?? "")
    .concat(options?.distinguir ? `-${slug(semExtensao)}` : "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

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

  // Ponto único da validação de fronteira: todo chamador passa por aqui.
  const rejected = validateDocumentFile(file);
  if (rejected) throw new Error(rejected);

  const storedName = resolveStoredName(
    documentType.naming_pattern,
    { tipo: documentType.code, cliente: clientName, negocio: dealCode },
    file.name,
    { distinguir: documentType.allows_multiple },
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

/**
 * Quais desses caminhos NÃO têm arquivo legível no bucket.
 *
 * A linha em `deal_documents` e o objeto no Storage são duas gravações
 * separadas, e nada no banco casa as duas: seed que registra sem subir, upload
 * cujo `remove` de rollback falhou, objeto apagado por fora. O resultado é
 * sempre o mesmo — a tela lista o documento, oferece "Baixar", e a assinatura
 * volta 400 depois do clique. Perguntar ao Storage ANTES é o que separa
 * "documento em falta" de "botão quebrado".
 *
 * `createSignedUrls` (plural) é a pergunta mais barata que existe para isso:
 * uma requisição para a lista inteira, com `error` por caminho, e passando pela
 * MESMA autorização (as policies de `storage.objects`) que o download vai
 * enfrentar — um `select` em `storage.objects` responderia por um caminho que a
 * pessoa não pode baixar. O Storage não distingue ausência de falta de acesso
 * ("Either the object does not exist or you do not have access to it"); a tela
 * também não pode fingir que distingue.
 *
 * Expiração curta de propósito: estes links são descartados, quem baixa assina
 * de novo no clique (senão o link venceria com o modal aberto).
 */
export async function missingStoragePaths(paths: string[]): Promise<Set<string>> {
  const unicos = [...new Set(paths)];
  if (unicos.length === 0) return new Set();
  const { data, error } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .createSignedUrls(unicos, 60);
  if (error) throw dbError("conferir arquivos do dossiê", error);
  const ausentes = new Set<string>();
  for (const linha of data ?? []) {
    if (linha.path && (linha.error || !linha.signedUrl)) ausentes.add(linha.path);
  }
  return ausentes;
}

/**
 * Apaga o registro e o arquivo.
 *
 * A linha é a fonte de verdade. Se o `delete` casar 0 linhas por RLS o
 * PostgREST devolve 204 **sem erro**, e um toast de sucesso ali seria mentira:
 * por isso o `select()`, que só devolve linha quando o banco realmente apagou.
 *
 * **A ordem depende do caminho.** A policy `deal_documents_storage` autoriza a
 * remoção do objeto por dois ramos: o prefixo `<deal_id>/…` (`deal_id_of_object`)
 * ou a existência da linha em `deal_documents`. Documento gravado fora desse
 * padrão — os 75 da homologação estão em `demo-showcase/…` e `seed/deals/…`, e
 * o anexo promovido do lead mora sob `<lead_id>/…` — só tem o segundo ramo: com
 * a linha já apagada, nenhum ramo casa, o `remove` volta recusado e o binário do
 * cliente fica no bucket para sempre. Nesses casos o arquivo sai primeiro,
 * enquanto a linha ainda o autoriza.
 *
 * A troca de ordem tem um risco declarado: se o arquivo sair e o `delete` da
 * linha for recusado, sobra registro sem arquivo. É por isso que a recusa deixou
 * de ser genérica — a frase abaixo diz exatamente o que ficou para trás, em vez
 * de o operador descobrir num "Baixar" que não baixa.
 */
export async function deleteDealDocument(
  doc: Pick<DealDocumentRecord, "id" | "storage_path" | "deal_id">,
): Promise<void> {
  const dentroDaPasta = doc.storage_path.startsWith(`${doc.deal_id}/`);
  let arquivoRemovido = false;

  if (!dentroDaPasta) {
    const { error: removeAntes } = await supabase.storage
      .from(DEAL_DOCUMENTS_BUCKET).remove([doc.storage_path]);
    if (removeAntes) {
      console.warn("[documents] arquivo fora do padrão não pôde ser removido:", removeAntes.message);
    } else {
      arquivoRemovido = true;
    }
  }

  const { data, error } = await supabase
    .from("deal_documents").delete().eq("id", doc.id).select("id");
  if (error) throw dbError("excluir documento", error);
  if (!data || data.length === 0) {
    // `P0001` porque a frase é para o operador LER: `describeError` só preserva
    // a mensagem própria nesse código — um `new Error` puro não tem `code` e
    // caía no fallback genérico da tela ("O documento continua no dossiê"),
    // deixando recusa de RLS e queda de rede com a mesma cara.
    throw dbError("excluir documento", {
      code: "P0001",
      message: arquivoRemovido
        ? "O banco recusou a exclusão do registro, e o arquivo já havia saído do armazenamento: peça ao CCA para remover a linha deste documento."
        : "O banco recusou a exclusão: o dossiê já saiu para a conferência do gerente, ou você não edita este negócio.",
    });
  }

  if (arquivoRemovido) return;

  const { error: removeError } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET).remove([doc.storage_path]);
  // Arquivo que sobrou no bucket não aparece em tela nenhuma (a listagem sai de
  // `deal_documents`), então não vale desfazer a exclusão por causa dele — mas
  // engolir calado esconderia uma policy quebrada.
  if (removeError) {
    console.warn("[documents] registro apagado, arquivo permaneceu no bucket:", removeError.message);
  }
}

/**
 * Quem pode ANEXAR — perguntado ao banco, não deduzido na tela.
 *
 * `deal_documents_insert` cobra `can_edit_deal(deal_id)`, que é
 * `has_permission('cca.review')` **ou** participar do rateio **ou** gerenciar
 * alguém do rateio. Reimplementar isso no cliente exigiria copiar
 * `manages_profile` — e a cópia erraria justamente no gerente de equipe. Quem
 * só enxerga o negócio (diretor e sócio caem em `can_read_all`) via nove botões
 * "Anexar": o arquivo subia, o insert era barrado e a tela dizia "Falha no
 * envio" depois do upload inteiro.
 */
export async function canEditDeal(dealId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_edit_deal", { p_deal_id: dealId });
  if (error) throw dbError("can_edit_deal", error);
  return data === true;
}

/** Quantos gerentes estão no rateio. `submit_deal_for_manager_review` recusa o
 *  envio sem nenhum (0028:404) — a tela precisa saber ANTES de habilitar o
 *  botão, senão o corretor recebe a mensagem crua do banco em toast. */
export async function countDealManagers(dealId: string): Promise<number> {
  const { count, error } = await supabase
    .from("deal_participants")
    .select("profile_id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("role", "manager");
  if (error) throw dbError("deal_participants", error);
  return count ?? 0;
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

/**
 * Por que o dossiê ainda NÃO pode ir ao gerente — `null` quando pode.
 *
 * Uma regra só, na ordem em que o banco recusa: `submit_deal_for_manager_review`
 * exige construtora (0047) e ao menos um gerente no rateio (0028:404), e os
 * obrigatórios travam o resto. O botão fica desabilitado exatamente quando há
 * motivo, e o motivo é a frase que aparece ao lado dele.
 *
 * O primeiro caso é novo e não é hipotético: o catálogo pode ser desligado
 * inteiro em Esteira CCA → Tipos de documento, `listDocumentTypes` filtra
 * `active`, e aí `missingRequiredTypes` devolve `[]` — a tela dizia "Dossiê
 * pronto para o gerente conferir" sobre um negócio sem um único anexo.
 */
export function submitBlockReason(input: {
  types: DocumentTypeRecord[];
  documents: DealDocumentRecord[];
  hasDeveloper: boolean;
  managerCount: number;
  /** Mês-base congelado (`YYYY-MM`), quando houver. */
  closedMonth?: string | null;
  /** Mês-base cujo fechamento não pôde ser confirmado (`YYYY-MM`): a consulta de
   *  `closed_months` falhou ou ainda não voltou. A trava fecha do mesmo jeito —
   *  o que muda é a frase, que não pode afirmar o que ninguém confirmou. */
  unconfirmedMonth?: string | null;
}): string | null {
  // Primeiro porque é a recusa mais dura e vale para os TRÊS botões que gravam
  // em `deals`: enviar ao gerente, devolver ao corretor e aprovar para o CCA.
  // `deals_guard_closed_month` recusa a transação inteira em mês fechado.
  if (input.closedMonth) {
    return `Mês ${input.closedMonth} fechado: o banco recusa gravação neste negócio até um administrador reabrir o período.`;
  }
  if (input.unconfirmedMonth) {
    return `Não consegui confirmar se o mês ${input.unconfirmedMonth} está fechado: a gravação fica bloqueada até a página recarregar.`;
  }
  if (input.types.length === 0) {
    return "Nenhum tipo de documento está ativo: peça ao CCA para religar o catálogo antes de enviar.";
  }
  if (!input.hasDeveloper) {
    return "Escolha a construtora na aba Detalhes e confirme as alterações antes de enviar.";
  }
  if (input.managerCount === 0) {
    return "Vincule ao menos um gerente ao negócio na aba Detalhes: é quem confere o dossiê.";
  }
  const faltam = missingRequiredTypes(input.types, input.documents);
  return faltam.length > 0
    ? `Anexe os ${faltam.length} tipo(s) obrigatório(s) antes de enviar.`
    : null;
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

// ── Catálogo de tipos de documento ───────────────────────────────────────────

export type DocumentTypeAdminRecord = DocumentTypeRecord & { active: boolean };

/** Inclui os inativos: a tela do catálogo precisa reativar o que foi desligado. */
export async function listDocumentTypesForAdmin(): Promise<DocumentTypeAdminRecord[]> {
  const { data, error } = await supabase
    .from("document_types")
    .select("id,code,label,category,required_for_conversion,allows_multiple,naming_pattern,sort_order,active")
    .order("sort_order");
  if (error) throw dbError("document_types", error);
  return (data ?? []) as DocumentTypeAdminRecord[];
}

export type DocumentTypePatch = Partial<
  Pick<
    DocumentTypeAdminRecord,
    "label" | "required_for_conversion" | "allows_multiple" | "naming_pattern" | "active"
  >
>;

/**
 * Grava a mudança do catálogo e confere o retorno.
 *
 * `document_types_write` é `has_permission('cca.review')` desde a 0059 — a mesma
 * permissão que libera o botão na tela. Para quem não a tem o update casa 0
 * linhas e volta 204 sem erro: sem o `select()` a tela diria "salvo" para quem o
 * banco recusou.
 */
export async function updateDocumentType(id: string, patch: DocumentTypePatch): Promise<void> {
  const { data, error } = await supabase
    .from("document_types").update(patch).eq("id", id).select("id");
  if (error) throw dbError("document_types", error);
  if (!data || data.length === 0) {
    // Mesmo motivo de `deleteDealDocument`: sem `code` a frase não chega ao
    // toast, e "O catálogo continua como estava" não distingue falta de
    // permissão de falha de rede.
    throw dbError("document_types", {
      code: "P0001",
      message:
        "O banco recusou a alteração: só quem tem a permissão «cca.review» edita o catálogo de documentos.",
    });
  }
}
