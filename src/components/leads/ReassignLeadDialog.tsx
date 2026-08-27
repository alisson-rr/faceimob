import { useId, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { reassignLead, type LeadRecord } from "@/integrations/supabase/leads";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { useInvalidateLeads } from "./data";

/** Realocação manual por gestor (`reassign_lead`). Reinicia a trava de atendimento. */
export function ReassignLeadDialog({
  lead, brokers, onClose,
}: {
  lead: LeadRecord;
  brokers: PersonRecord[];
  onClose: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const selectId = useId();
  const [broker, setBroker] = useState(lead.assigned_to ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!broker) return;
    setSaving(true);
    try {
      await reassignLead(lead.id, broker);
      toast({ title: "Lead realocado", description: "A trava de atendimento reiniciou." });
      await invalidateLeads();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao realocar",
        description: describeError(err, "sem permissão ou corretor inválido"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden /> Realocar lead
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{lead.name}</span> — a trava de atendimento
            reinicia para o novo corretor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={selectId}>Corretor</Label>
          <Select value={broker} onValueChange={setBroker}>
            <SelectTrigger id={selectId}><SelectValue placeholder="Selecione o corretor" /></SelectTrigger>
            <SelectContent>
              {brokers.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}{person.team ? ` — ${person.team}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {brokers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum corretor visível para você. Confira a equipe em Equipes.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" onClick={submit} disabled={!broker || saving}>
            {saving ? "Realocando…" : "Realocar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
