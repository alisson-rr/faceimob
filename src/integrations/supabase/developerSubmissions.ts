import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Fila de envio do dossiê para a construtora — o passo que fecha a esteira do CCA.
 *
 * A tabela guarda um *snapshot* dos documentos (`document_ids`): o que foi
 * enviado naquele momento continua registrado mesmo que o documento seja
 * substituído depois. Por isso a lista de ids é gravada, e não recalculada na
 * hora de exibir o histórico.
 *
 * O disparo do e-mail em si é outra peça (Brevo). Aqui a submissão nasce
 * `queued` e o worker muda o status — separar as duas coisas é o que permite
 * reprocessar uma falha sem remontar o envio.
 */

export type SubmissionStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";

export type DeveloperSubmissionRecord = {
  id: string;
  deal_id: string;
  developer_id: string;
  to_email: string;
  cc_emails: string[] | null;
  subject: string;
  body: string | null;
  document_ids: string[];
  status: SubmissionStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  queued: "Na fila",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export async function listDealSubmissions(dealId: string): Promise<DeveloperSubmissionRecord[]> {
  const { data, error } = await supabase
    .from("developer_submissions")
    .select("id,deal_id,developer_id,to_email,cc_emails,subject,body,document_ids,status,attempts,last_error,sent_at,created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("listar envios à construtora", error);
  return (data ?? []) as DeveloperSubmissionRecord[];
}

export type CreateSubmissionInput = {
  dealId: string;
  developerId: string;
  toEmail: string;
  ccEmails: string[];
  subject: string;
  body: string;
  documentIds: string[];
};

export async function createDeveloperSubmission(input: CreateSubmissionInput): Promise<DeveloperSubmissionRecord> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("developer_submissions")
    .insert({
      deal_id: input.dealId,
      developer_id: input.developerId,
      to_email: input.toEmail,
      cc_emails: input.ccEmails.length > 0 ? input.ccEmails : null,
      subject: input.subject,
      body: input.body || null,
      document_ids: input.documentIds,
      requested_by: auth.user?.id ?? null,
    })
    .select("id,deal_id,developer_id,to_email,cc_emails,subject,body,document_ids,status,attempts,last_error,sent_at,created_at")
    .single();
  if (error) throw dbError("criar envio à construtora", error);
  return data as DeveloperSubmissionRecord;
}

/**
 * O RLS de `developer_submissions_write` é `has_permission('cca.review')` e não
 * ERRA ao recusar: filtra a linha e o PostgREST devolve 204 sem corpo. Sem
 * `select("id")`, um `update` que não casou linha nenhuma é indistinguível de
 * um que gravou — e a tela comemora uma ação que não aconteceu.
 */
const SEM_PERMISSAO = "Sem permissão para mexer na fila de envio (apenas quem revisa a esteira do CCA).";

/** Recoloca na fila um envio que falhou, sem remontar assunto, corpo e anexos. */
export async function requeueSubmission(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("developer_submissions")
    // attempts volta a zero: o worker ignora linhas acima do limite de
    // tentativas, e reenfileirar sem zerar era um botão que não fazia nada.
    .update({ status: "queued", last_error: null, attempts: 0 })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("reenfileirar envio", error);
  if (!data?.length) throw new Error(SEM_PERMISSAO);
}

export async function cancelSubmission(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("developer_submissions")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("cancelar envio", error);
  if (!data?.length) throw new Error(SEM_PERMISSAO);
}

/** Split tolerante para o campo de cópias: aceita vírgula, ponto e vírgula ou
 *  espaço, que é como as pessoas realmente colam uma lista de e-mails. */
export function parseCcEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Formato de e-mail — o MESMO do check `developers_submission_email_format`
 * (0063). Deliberadamente frouxo: a validação forte de e-mail é a entrega.
 *
 * Vale para o cadastro da construtora também: `submit_deal_for_analysis` copia
 * `developers.submission_email` para `developer_submissions.to_email`, e é para
 * esse endereço que a edge `submission-dispatch` manda o dossiê pelo Brevo. Um
 * e-mail torto ali não dá erro em lugar nenhum — o dossiê só não chega.
 */
export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

export function invalidEmails(list: string[]): string[] {
  return list.filter((e) => !isEmail(e));
}
