import { useId, useState } from "react";
import { CalendarClock, HandMetal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { claimLead, updateLead, type LeadRecord } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";
import { nextActionPreset, toDateTimeInput } from "./model";

const PRESETS: { key: "2h" | "amanha" | "48h" | "3d"; label: string }[] = [
  { key: "2h", label: "Em 2 horas" },
  { key: "amanha", label: "Amanhã, 9h" },
  { key: "48h", label: "Em 48 horas" },
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
  lead, onClose, onSaved, pegar = false,
}: {
  lead: LeadRecord;
  onClose: () => void;
  onSaved?: () => void;
  /**
   * "Pegar lead" (pedido de 05/10/2026): o mesmo campo de data, mas gravar é
   * `claim_lead` — o lead passa a ser do corretor, vai para "conversa
   * iniciada" e ganha a atividade "Retornar contato" com esse prazo.
   */
  pegar?: boolean;
}) {
  const invalidateLeads = useInvalidateLeads();
  const fieldId = useId();
  const [value, setValue] = useState(() =>
    toDateTimeInput(!pegar && lead.next_action_at ? new Date(lead.next_action_at) : nextActionPreset("amanha")),
  );
  const [saving, setSaving] = useState(false);

  const parsed = value ? new Date(value) : null;
  const invalid = !parsed || Number.isNaN(parsed.getTime());

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      if (pegar) await claimLead(lead.id, parsed);
      else await updateLead(lead.id, { next_action_at: parsed.toISOString() });
      toast({
        variant: "success",
        title: pegar ? "Lead é seu! Fale com ele agora" : "Próxima ação marcada",
        description: pegar
          ? `${lead.name}: retorno marcado para ${dateTime(parsed.toISOString())}. A atividade já está na sua agenda.`
          : `${lead.name}: ${dateTime(parsed.toISOString())}.`,
      });
      await invalidateLeads();
      onSaved?.();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: pegar ? "Não foi possível pegar o lead" : "Não foi possível marcar a próxima ação",
        description: describeError(err, "tente de novo"),
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
            {pegar
              ? <><HandMetal className="h-5 w-5 text-primary" aria-hidden /> Pegar lead</>
              : <><CalendarClock className="h-5 w-5 text-primary" aria-hidden /> Próxima ação</>}
          </DialogTitle>
          <DialogDescription>
            {pegar ? (
              <>
                <span className="font-medium text-foreground">{lead.name}</span> passa a ser seu ao
                confirmar. Escolha quando vai retornar o contato: vira uma atividade na sua agenda.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{lead.name}</span> — quando você volta a
                falar com este cliente. Passou da hora e o lead conta como atrasado; 20 atrasados travam
                seu check-in.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>{pegar ? "Retornar o contato em" : "Data e hora"}</Label>
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
          <DialogClose asChild><Button variant="outline" size="sm">{pegar ? "Cancelar" : "Agora não"}</Button></DialogClose>
          <Button size="sm" onClick={save} disabled={invalid || saving}>
            {pegar ? (saving ? "Pegando…" : "Pegar lead") : (saving ? "Marcando…" : "Marcar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
