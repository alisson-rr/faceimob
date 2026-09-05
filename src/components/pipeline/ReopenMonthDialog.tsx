import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Unlock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { compareMonth, nextMonthBase } from "@/lib/dealStatus";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { pipelineKeys, reopenMonth } from "./data";
import { dealMonth, inconsistentClosedMonths } from "./filters";

interface Props {
  /** Meses em `closed_months` — os únicos que dá para reabrir. */
  closedMonths: string[];
  /** Todos os negócios: o diálogo conta o que volta a aceitar edição. */
  deals: LegacyDealRecord[];
  onClose: () => void;
}

/**
 * Reabertura de mês — o caminho que três lugares da tela prometiam e não
 * existia.
 *
 * `blockedMoveReason` ("Fale com o administrador para reabrir"), o aviso do
 * modal ("até um administrador reabrir o período") e a mensagem do próprio
 * gatilho `deals_guard_closed_month` mandavam procurar um administrador que não
 * tinha botão nenhum: até aqui, reabrir um mês era `delete from closed_months`
 * na mão. A policy `closed_months_write` sempre foi `is_admin()` — só faltava a
 * tela.
 *
 * **As propostas que já migraram ficam onde estão.** `close_month_and_season`
 * move todo `outcome='open'` para o mês seguinte e não guarda quais linhas
 * moveu; desfazer isso seria adivinhação, e devolveria negócio para um mês que
 * a diretoria já leu como fechado. O diálogo diz isso ANTES de confirmar, com o
 * número de negócios que o mês reaberto volta a aceitar editar.
 *
 * A temporada do game **não** volta junto: `close_game_season` congela o placar
 * em `game_season_results` e abre o ciclo seguinte. Reabrir o mês devolve a
 * edição dos negócios, não o pódio — está escrito no aviso.
 */
export function ReopenMonthDialog({ closedMonths, deals, onClose }: Props) {
  const queryClient = useQueryClient();
  const id = useId();
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => [...closedMonths].sort((a, b) => compareMonth(b, a)),
    [closedMonths],
  );
  const [period, setPeriod] = useState(() => options[0] ?? "");

  /** Negócios do período — o que volta a aceitar edição de todo mundo. */
  const doMes = deals.filter((deal) => dealMonth(deal) === period);
  const abertos = doMes.filter((deal) => deal.outcome === "open").length;
  const incoerentes = useMemo(
    () => new Map(inconsistentClosedMonths(deals, closedMonths).map((row) => [row.month, row.abertos])),
    [deals, closedMonths],
  );

  const confirm = async () => {
    setSaving(true);
    try {
      await reopenMonth(period);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineKeys.closedMonths }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.deals }),
      ]);
      toast({
        title: `Mês ${period} reaberto`,
        description: `${doMes.length} negócio(s) de ${period} voltam a aceitar edição. `
          + "As propostas que já migraram continuam no mês seguinte.",
      });
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao reabrir o mês",
        description: describeError(err, "O período continua fechado; tente de novo."),
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
            <Unlock className="h-5 w-5 text-warning" aria-hidden /> Reabrir um mês fechado
          </AlertDialogTitle>
          <AlertDialogDescription>
            O período sai de <code>closed_months</code> e os negócios dele voltam a aceitar
            edição de corretor e gerente. Só o administrador faz isto.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`${id}-period`}>Período a reabrir</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id={`${id}-period`} className="mt-1">
                <SelectValue placeholder="Nenhum mês fechado" />
              </SelectTrigger>
              <SelectContent>
                {options.map((month) => (
                  <SelectItem key={month} value={month}>
                    {month}
                    {incoerentes.has(month) ? " — tem proposta aberta" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <p className="font-semibold text-foreground">O que acontece com {period}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>{doMes.length} negócio(s) de {period} voltam a aceitar edição.</li>
              <li>
                As propostas que o fechamento já moveu para {period ? nextMonthBase(period) : "o mês seguinte"}
                {" "}continuam lá: não há registro de quais linhas migraram, então nada é revertido.
              </li>
              <li>A temporada do game encerrada continua encerrada — o placar já foi congelado.</li>
            </ul>
          </div>

          {/* Mês fechado COM proposta aberta é incoerência de origem: a RPC migra
              todo `outcome='open'` antes de congelar, então essa linha entrou
              por fora dela (importação, correção por SQL). Medido em 02/09/2026:
              06/2026 está nesse estado. Quem reabre precisa saber que o mês não
              foi fechado pelo caminho normal. */}
          {incoerentes.has(period) && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
              {period} está fechado com <strong className="text-foreground">{incoerentes.get(period)} proposta(s)
              ainda aberta(s)</strong> no período — o fechamento pela tela migra todas antes de congelar,
              então este mês foi fechado por fora da rotina. Reabrir e fechar de novo pelo botão
              &ldquo;Fechar mês&rdquo; recoloca o período na regra.
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {abertos > 0
                ? `${abertos} proposta(s) aberta(s) de ${period} voltam a andar no funil. `
                : ""}
              Relatório e ranking já lidos pela diretoria mudam se alguém editar o período.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving || !period}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {saving ? "Reabrindo…" : `Reabrir ${period}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
