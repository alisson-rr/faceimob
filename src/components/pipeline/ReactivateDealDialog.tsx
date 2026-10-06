import { useId, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord, PersonRecord } from "@/integrations/supabase/newSchema";
import { useReactivateDeal } from "@/integrations/supabase/cca";
import { describeError } from "@/lib/supabaseError";

interface Props {
  deal: LegacyDealRecord;
  people: PersonRecord[];
  onClose: () => void;
  onReactivated: () => void | Promise<void>;
}

/**
 * Reativa somente um OFF histórico. Lideranças escolhem o corretor; para um
 * corretor puro o banco valida que o negócio já era dele. A RPC monta de novo
 * gerente e diretor a partir da equipe atual do corretor escolhido.
 */
export function ReactivateDealDialog({ deal, people, onClose, onReactivated }: Props) {
  const id = useId();
  const { user, roles, isAdmin } = useAuth();
  const mutation = useReactivateDeal();
  const escolheCorretor = isAdmin || roles.some((role) => ["partner", "director", "manager"].includes(role));
  const brokers = useMemo(
    () => people.filter((person) => person.active && person.roles.includes("broker"))
      // Admin/sócio enxergam toda a casa. Gerente e diretor só recebem no
      // seletor os corretores que pertencem à própria liderança; o banco
      // repete a trava para impedir uma chamada forjada.
      .filter((person) => isAdmin || !user?.id
        || person.manager_id === user.id || person.director_id === user.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [people, isAdmin, user?.id],
  );
  const [brokerId, setBrokerId] = useState(escolheCorretor ? "" : (user?.id ?? ""));

  const confirmar = async () => {
    if (!brokerId) return;
    try {
      const result = await mutation.mutateAsync({ dealId: deal.id, brokerId });
      toast.success("Proposta reativada", {
        description: `${deal.client} voltou como Incompleto em ${result.new_month}.`,
      });
      await onReactivated();
      onClose();
    } catch (error) {
      toast.error("Não foi possível reativar a proposta", {
        description: describeError(error, "A proposta continua como OFF."),
      });
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-success" aria-hidden />
            Reativar a proposta de {deal.client}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Ela volta para o mês vigente como <strong className="text-foreground">Incompleto</strong>.
            A equipe será refeita com o gerente e o diretor atuais do corretor escolhido. Somente os
            administradores serão avisados desta reativação.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {escolheCorretor ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-broker`}>Atribuir ao corretor</Label>
            <Select value={brokerId} onValueChange={setBrokerId}>
              <SelectTrigger id={`${id}-broker`}>
                <SelectValue placeholder="Escolha o corretor" />
              </SelectTrigger>
              <SelectContent>
                {brokers.map((broker) => (
                  <SelectItem key={broker.id} value={broker.id}>
                    {broker.name}{broker.team ? ` · ${broker.team}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            A proposta voltará vinculada a você e à sua liderança atual.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="success"
            disabled={!brokerId || mutation.isPending}
            onClick={() => void confirmar()}
          >
            {mutation.isPending ? "Reativando…" : "Reativar Proposta"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
