import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Target } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { nextMonthBase } from "@/lib/dealStatus";
import { closeMonthAndSeason, gameKeys, type GameSeason } from "@/integrations/supabase/game";
import { displayMonthToIso, toDisplayMonth } from "@/integrations/supabase/newSchema";
import { pipelineKeys } from "./data";

interface Props {
  /** Temporada aberta do game. É ela que define o mês a fechar (migration 0032). */
  season: GameSeason | null;
  /** Mês do calendário — só vale quando não há temporada aberta. */
  fallbackMonth: string;
  onClose: () => void;
}

/**
 * Fechamento de mês — ponto único (ata 14/07 + migration `0032`).
 *
 * O mês fechado é o do **ciclo do game**, não o do relógio nem o que estivesse
 * digitado no filtro: desde a `0032` o `month_base` do negócio nasce do ciclo
 * aberto, e fechar um mês diferente deixaria o ciclo aberto para sempre com os
 * negócios dele fora do congelamento.
 *
 * Por isso o período aparece escrito antes de confirmar, com a origem: o
 * operador precisa ver QUAL mês vai congelar, e não deduzir.
 */
export function CloseMonthDialog({ season, fallbackMonth, onClose }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const seasonMonth = season ? toDisplayMonth(`${season.period_start.slice(0, 7)}-01`) : null;
  const period = seasonMonth || fallbackMonth;
  const next = nextMonthBase(period);

  const confirm = async () => {
    setSaving(true);
    try {
      const result = await closeMonthAndSeason(displayMonthToIso(period));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineKeys.deals }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.closedMonths }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.openSeason }),
        queryClient.invalidateQueries({ queryKey: gameKeys.all }),
      ]);
      toast({
        title: `Mês ${period} fechado`,
        description: `Temporada encerrada e ${result.moved_deals} proposta(s) movida(s) para ${next}.`,
      });
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao fechar o mês",
        description: describeError(err, "Nada foi congelado; tente de novo."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-destructive" aria-hidden /> Fechar o mês do pipeline
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vendas, offs e distratos de <strong className="text-foreground">{period}</strong> ficam
            congelados; as propostas abertas passam para <strong className="text-foreground">{next}</strong>,
            com data base no dia 05. A temporada do game encerra na mesma transação.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <p className="font-semibold text-foreground">Período que será fechado: {period}</p>
            <p className="mt-1 text-muted-foreground">
              {season
                ? `Origem: ciclo do game "${season.label}", aberto em ${season.period_start.split("-").reverse().join("/")}.`
                : "Não há temporada aberta — vale o mês do calendário."}
            </p>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
            <p className="text-xs text-muted-foreground">
              Não dá para desfazer. Confira se os negócios do mês estão com o status correto antes.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {saving ? "Fechando…" : `Fechar ${period}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
