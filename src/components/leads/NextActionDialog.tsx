import { useId, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { updateLead, type LeadRecord } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";
import { nextActionPreset, toDateTimeInput } from "./model";

const PRESETS: { key: "2h" | "amanha" | "3d"; label: string }[] = [
  { key: "2h", label: "Em 2 horas" },
  { key: "amanha", label: "Amanhã, 9h" },
  { key: "3d", label: "Em 3 dias" },
];

/**
 * Próxima ação do lead — o compromisso que o corretor marca para si.
 *
 * É este campo que faz o lead "atrasar" (`overdue_lead_count`) e alimenta o
 * bloqueio de check-in em 20 leads atrasados. Até aqui ele só nascia de uma
 * tarefa com data na aba Agenda: quem nunca criava tarefa nunca era barrado, e
 * o bloqueio era opcional na prática. Agora "Atender" pergunta na hora, e o
 * card de atrasados oferece o reagendamento em vez de só cobrar.
 *
 * O `<input type="datetime-local">` é do navegador de propósito: já tem
 * calendário, teclado e leitor de tela em pt-BR, e o campo é uma data e hora —
 * nada aqui justifica um seletor próprio.
 */
export function NextActionDialog({
  lead, onClose, onSaved,
}: {
  lead: LeadRecord;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const fieldId = useId();
  const [value, setValue] = useState(() =>
    toDateTimeInput(lead.next_action_at ? new Date(lead.next_action_at) : nextActionPreset("amanha")),
  );
  const [saving, setSaving] = useState(false);

  const parsed = value ? new Date(value) : null;
  const invalid = !parsed || Number.isNaN(parsed.getTime());

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      await updateLead(lead.id, { next_action_at: parsed.toISOString() });
      toast({
        title: "Próxima ação marcada",
        description: `${lead.name}: ${dateTime(parsed.toISOString())}.`,
      });
      await invalidateLeads();
      onSaved?.();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível marcar a próxima ação",
        description: describeError(err, "sem permissão para editar este lead"),
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
            <CalendarClock className="h-5 w-5 text-primary" aria-hidden /> Próxima ação
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{lead.name}</span> — quando você volta a
            falar com este cliente. Passou da hora e o lead conta como atrasado; 20 atrasados travam
            seu check-in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>Data e hora</Label>
          <Input
            id={fieldId}
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={invalid || undefined}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setValue(toDateTimeInput(nextActionPreset(preset.key)))}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Agora não</Button></DialogClose>
          <Button size="sm" onClick={save} disabled={invalid || saving}>
            {saving ? "Marcando…" : "Marcar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
