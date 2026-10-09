import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bareStatus } from "@/lib/dealStatus";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { useCcaMonthlySynthesis, type CcaSynthesisEntry } from "./ccaData";

const GROUPS = [
  { key: "INCONFORME CEOPF", tone: "border-destructive/50 bg-destructive/5" },
  { key: "RESOLVER P/ ASSINAR BANCO", tone: "border-warning/50 bg-warning/5" },
  { key: "AGUARDANDO DEMANDA MÍNIMA", tone: "border-info/50 bg-info/5" },
  { key: "ASSINADO BANCO", tone: "border-success/50 bg-success/5" },
] as const;

const MONTHS = [
  ["01", "Janeiro"], ["02", "Fevereiro"], ["03", "Março"], ["04", "Abril"],
  ["05", "Maio"], ["06", "Junho"], ["07", "Julho"], ["08", "Agosto"],
  ["09", "Setembro"], ["10", "Outubro"], ["11", "Novembro"], ["12", "Dezembro"],
] as const;

const currentSaoPauloYear = () => new Date(Date.now() - 3 * 3_600_000).getUTCFullYear();

export function CcaMonthlySynthesis({ month, onMonthChange, onOpenDeal }: {
  month: string;
  onMonthChange: (month: string) => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const query = useCcaMonthlySynthesis(month);
  const rows = query.data ?? [];
  const grouped = (key: string) => rows.filter((row) => bareStatus(row.stage_name) === key);
  const [selectedYear, selectedMonth] = month.split("-");
  const years = Array.from({ length: 4 }, (_, index) => String(currentSaoPauloYear() - index));

  return (
    <section className="rounded-xl border border-border bg-card/50 p-3" aria-labelledby="cca-synthesis-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="cca-synthesis-title" className="text-sm font-semibold">Filtro exclusivo das sínteses do CCA</h2>
          <p className="text-xs text-muted-foreground">
            Conta a entrada nos quatro status abaixo. Não altera nem filtra o mês da venda ou a esteira comercial.
          </p>
        </div>
        <div className="text-xs font-medium">
          <span>Mês das movimentações</span>
          <div className="mt-1 flex gap-2">
            <Select value={selectedMonth} onValueChange={(value) => onMonthChange(`${selectedYear}-${value}`)}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Mês das movimentações do CCA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={(value) => onMonthChange(`${value}-${selectedMonth}`)}>
              <SelectTrigger className="h-8 w-24 text-xs" aria-label="Ano das movimentações do CCA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {query.isError ? (
        <div role="alert" className="mt-3 flex items-center gap-2 text-xs text-destructive">
          {describeError(query.error, "Não foi possível carregar as sínteses.")}
          <Button size="sm" variant="outline" className="h-7" onClick={() => void query.refetch()}>Tentar de novo</Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((group) => {
            const entries = grouped(group.key);
            return (
              <details key={group.key} className={cn("group rounded-lg border p-2", group.tone)}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{group.key}</span>
                  <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
                    {query.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : entries.length}
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" aria-hidden />
                  </span>
                </summary>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-border/50 pt-2">
                  {!query.isPending && entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma entrada neste mês.</p>
                  ) : entries.map((entry: CcaSynthesisEntry) => (
                    <button
                      key={entry.event_id}
                      type="button"
                      onClick={() => onOpenDeal(entry.deal_id)}
                      className="block w-full rounded-md p-1.5 text-left text-xs hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <strong className="block truncate">{entry.client_name || entry.deal_code || "Negócio"}</strong>
                      <span className="block truncate text-muted-foreground">
                        {[entry.developer_name, entry.project_name, entry.broker_name].filter(Boolean).join(" · ") || "Sem detalhes"}
                      </span>
                      <time className="text-xs text-muted-foreground" dateTime={entry.entered_at}>
                        {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.entered_at))}
                      </time>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
