import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelSubmission,
  createDeveloperSubmission,
  invalidEmails,
  listDealSubmissions,
  parseCcEmails,
  requeueSubmission,
  SUBMISSION_STATUS_LABEL,
  type DeveloperSubmissionRecord,
} from "@/integrations/supabase/developerSubmissions";
import { listDealDocuments, type DealDocumentRecord } from "@/integrations/supabase/documents";

type Props = {
  open: boolean;
  onClose: () => void;
  dealId: string;
  clientName: string;
  developerName: string;
};

const formatDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

/**
 * Monta o envio do dossiê para a construtora e acompanha o status.
 *
 * Só documentos vigentes entram na seleção: mandar uma versão já substituída
 * seria retrabalho garantido do outro lado. O que foi escolhido fica gravado em
 * `document_ids`, então o histórico continua fiel mesmo depois de uma troca.
 */
export default function DeveloperSubmissionDialog({ open, onClose, dealId, clientName, developerName }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [docs, setDocs] = useState<DealDocumentRecord[]>([]);
  const [history, setHistory] = useState<DeveloperSubmissionRecord[]>([]);
  const [developerId, setDeveloperId] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [ccRaw, setCcRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [documents, submissions, dealRow] = await Promise.all([
        listDealDocuments(dealId),
        listDealSubmissions(dealId),
        supabase.from("deals").select("developer_id").eq("id", dealId).maybeSingle(),
      ]);
      const current = documents.filter((d) => !d.superseded_at);
      setDocs(current);
      setHistory(submissions);
      setDeveloperId((dealRow.data as { developer_id: string | null } | null)?.developer_id ?? null);
      setSelected(new Set(current.map((d) => d.id)));
      setSubject(`Dossiê — ${clientName}`);
    } catch (e) {
      toast({
        title: "Falha ao carregar o envio",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [dealId, clientName, toast]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const cc = useMemo(() => parseCcEmails(ccRaw), [ccRaw]);
  const badCc = useMemo(() => invalidEmails(cc), [cc]);
  const badTo = useMemo(() => invalidEmails(toEmail.trim() ? [toEmail.trim()] : []), [toEmail]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!developerId) {
      return toast({ title: "Negócio sem construtora", description: "Defina a construtora no negócio antes de enviar.", variant: "destructive" });
    }
    if (badTo.length > 0 || !toEmail.trim()) {
      return toast({ title: "Destinatário inválido", variant: "destructive" });
    }
    if (badCc.length > 0) {
      return toast({ title: "Cópia inválida", description: badCc.join(", "), variant: "destructive" });
    }
    if (selected.size === 0) {
      return toast({ title: "Selecione ao menos um documento", variant: "destructive" });
    }

    setSending(true);
    try {
      await createDeveloperSubmission({
        dealId,
        developerId,
        toEmail: toEmail.trim(),
        ccEmails: cc,
        subject: subject.trim() || `Dossiê — ${clientName}`,
        body,
        documentIds: [...selected],
      });
      await load();
      toast({
        title: "Envio na fila",
        description: "O disparo do e-mail acontece pelo worker; acompanhe o status abaixo.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível enfileirar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const act = async (fn: (id: string) => Promise<void>, id: string, okTitle: string) => {
    try {
      await fn(id);
      await load();
      toast({ title: okTitle });
    } catch (e) {
      toast({
        title: "Ação não concluída",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar dossiê para a construtora</DialogTitle>
          <DialogDescription>
            {clientName}{developerName ? ` · ${developerName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground text-xs gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Destinatário</Label>
                <Input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="analise@construtora.com.br"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cópias (opcional)</Label>
                <Input
                  value={ccRaw}
                  onChange={(e) => setCcRaw(e.target.value)}
                  placeholder="separe por vírgula"
                  className="h-9 text-xs"
                />
                {badCc.length > 0 && (
                  <p className="text-[10px] text-destructive">Inválido: {badCc.join(", ")}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Assunto</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 text-xs" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Mensagem</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="text-xs" />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Documentos ({selected.size} de {docs.length})</Label>
              {docs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">
                  Nenhum documento vigente neste negócio. Anexe na aba de documentos antes de enviar.
                </p>
              ) : (
                <div className="space-y-1 rounded-md border border-border/50 p-2">
                  {docs.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                      <span className="truncate">{d.stored_name}</span>
                      <span className="text-muted-foreground">v{d.version}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Envios anteriores</Label>
                <div className="space-y-1">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 text-[10px]">
                      <span className="truncate">
                        <Badge variant={h.status === "sent" ? "default" : h.status === "failed" ? "destructive" : "outline"} className="text-[9px] mr-1">
                          {SUBMISSION_STATUS_LABEL[h.status]}
                        </Badge>
                        {h.to_email} · {h.document_ids.length} doc(s) · {formatDate(h.created_at)}
                        {h.last_error && <span className="text-destructive"> · {h.last_error}</span>}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {h.status === "failed" && (
                          <button type="button" onClick={() => act(requeueSubmission, h.id, "Reenfileirado")} className="text-primary flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" /> Reenviar
                          </button>
                        )}
                        {(h.status === "queued" || h.status === "failed") && (
                          <button type="button" onClick={() => act(cancelSubmission, h.id, "Envio cancelado")} className="text-muted-foreground flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> Cancelar
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={submit} disabled={loading || sending || docs.length === 0} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enfileirar envio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
