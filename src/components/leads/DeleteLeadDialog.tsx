import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { deleteLead, type LeadRecord } from "@/integrations/supabase/leads";
import { useInvalidateLeads } from "./data";

/**
 * Exclusão de lead — a permissão `leads.delete` e a policy `leads_delete`
 * existem desde a 0044 e nenhuma tela oferecia o botão.
 *
 * É destrutivo e leva junto histórico, comentários e anexos por cascata: por
 * isso um `AlertDialog` (não fecha por clique fora) e um botão que diz o nome
 * do lead. Quem não tem a permissão nem vê o botão na linha.
 */
export function DeleteLeadDialog({
  lead, onClose, onDeleted,
}: {
  lead: LeadRecord;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const [removing, setRemoving] = useState(false);

  const confirm = async () => {
    setRemoving(true);
    try {
      await deleteLead(lead.id);
      toast({ title: "Lead excluído", description: `${lead.name} saiu da base.` });
      await invalidateLeads();
      onDeleted?.();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível excluir",
        description: describeError(err, "sem permissão para excluir este lead"),
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {lead.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O histórico, os comentários e os anexos do lead vão junto, e não há como desfazer.
            Para tirar o lead da operação sem apagar o rastro, marque-o como perdido ou descartado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => { event.preventDefault(); void confirm(); }}
            disabled={removing}
          >
            {removing ? "Excluindo…" : "Excluir lead"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
