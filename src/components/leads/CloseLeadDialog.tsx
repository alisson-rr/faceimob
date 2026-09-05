import { useId, useState } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import {
  closeLead, LEAD_CLOSE_REASONS, LEAD_CLOSE_STATUSES, type LeadRecord,
} from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";

/**
 * Encerrar o lead como perdido ou descartado, com motivo.
 *
 * A ação que faltava no bloco inteiro. `next_action_at` vencido é o que conta
 * em `overdue_lead_count` e trava o check-in em 20 atrasados — e até aqui só
 * reagendar ou converter tirava o lead da conta. Na prática o bloqueio era
 * contornável por reagendamento infinito: a trava punia quem é honesto, e um
 * lead que nunca vai responder ficava atrasado para sempre.
 *
 * Motivo por lista curta e fixa, como o `LoseDealDialog` do Pipeline: texto
 * livre não soma em relatório, e o gestor precisa contar "quantos perdemos por
 * preço". A observação complementa, não substitui.
 *
 * Nada é pré-selecionado: "Perdido" e "Sem interesse" prontos no campo fazem
 * qualquer clique distraído gravar um motivo que ninguém escolheu.
 */
export function CloseLeadDialog({
  lead, onClose, onClosed,
}: {
  lead: LeadRecord;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const id = useId();
  const [status, setStatus] = useState<"lost" | "discarded" | "">("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const pronto = Boolean(status) && Boolean(reason);

  const confirm = async () => {
    if (!pronto || !status) return;
    setSaving(true);
    try {
      const texto = notes.trim() ? `${reason} — ${notes.trim()}` : reason;
      await closeLead(lead.id, status, texto);
      toast({
        title: status === "lost" ? "Lead marcado como perdido" : "Lead descartado",
        description: `${lead.name} — ${reason}. Ele sai da contagem de leads atrasados.`,
      });
      await invalidateLeads();
      onClosed?.();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível encerrar o lead",
        description: describeError(err, "o lead continua aberto no servidor"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" aria-hidden /> Encerrar lead
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{lead.name}</span> sai da operação e deixa
            de contar como atrasado. O motivo fica no histórico do lead — é ele que responde
            &ldquo;por que perdemos&rdquo; no relatório.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-status`}>Como encerrar</Label>
            <Select value={status} onValueChange={(next) => setStatus(next as "lost" | "discarded")}>
              <SelectTrigger id={`${id}-status`}>
                <SelectValue placeholder="Escolha perdido ou descartado" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_CLOSE_STATUSES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} — {option.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id={`${id}-reason`}>
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_CLOSE_REASONS.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-notes`}>Observação (opcional)</Label>
            <Textarea
              id={`${id}-notes`}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="O que aconteceu, em uma linha."
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" variant="destructive" onClick={confirm} disabled={!pronto || saving}>
            {saving ? "Encerrando…" : "Encerrar lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
