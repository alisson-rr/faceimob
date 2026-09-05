import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Loader2, RotateCcw, XCircle } from "lucide-react";
import { LoadingState } from "@/components/shared";
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
import {
  listDealDocuments,
  missingStoragePaths,
  type DealDocumentRecord,
} from "@/integrations/supabase/documents";
import { dbError, describeError } from "@/lib/supabaseError";

type Props = {
  open: boolean;
  onClose: () => void;
  dealId: string;
  clientName: string;
  developerName: string;
  /** Recarrega o quadro da esteira: enfileirar move o caso para "Enviado à
   *  Construtora" (gatilho da 0077) e a tela por baixo continuava no estágio
   *  antigo até alguém dar F5. `CcaMoveDialog` já fazia isto. */
  onChanged?: () => void | Promise<void>;
};

type Construtora = {
  flow: "internal" | "external";
  submission_email: string | null;
};

const formatDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");

/**
 * Monta o envio do dossiê para a construtora e acompanha o status.
 *
 * Só documentos vigentes entram na seleção: mandar uma versão já substituída
 * seria retrabalho garantido do outro lado. O que foi escolhido fica gravado em
 * `document_ids`, então o histórico continua fiel mesmo depois de uma troca.
 */
export default function DeveloperSubmissionDialog({
  open, onClose, dealId, clientName, developerName, onChanged,
}: Props) {
  const { toast } = useToast();
  const campo = useId();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [docs, setDocs] = useState<DealDocumentRecord[]>([]);
  const [history, setHistory] = useState<DeveloperSubmissionRecord[]>([]);
  const [developerId, setDeveloperId] = useState<string | null>(null);
  const [construtora, setConstrutora] = useState<Construtora | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [ccRaw, setCcRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Documentos cuja linha existe mas o arquivo não. `null` = não conferido. */
  const [semArquivo, setSemArquivo] = useState<Set<string> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [documents, submissions, dealRow] = await Promise.all([
        listDealDocuments(dealId),
        listDealSubmissions(dealId),
        // O cadastro da construtora vem junto: `submission_email` é o
        // destinatário oficial do dossiê (é o que `submit_deal_for_analysis`
        // copia para `developer_submissions.to_email`) e `flow` diz se esta
        // construtora recebe dossiê ou se a análise é interna. Sem os dois, o
        // campo "Para" nascia vazio e o analista redigitava o endereço a cada
        // envio — errar uma letra ali não dá erro em lugar nenhum: o dossiê
        // simplesmente não chega.
        supabase
          .from("deals")
          .select("developer_id,developers(flow,submission_email)")
          .eq("id", dealId)
          .maybeSingle(),
      ]);
      // O builder do PostgREST resolve com `{data, error}` em vez de lançar: sem
      // esta linha uma falha de RLS, de rede ou uma mudança no embed deixava
      // `deal` nulo em SILÊNCIO — o campo "Para" nascia vazio sem explicação, os
      // dois avisos de cadastro sumiam e "Enfileirar envio" acusava "Negócio sem
      // construtora" num negócio que TEM construtora. Os outros dois itens do
      // `Promise.all` já lançam por `dbError`; este era o único que engolia.
      if (dealRow.error) throw dbError("deals", dealRow.error);

      const current = documents.filter((d) => !d.superseded_at);
      const deal = dealRow.data as
        | { developer_id: string | null; developers: Construtora | null }
        | null;
      setDocs(current);
      setHistory(submissions);
      setDeveloperId(deal?.developer_id ?? null);
      setConstrutora(deal?.developers ?? null);
      // Só preenche o que está vazio: reabrir o diálogo depois de o analista
      // digitar outro destinatário não pode desfazer a escolha dele.
      setToEmail((atual) => atual || deal?.developers?.submission_email || "");
      setSubject(`Dossiê — ${clientName}`);

      // O worker lê cada documento do bucket na hora do disparo: registro sem
      // arquivo vira dossiê incompleto na caixa da construtora, e ninguém deste
      // lado descobre. A conferência é aqui, não depois. Falha da conferência
      // não pode esvaziar a seleção — `null` mantém o comportamento anterior.
      let ausentes: Set<string> | null = null;
      try {
        ausentes = await missingStoragePaths(current.map((d) => d.storage_path));
      } catch (falha) {
        console.warn("[envio] não deu para conferir os arquivos no bucket:", falha);
      }
      setSemArquivo(ausentes);
      setSelected(
        new Set(current.filter((d) => !ausentes?.has(d.storage_path)).map((d) => d.id)),
      );
    } catch (e) {
      toast({
        title: "Falha ao carregar o envio",
        description: describeError(e, "Não foi possível carregar os dados do envio."),
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
      await onChanged?.();
      toast({
        title: "Envio na fila",
        description: "O disparo do e-mail acontece pelo worker; acompanhe o status abaixo.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível enfileirar",
        description: describeError(e, "Não foi possível enfileirar o envio para a construtora."),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  /**
   * Age na linha e SÓ comemora depois de reler o status.
   *
   * `cancelSubmission`/`requeueSubmission` fazem `update` sem `select`: se a RLS
   * (`developer_submissions_write` = `cca.review`) casar 0 linhas, o PostgREST
   * devolve 204 sem erro. Pior no "Cancelar" de um envio em voo: o worker grava
   * 'sent' ao terminar sem reler o status, então o cancelamento pode ser
   * sobrescrito — e um toast otimista diria "cancelado" com o dossiê já a
   * caminho do cliente. Aqui a linha recarregada é a prova.
   */
  const act = async (
    fn: (id: string) => Promise<void>,
    row: DeveloperSubmissionRecord,
    okTitle: string,
    esperado: DeveloperSubmissionRecord["status"],
  ) => {
    try {
      await fn(row.id);
      const linhas = await listDealSubmissions(dealId);
      setHistory(linhas);
      const atual = linhas.find((h) => h.id === row.id);
      if (atual && atual.status !== esperado) {
        return toast({
          title: "Ação não registrada",
          description: `O envio continua como "${SUBMISSION_STATUS_LABEL[atual.status]}". Confira sua permissão na esteira e tente de novo.`,
          variant: "destructive",
        });
      }
      toast({
        title: okTitle,
        // Honestidade sobre o que a tela NÃO controla: o worker marca 'sent' ao
        // terminar sem reler o status (submission-dispatch), então cancelar em
        // pleno voo pode chegar tarde.
        description: row.status === "sending"
          ? "O disparo já estava em andamento: se o worker terminar antes de reler a linha, o e-mail ainda pode sair."
          : undefined,
      });
    } catch (e) {
      toast({
        title: "Ação não concluída",
        description: describeError(e, "Não foi possível atualizar o envio à construtora."),
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
          <LoadingState variant="list" rows={3} label="Carregando o envio…" />
        ) : (
          <div className="space-y-4">
            {/* O cartão da esteira oferece "Enviar à construtora" em TODO caso,
                inclusive nos de fluxo interno — onde a análise é do próprio CCA
                e não existe endereço cadastrado. Em vez de deixar o analista
                descobrir isso digitando um e-mail de memória, o diálogo diz o
                que o cadastro da construtora afirma. Continua sendo possível
                enviar: há caso legítimo de mandar o dossiê para um contato
                pontual — o que não pode é o envio parecer o caminho normal. */}
            {construtora?.flow === "internal" && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                <strong>{developerName || "Esta construtora"}</strong> está cadastrada como fluxo
                interno: a análise de crédito é feita aqui e não há e-mail de envio no cadastro.
                Confirme o destinatário antes de enfileirar, ou cadastre o e-mail em Construtoras.
                Este envio <strong>não move o caso</strong> na esteira — a análise continua onde
                está, e o Status 2 do negócio não vira “ANÁLISE EXTERNA”.
              </p>
            )}
            {construtora?.flow === "external" && !construtora.submission_email && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                Construtora de fluxo externo sem e-mail de envio cadastrado. O endereço digitado
                aqui vale só para este envio.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${campo}-to`} className="text-xs">Destinatário</Label>
                <Input
                  id={`${campo}-to`}
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="analise@construtora.com.br"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${campo}-cc`} className="text-xs">Cópias (opcional)</Label>
                <Input
                  id={`${campo}-cc`}
                  value={ccRaw}
                  onChange={(e) => setCcRaw(e.target.value)}
                  placeholder="separe por vírgula"
                  className="h-9 text-xs"
                />
                {badCc.length > 0 && (
                  <p className="text-xs text-destructive">Inválido: {badCc.join(", ")}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${campo}-subject`} className="text-xs">Assunto</Label>
              <Input id={`${campo}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 text-xs" />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${campo}-body`} className="text-xs">Mensagem</Label>
              <Textarea id={`${campo}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="text-xs" />
            </div>

            <div className="space-y-2">
              {/* Legenda de GRUPO, não rótulo de campo: um `<label>` sem
                  controle associado é ruído para leitor de tela. O nome do
                  grupo vem por `aria-labelledby`. */}
              <p id={`${campo}-docs`} className="text-xs font-medium">
                Documentos ({selected.size} de {docs.length})
              </p>
              {ausentes > 0 && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {ausentes === 1
                    ? "1 documento está registrado no dossiê mas o arquivo não está no armazenamento"
                    : `${ausentes} documentos estão registrados no dossiê mas os arquivos não estão no armazenamento`}
                  : não dá para enviar o que não existe. Anexe de novo na aba Anexos do negócio.
                </p>
              )}
              {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Nenhum documento vigente neste negócio. Anexe na aba de documentos antes de enviar.
                </p>
              ) : (
                <div
                  role="group"
                  aria-labelledby={`${campo}-docs`}
                  className="space-y-1 rounded-md border border-border/50 p-2"
                >
                  {docs.map((d) => (
                    // O Checkbox do Radix é um `<button role="checkbox">` sem
                    // texto próprio: envolvê-lo num `<label>` NÃO lhe dá nome
                    // acessível. Sem `id`/`htmlFor` o leitor de tela anunciava
                    // N vezes "caixa de seleção" sem dizer qual documento.
                    <div key={d.id} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        id={`${campo}-doc-${d.id}`}
                        checked={selected.has(d.id)}
                        onCheckedChange={() => toggle(d.id)}
                      />
                      <Label
                        htmlFor={`${campo}-doc-${d.id}`}
                        className="flex min-w-0 items-center gap-2 text-xs font-normal cursor-pointer"
                      >
                        <span className="truncate">{d.stored_name}</span>
                        <span className="text-muted-foreground">v{d.version}</span>
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* O envio depende de credencial de terceiro. Dizer isso na tela é o
                que separa "ainda não saiu" de "some sem explicação": nenhum
                dossiê é dado como enviado sem o provedor confirmar. */}
            <p className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
              O e-mail sai por um worker que usa a credencial <strong>Brevo</strong> (chave de API e
              e-mail remetente) cadastrada em Integrações. Sem ela o envio fica em “Na fila” ou
              “Falhou”, com o motivo ao lado — e é repescado sozinho quando a credencial entrar.
            </p>

            {history.length > 0 && (
              <div className="space-y-1">
                <p id={`${campo}-historico`} className="text-xs font-medium">Envios anteriores</p>
                <div role="group" aria-labelledby={`${campo}-historico`} className="space-y-1">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 text-xs">
                      <span className="truncate">
                        <Badge variant={h.status === "sent" ? "default" : h.status === "failed" ? "destructive" : "outline"} size="sm" className="mr-1">
                          {SUBMISSION_STATUS_LABEL[h.status]}
                        </Badge>
                        {h.to_email} · {h.document_ids.length} doc(s) · {formatDate(h.created_at)}
                        {h.last_error && <span className="text-destructive"> · {h.last_error}</span>}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {h.status === "failed" && (
                          <button type="button" onClick={() => act(requeueSubmission, h, "Reenfileirado", "queued")} className="text-primary flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" /> Reenviar
                          </button>
                        )}
                        {h.status === "sending" && (
                          <span className="text-muted-foreground">repescado em ~10 min</span>
                        )}
                        {(h.status === "queued" || h.status === "failed" || h.status === "sending") && (
                          <button type="button" onClick={() => act(cancelSubmission, h, "Envio cancelado", "cancelled")} className="text-muted-foreground flex items-center gap-1">
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
