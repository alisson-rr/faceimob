import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { describeError } from "@/lib/supabaseError";
import { closeCcaContract, type CcaDeal } from "./ccaData";

export function CcaCloseContractDialog({ deal, onClose, onDone }: {
  deal: CcaDeal;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const id = useId();
  const [outcome, setOutcome] = useState<"QUEDA" | "DISTRATO" | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!outcome || !reason.trim()) return;
    setSaving(true);
    try {
      await closeCcaContract(deal.dealId, outcome, reason.trim());
      toast.success(`${outcome} registrada`, { description: `${deal.client} saiu do contrato com a justificativa registrada.` });
      await onDone();
      onClose();
    } catch (error) {
      toast.error("Não foi possível encerrar o contrato", {
        description: describeError(error, "O contrato continua como estava."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
            Encerrar contrato de {deal.client}
          </DialogTitle>
          <DialogDescription>
            QUEDA vale para o mês vigente; DISTRATO, para qualquer mês anterior. A justificativa é obrigatória e fica no histórico.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor={`${id}-outcome`}>Desfecho</Label>
            <Select value={outcome} onValueChange={(value: "QUEDA" | "DISTRATO") => setOutcome(value)}>
              <SelectTrigger id={`${id}-outcome`} className="mt-1"><SelectValue placeholder="Escolha queda ou distrato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="QUEDA">QUEDA — mês vigente</SelectItem>
                <SelectItem value="DISTRATO">DISTRATO — mês anterior</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-reason`}>Justificativa obrigatória</Label>
            <Textarea
              id={`${id}-reason`} rows={4} maxLength={1800} className="mt-1"
              value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="Explique por que o contrato recebeu este desfecho…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" disabled={saving || !outcome || !reason.trim()} onClick={() => void confirm()}>
            {saving ? "Registrando…" : "Confirmar desfecho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
