import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Target } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { brl } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { closableMonths, nextMonthBase } from "@/lib/dealStatus";
import { closeMonthAndSeason, gameKeys, type GameSeason } from "@/integrations/supabase/game";
import {
  displayMonthToIso, toDisplayMonth, type LegacyDealRecord,
} from "@/integrations/supabase/newSchema";
import { pipelineKeys } from "./data";
import { dealMonth, monthClosePreview } from "./filters";

interface Props {
  /** Temporada aberta do game. Define o período SUGERIDO (migration 0032). */
  season: GameSeason | null;
  /** Mês do calendário — só vale quando não há temporada aberta nem negócio. */
  fallbackMonth: string;
  /** Todos os negócios: o diálogo conta o que vai migrar e o que vai congelar. */
  deals: LegacyDealRecord[];
  /** Meses já em `closed_months` — não podem ser oferecidos de novo. */
  closedMonths: string[];
  onClose: () => void;
}

/**
 * Fechamento de mês — ponto único (ata 14/07 + migration `0032`).
 *
 * **O período passou a ser escolhido.** Ele era fixado na temporada aberta do
 * game, e os dois relógios saem de fase sozinhos: a Gamificação encerra a
 * temporada sem fechar o mês. Medido na homologação em 02/09/2026 — temporada
 * aberta em 09/2026, com ZERO negócios, e 26 dos 32 negócios em 08/2026.
 * Apertar o botão congelaria um mês vazio ("0 proposta(s) movida(s)") e
 * 08/2026 ficaria aberto para sempre, porque nenhuma tela sabia fechá-lo.
 *
 * O diálogo continua escrevendo o período e a origem dele antes de confirmar —
 * e agora mostra também **o que vai congelar**: quantas propostas migram e
 * quantos resultados ficam. Sem isso o operador confirmava no escuro.
 *
 * A RPC encerra a temporada aberta SEMPRE, qualquer que seja o período. Fechar
 * um mês antigo, portanto, encerra a temporada corrente junto — está escrito no
 * aviso, porque é consequência que ninguém adivinha.
 */
export function CloseMonthDialog({ season, fallbackMonth, deals, closedMonths, onClose }: Props) {
  const queryClient = useQueryClient();
  const id = useId();
  const [saving, setSaving] = useState(false);

  const seasonMonth = season ? toDisplayMonth(`${season.period_start.slice(0, 7)}-01`) : null;
  const seasonClosed = Boolean(seasonMonth && closedMonths.includes(seasonMonth));

  const options = useMemo(
    () => closableMonths(deals.map(dealMonth), closedMonths, seasonMonth),
    [deals, closedMonths, seasonMonth],
  );

  const [period, setPeriod] = useState(
    () => (seasonMonth && !seasonClosed ? seasonMonth : options[0] ?? fallbackMonth),
  );
  const next = nextMonthBase(period);

  // O que a RPC vai fazer com o período escolhido, contado na mesma base que a
  // tela já carregou: propostas abertas migram, resultados ficam congelados.
  // O predicado é `outcome = 'open'`, o MESMO `where` da RPC — `deal.active`
  // incluía as vendas e prometia mover negócio que a RPC não move.
  const previsao = monthClosePreview(deals, period);

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
            congelados; as propostas abertas passam para <strong className="text-foreground">{next}</strong>.
            A temporada do game encerra na mesma transação.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`${id}-period`}>Período a fechar</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id={`${id}-period`} className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(options.length ? options : [period]).map((month) => (
                  <SelectItem key={month} value={month}>
                    {month}
                    {month === seasonMonth ? " — temporada aberta" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <p className="font-semibold text-foreground">O que acontece com {period}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>{previsao.migram} proposta(s) aberta(s) passam para {next}.</li>
              <li>{previsao.congelam} resultado(s) ficam congelados em {period} · {brl(previsao.vgvVendido)} de VGV vendido.</li>
              <li>
                {season
                  ? `Ciclo aberto do game: "${season.label}", desde ${season.period_start.split("-").reverse().join("/")} — encerra nesta ação.`
                  : "Não há temporada aberta — vale o mês do calendário."}
              </li>
            </ul>
          </div>

          {seasonMonth && seasonClosed && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {seasonMonth} (mês da temporada aberta) já está fechado — por isso ele não aparece na lista.
            </p>
          )}

          {season && period !== seasonMonth && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
              Você está fechando um mês diferente do ciclo aberto do game. A temporada
              <strong className="text-foreground"> {season.label} </strong>
              encerra do mesmo jeito: é uma transação só.
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden />
            <p className="text-xs text-muted-foreground">
              Não dá para desfazer pela tela. Confira se os negócios do mês estão com o status correto antes.
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
