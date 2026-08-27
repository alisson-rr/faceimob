import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { supabase } from "@/integrations/supabase/client";
import type { StatusTone } from "@/components/shared";
import {
  CCA_STATUS_OPTIONS, CCA_TONE_CLASS, CCA_TONE_OPTIONS, ccaStageTone, ccaStatusLabel,
  type CcaCaseStatus,
} from "./ccaStage";
import type { CcaStage } from "./ccaData";

/**
 * Criar, renomear, recolorir e excluir estágio da esteira.
 *
 * Duas correções: o **desfecho** passa a ser escolhido (P10) e a **cor** é
 * gravada como chave semântica, não como classe do Tailwind (T14). Excluir pede
 * confirmação em `AlertDialog` — era `window.confirm`, que alguns navegadores
 * suprimem e que não é estilizável nem anunciável.
 */
export function CcaStageSettingsDialog({ stages, onClose, onChanged }: {
  stages: CcaStage[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<CcaStage | null>(null);
  const [name, setName] = useState("");
  const [tone, setTone] = useState<StatusTone>("info");
  const [status, setStatus] = useState<CcaCaseStatus>("under_review");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<CcaStage | null>(null);

  const reset = () => { setEditing(null); setName(""); setTone("info"); setStatus("under_review"); };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // A coluna guarda a CHAVE semântica, nunca a classe do Tailwind.
      const payload = { name: name.trim(), color: tone, status };
      const { error } = editing
        ? await supabase.from("cca_stages").update(payload).eq("id", editing.id)
        : await supabase.from("cca_stages").insert({ ...payload, position: stages.length + 1 });
      if (error) throw error;
      toast({ title: editing ? "Estágio atualizado" : "Estágio criado" });
      reset();
      await onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar o estágio",
        description: describeError(err, "Tente de novo."),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (stage: CcaStage) => {
    try {
      const { error } = await supabase.from("cca_stages").delete().eq("id", stage.id);
      if (error) throw error;
      toast({ title: "Estágio excluído" });
      await onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir o estágio",
        description: describeError(err, "Talvez existam casos nele."),
      });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar "${editing.name}"` : "Gerenciar estágios do CCA"}</DialogTitle>
            <DialogDescription>
              O desfecho liga o estágio ao ciclo fixo do crédito: é ele que decide o caso e move o
              negócio no Pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="cca-stage-name">Nome</Label>
              <Input
                id="cca-stage-name" className="mt-1" value={name} placeholder="Ex.: Conferência final"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cca-stage-tone">Cor</Label>
              <Select value={tone} onValueChange={(value) => setTone(value as StatusTone)}>
                <SelectTrigger id="cca-stage-tone" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CCA_TONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cca-stage-status">Desfecho</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as CcaCaseStatus)}>
                <SelectTrigger id="cca-stage-status" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CCA_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>
                <Plus className="mr-1 h-4 w-4" /> {editing ? "Salvar" : "Criar estágio"}
              </Button>
              {editing && <Button size="sm" variant="ghost" onClick={reset}>Cancelar edição</Button>}
            </div>
          </div>

          <ul className="space-y-2">
            {stages.map((stage) => (
              <li key={stage.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", CCA_TONE_CLASS[ccaStageTone(stage.color)].dot)} aria-hidden />
                  <span className="truncate text-xs font-medium">{stage.name}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">· {ccaStatusLabel(stage.status)}</span>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    aria-label={`Editar o estágio ${stage.name}`}
                    onClick={() => {
                      setEditing(stage);
                      setName(stage.name);
                      setTone(ccaStageTone(stage.color));
                      setStatus(stage.status);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                    aria-label={`Excluir o estágio ${stage.name}`}
                    onClick={() => setRemoving(stage)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {removing && (
        <AlertDialog open onOpenChange={(open) => !open && setRemoving(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o estágio "{removing.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Os casos que estiverem nele ficam sem estágio e passam a aparecer no primeiro da
                esteira. Não dá para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={(event) => { event.preventDefault(); void remove(removing); }}>
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
