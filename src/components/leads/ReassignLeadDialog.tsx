import { useId, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { reassignLead, reativarLead, type LeadRecord } from "@/integrations/supabase/leads";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { useInvalidateLeads } from "./data";

/**
 * Repasse manual entre corretores ou realocação pela liderança. Com `reativar`
 * (03/11/2026), o mesmo diálogo devolve um lead perdido/descartado direto a um
 * corretor (`reativar_lead`, 0316).
 */
export function ReassignLeadDialog({
  lead, brokers, onClose, reativar = false,
}: {
  lead: LeadRecord;
  brokers: PersonRecord[];
  onClose: () => void;
  reativar?: boolean;
}) {
  const invalidateLeads = useInvalidateLeads();
  const selectId = useId();
  const [broker, setBroker] = useState("");
  const [saving, setSaving] = useState(false);
  const destinos = brokers.filter((person) => person.id !== lead.assigned_to);

  const submit = async () => {
    if (!broker) return;
    setSaving(true);
    try {
      await (reativar ? reativarLead : reassignLead)(lead.id, broker);
      const nome = brokers.find((person) => person.id === broker)?.name;
      toast({
        variant: "success",
        title: reativar ? "Lead reativado" : "Lead realocado",
        description: nome
          ? `Agora com ${nome}. A trava de atendimento reiniciou.`
          : "A trava de atendimento reiniciou.",
      });
      await invalidateLeads();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: reativar ? "Não foi possível reativar o lead" : "Não foi possível realocar o lead",
        description: describeError(err, "tente de novo"),
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
            <UserPlus className="h-5 w-5 text-primary" aria-hidden /> {reativar ? "Reativar lead" : "Repassar lead"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{lead.name}</span>
            {reativar
              ? " volta a ficar em aberto, direto com o corretor escolhido. O motivo do encerramento sai do lead e fica no histórico."
              : " — a trava de atendimento reinicia para o novo corretor."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={selectId}>Corretor</Label>
          <Select value={broker} onValueChange={setBroker}>
            <SelectTrigger id={selectId}><SelectValue placeholder="Selecione o corretor" /></SelectTrigger>
            <SelectContent>
              {destinos.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}{person.team ? ` — ${person.team}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {destinos.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum outro corretor ativo está disponível para receber este lead.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" onClick={submit} disabled={!broker || saving}>
            {saving ? (reativar ? "Reativando…" : "Repassando…") : (reativar ? "Reativar e entregar" : "Repassar lead")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
