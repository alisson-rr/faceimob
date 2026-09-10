import { useId, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { createLead, updateLead, type LeadRecord, type LeadSource } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";

/**
 * Formulário de lead (novo e edição).
 *
 * O componente é montado pelo pai só enquanto o diálogo está aberto e recebe
 * `key` por lead: o estado inicial sai das props na montagem, sem `useEffect`
 * copiando prop para estado — era daí que vinha o formulário abrir com os dados
 * do lead anterior.
 */
export function LeadFormDialog({
  lead, sources, onClose,
}: {
  lead: LeadRecord | null;
  sources: LeadSource[];
  onClose: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const fieldId = useId();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: lead?.full_name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    document: lead?.document ?? "",
    source_id: lead?.source_id ?? "",
    notes: lead?.notes ?? "",
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (!form.full_name.trim()) return;
    setSaving(true);
    try {
      if (lead) {
        await updateLead(lead.id, {
          full_name: form.full_name,
          phone: form.phone || null,
          email: form.email || null,
          document: form.document || null,
          source_id: form.source_id || null,
          notes: form.notes || null,
        });
        toast({ title: "Lead atualizado" });
      } else {
        await createLead({
          full_name: form.full_name,
          phone: form.phone,
          email: form.email,
          document: form.document,
          source_id: form.source_id || null,
          notes: form.notes,
        });
        toast({ title: "Lead criado", description: "Entrou na fila de distribuição. A roleta atribui o corretor." });
      }
      await invalidateLeads();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: describeError(err, "não foi possível gravar o lead"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
          {!lead && (
            <DialogDescription className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />
              O lead entra na fila e a roleta escolhe o corretor entre quem está com check-in aberto.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-nome`}>Nome *</Label>
            <Input id={`${fieldId}-nome`} value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-email`}>E-mail</Label>
            <Input id={`${fieldId}-email`} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-fone`}>Telefone / WhatsApp</Label>
            <Input id={`${fieldId}-fone`} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-doc`}>CPF / documento</Label>
            <Input id={`${fieldId}-doc`} value={form.document} onChange={(e) => set({ document: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-origem`}>Origem</Label>
            <Select value={form.source_id} onValueChange={(source_id) => set({ source_id })}>
              <SelectTrigger id={`${fieldId}-origem`}><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-notas`}>Observações</Label>
            <Textarea id={`${fieldId}-notas`} rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={save} disabled={!form.full_name.trim() || saving}>
            {saving ? "Salvando…" : lead ? "Salvar" : "Criar lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
