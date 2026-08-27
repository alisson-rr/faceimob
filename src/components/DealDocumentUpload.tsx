import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Download, Paperclip, Loader2, History, CheckCircle2, RotateCcw, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import {
  getDealDocumentReview,
  listDealDocuments,
  listDocumentTypes,
  listMyDealRoles,
  reviewDealDocuments,
  signedDocumentUrl,
  submitDealForManagerReview,
  uploadDealDocument,
  type DealDocumentReview,
  type DealDocumentRecord,
  type DocumentTypeRecord,
} from "@/integrations/supabase/documents";

type Props = {
  dealId: string;
  clientName: string;
  dealCode: string;
  onReviewChanged?: () => void | Promise<void>;
};

const reviewMeta = {
  draft: { label: "Em preparação", className: "border-muted-foreground/40 text-muted-foreground" },
  pending: { label: "Aguardando gerente", className: "border-warning/50 text-warning" },
  returned: { label: "Devolvido para correção", className: "border-destructive/50 text-destructive" },
  approved: { label: "Aprovado pelo gerente", className: "border-success/50 text-success" },
} as const;

const formatSize = (bytes: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Um slot por tipo de documento, com renomeação automática no envio.
 *
 * Antes desta tela os arquivos escolhidos ficavam em `useState` e nunca subiam:
 * o bucket `deal-documents` existia sem nunca ter recebido nada. Versão
 * substituída continua listada — é o histórico que o CCA pediu, e quem marca a
 * anterior é o trigger `deal_documents_supersede`.
 */
export default function DealDocumentUpload({ dealId, clientName, dealCode, onReviewChanged }: Props) {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [types, setTypes] = useState<DocumentTypeRecord[]>([]);
  const [docs, setDocs] = useState<DealDocumentRecord[]>([]);
  const [review, setReview] = useState<DealDocumentReview | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, d, r, roles] = await Promise.all([
        listDocumentTypes(),
        listDealDocuments(dealId),
        getDealDocumentReview(dealId),
        user?.id ? listMyDealRoles(dealId, user.id) : Promise.resolve([]),
      ]);
      setTypes(t);
      setDocs(d);
      setReview(r);
      setMyRoles(roles);
    } catch (e) {
      toast({
        title: "Falha ao carregar documentos",
        description: describeError(e, "Não foi possível carregar os documentos do negócio."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [dealId, toast, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const byType = useMemo(() => {
    const map = new Map<string, DealDocumentRecord[]>();
    for (const d of docs) {
      const list = map.get(d.document_type_id) ?? [];
      list.push(d);
      map.set(d.document_type_id, list);
    }
    return map;
  }, [docs]);

  const handleFiles = async (type: DocumentTypeRecord, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = type.allows_multiple ? Array.from(files) : [files[0]];
    setBusy(type.id);
    try {
      for (const file of chosen) {
        await uploadDealDocument({ dealId, documentType: type, file, clientName, dealCode });
      }
      await load();
      toast({
        title: chosen.length > 1 ? `${chosen.length} arquivos enviados` : "Documento enviado",
        description: type.allows_multiple ? undefined : "A versão anterior foi mantida no histórico.",
      });
    } catch (e) {
      toast({
        title: "Falha no envio",
        description: describeError(e, "Não foi possível anexar o documento."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      // Permite reenviar o mesmo arquivo: sem isto o input não dispara change.
      const el = inputRefs.current[type.id];
      if (el) el.value = "";
    }
  };

  const download = async (doc: DealDocumentRecord) => {
    try {
      const url = await signedDocumentUrl(doc);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({
        title: "Não foi possível baixar",
        description: describeError(e, "O arquivo pode estar fora do seu acesso a este negócio."),
        variant: "destructive",
      });
    }
  };

  const submitForReview = async () => {
    setReviewBusy(true);
    try {
      await submitDealForManagerReview(dealId);
      await load();
      await onReviewChanged?.();
      toast({
        title: "Documentos enviados para conferência",
        description: "Os gerentes vinculados foram notificados.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível enviar",
        description: describeError(e, "Não foi possível enviar os documentos ao gerente."),
        variant: "destructive",
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const decideReview = async (approve: boolean) => {
    setReviewBusy(true);
    try {
      await reviewDealDocuments({ dealId, approve, reason: reviewReason });
      setReviewReason("");
      await load();
      await onReviewChanged?.();
      toast({
        title: approve ? "Documentos aprovados" : "Documentos devolvidos ao corretor",
        description: approve ? "O negócio seguiu para a esteira de análise." : "O corretor recebeu o motivo da devolução.",
      });
    } catch (e) {
      toast({
        title: approve ? "Não foi possível aprovar" : "Não foi possível devolver",
        description: describeError(
          e,
          approve
            ? "Não foi possível aprovar os documentos."
            : "Não foi possível devolver os documentos ao corretor.",
        ),
        variant: "destructive",
      });
    } finally {
      setReviewBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-10 text-muted-foreground text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos...
      </div>
    );
  }

  const missing = types.filter(
    (t) => t.required_for_conversion && !(byType.get(t.id) ?? []).some((d) => !d.superseded_at),
  );
  const status = review?.document_review_status ?? "draft";
  const canSubmit = isAdmin || myRoles.includes("broker");
  const canReview = isAdmin || myRoles.includes("manager");
  const meta = reviewMeta[status];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold">Conferência documental</p>
            <p className="text-xs text-muted-foreground">Corretor → gerente → CCA</p>
          </div>
          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
        </div>

        {status === "returned" && review?.document_review_reason && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <p className="text-xs font-semibold text-destructive">Motivo da devolução</p>
            <p className="text-xs text-foreground mt-0.5">{review.document_review_reason}</p>
          </div>
        )}

        {canSubmit && (status === "draft" || status === "returned") && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {missing.length > 0
                ? `Anexe os ${missing.length} tipo(s) obrigatório(s) antes de enviar.`
                : "Dossiê pronto para o gerente conferir."}
            </p>
            <Button
              size="sm"
              className="h-8 text-xs gap-1 shrink-0"
              disabled={reviewBusy || missing.length > 0}
              onClick={submitForReview}
            >
              {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Enviar ao gerente
            </Button>
          </div>
        )}

        {canReview && status === "pending" && (
          <div className="space-y-2">
            <Textarea
              aria-label="Motivo da devolução"
              value={reviewReason}
              onChange={(event) => setReviewReason(event.target.value)}
              placeholder="Motivo obrigatório somente para devolver ao corretor"
              rows={2}
              maxLength={2000}
              className="text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1 text-destructive border-destructive/40"
                disabled={reviewBusy || !reviewReason.trim()}
                onClick={() => decideReview(false)}
              >
                <RotateCcw className="h-3 w-3" /> Devolver
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1 bg-success hover:bg-success/90 text-success-foreground"
                disabled={reviewBusy}
                onClick={() => decideReview(true)}
              >
                {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Aprovar e enviar ao CCA
              </Button>
            </div>
          </div>
        )}

        {status === "pending" && !canReview && (
          <p className="text-xs text-muted-foreground">Aguardando a decisão de um gerente vinculado ao negócio.</p>
        )}
        {status === "approved" && (
          <p className="text-xs text-success">Conferência concluída. O negócio já seguiu para análise.</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold text-success">Anexar Documentos</p>
        {missing.length > 0 ? (
          <Badge variant="destructive">
            Faltam {missing.length} obrigatório{missing.length > 1 ? "s" : ""}
          </Badge>
        ) : (
          <Badge variant="outline">Obrigatórios completos</Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs gap-1 ml-auto"
          onClick={() => setShowHistory((v) => !v)}
        >
          <History className="h-3 w-3" /> {showHistory ? "Ocultar" : "Ver"} histórico
        </Button>
      </div>

      <div className="space-y-2">
        {types.map((type) => {
          const all = byType.get(type.id) ?? [];
          const current = all.filter((d) => !d.superseded_at);
          const superseded = all.filter((d) => d.superseded_at);
          const visible = showHistory ? all : current;

          return (
            <div key={type.id} className="rounded-lg border border-border/60 bg-muted/10 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-semibold text-foreground flex-1">
                  {type.required_for_conversion && <span className="text-destructive mr-1">*</span>}
                  {type.label}
                  {type.allows_multiple && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">(vários)</span>
                  )}
                </label>
                <input
                  ref={(el) => (inputRefs.current[type.id] = el)}
                  type="file"
                  multiple={type.allows_multiple}
                  className="hidden"
                  onChange={(e) => handleFiles(type, e.target.files)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={busy === type.id}
                  onClick={() => inputRefs.current[type.id]?.click()}
                >
                  {busy === type.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Upload className="h-3 w-3" />}
                  Anexar
                </Button>
              </div>

              {visible.length > 0 ? (
                <div className="space-y-1">
                  {visible.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                        d.superseded_at ? "bg-muted/40 opacity-70" : "bg-success/10"
                      }`}
                    >
                      <span className={`truncate flex items-center gap-1 ${d.superseded_at ? "text-muted-foreground" : "text-success"}`}>
                        <Paperclip className="h-3 w-3 shrink-0" />
                        {d.stored_name}
                        <span className="opacity-70">v{d.version} {formatSize(d.size_bytes)}</span>
                        {d.superseded_at && <span className="italic">· substituído</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => download(d)}
                        aria-label={`Baixar ${d.stored_name}`}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 shrink-0"
                      >
                        <Download className="h-3 w-3" /> Baixar
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhum arquivo anexado</p>
              )}

              {!showHistory && superseded.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  +{superseded.length} versão(ões) no histórico
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
