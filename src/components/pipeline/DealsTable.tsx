import { useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { developerColor, type ChartToken } from "@/lib/tone";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DOCUMENT_REVIEW_META } from "./review";
import { faceimobStatusTone, statusChoices, STATUS_TONE_CLASS } from "./statuses";
import { dealMonth } from "./filters";

const PER_PAGE = 15;

/** Cor da construtora como bolinha. O nome fica em `foreground`: `chart-*` é
 *  token de objeto gráfico (3:1), não de texto — pintar o nome com ele
 *  reprovaria no contraste que o resto da tela cumpre. */
const DEVELOPER_DOT: Record<ChartToken, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
};

/** Faixa de idade do negócio. Cor + número: a cor não é o único sinal. */
const ageTone = (days: number) =>
  days > 60 ? "bg-destructive/15 text-destructive"
    : days > 30 ? "bg-warning/15 text-warning"
      : days > 14 ? "bg-info/15 text-info"
        : "bg-success/15 text-success";

const ageStripe = (days: number) =>
  days > 60 ? "bg-destructive" : days > 30 ? "bg-warning" : days > 14 ? "bg-info" : "bg-success";

interface Props {
  deals: LegacyDealRecord[];
  onOpen: (deal: LegacyDealRecord) => void;
  onStatusChange: (deal: LegacyDealRecord, status: string) => void;
  onScheduleVisit: (deal: LegacyDealRecord) => void;
  onLose: (deal: LegacyDealRecord) => void;
}

/**
 * Tabela do Pipeline.
 *
 * Duas mudanças de fundo em relação ao que existia:
 *
 * 1. A coluna **Status** mostra a etapa de verdade (`deal.stage_label`, vindo de
 *    `pipeline_stages`). Antes era o literal `PROPOSTA {mês}` para todo negócio,
 *    inclusive para os fechados e perdidos (achado F09).
 * 2. **Perder o negócio** deixou de ser um Switch de um clique. Era `scale-75`,
 *    gravava `stage=lost` na hora e a própria tela avisava que não dá para
 *    reabrir (achado F14). Agora é botão nomeado que abre confirmação com motivo.
 */
export function DealsTable({ deals, onOpen, onStatusChange, onScheduleVisit, onLose }: Props) {
  const [page, setPage] = useState(1);

  // Filtrar estando na página 3 deixava o operador olhando para a última página
  // de um conjunto que ele acabou de trocar. Ajuste durante a renderização — o
  // padrão do React para estado derivado de prop, sem efeito nem piscada.
  const [lastCount, setLastCount] = useState(deals.length);
  if (lastCount !== deals.length) {
    setLastCount(deals.length);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(deals.length / PER_PAGE));
  const current = Math.min(page, totalPages);
  const rows = deals.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-xs">
          <caption className="sr-only">
            Negócios do pipeline. A linha abre o detalhe do negócio.
          </caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="w-3 p-0"><span className="sr-only">Idade</span></th>
              <th scope="col" className="p-2 text-left font-medium">Status</th>
              <th scope="col" className="p-2 text-left font-medium">Construtora</th>
              <th scope="col" className="p-2 text-left font-medium">Empreendimento</th>
              <th scope="col" className="p-2 font-medium">Unidade</th>
              <th scope="col" className="p-2 font-medium">Dias</th>
              <th scope="col" className="p-2 text-left font-medium">Status 2</th>
              <th scope="col" className="p-2 text-left font-medium">Conferência</th>
              <th scope="col" className="p-2 text-left font-medium">Cliente</th>
              <th scope="col" className="p-2 text-left font-medium">VGV</th>
              <th scope="col" className="p-2 text-left font-medium">Corretor 1</th>
              <th scope="col" className="p-2 text-left font-medium">Gerente 1</th>
              <th scope="col" className="p-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((deal) => {
              const review = DOCUMENT_REVIEW_META[deal.document_review_status ?? "draft"];
              const status = deal.status || "PROPOSTA";
              return (
                <tr key={deal.id} className="border-b border-border/40 transition-colors hover:bg-secondary/30">
                  <td className="relative w-3 p-0">
                    <span className={cn("absolute bottom-0 left-0 top-0 w-1.5", ageStripe(deal.days_in_pipeline))} aria-hidden />
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <span className="font-semibold">{deal.stage_label}</span>
                    <span className="ml-1 text-muted-foreground tabular-nums">{dealMonth(deal)}</span>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", DEVELOPER_DOT[developerColor(deal.developer)])} aria-hidden />
                      {deal.developer || "—"}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate p-2">{deal.project || "—"}</td>
                  <td className="p-2 text-center">{deal.unit || "—"}</td>
                  <td className="p-2 text-center">
                    <span className={cn("rounded px-1.5 py-0.5 font-bold tabular-nums", ageTone(deal.days_in_pipeline))}>
                      {deal.days_in_pipeline}
                    </span>
                  </td>
                  <td className="p-2">
                    {/* Negócio encerrado não troca de status por aqui: a etapa
                        já é `lost` e mudar só o rótulo deixaria um "PROPOSTA"
                        fora do funil. Reabrir é decisão de gestor, e esta tela
                        nunca teve esse caminho. */}
                    <Select
                      value={status}
                      disabled={!deal.active}
                      onValueChange={(value) => onStatusChange(deal, value)}
                    >
                      <SelectTrigger
                        aria-label={`Status 2 de ${deal.client}`}
                        title={deal.active ? undefined : "Negócio encerrado"}
                        className={cn(
                          "h-7 min-w-[150px] gap-1 whitespace-nowrap rounded border-0 px-2 py-0 text-xs font-bold",
                          STATUS_TONE_CLASS[faceimobStatusTone(status)],
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        {statusChoices(status).map((option) => (
                          <SelectItem key={option.label} value={option.label} className="text-xs">
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className={cn("whitespace-nowrap text-xs", review.className)}>
                      {review.label}
                    </Badge>
                  </td>
                  <td className="max-w-[150px] p-2">
                    {/* A linha inteira clicável não é alcançável por teclado nem
                        anunciada como ação (X03/X06). O nome do cliente é o
                        botão — um alvo só, com nome acessível. */}
                    <button
                      type="button"
                      onClick={() => onOpen(deal)}
                      className="block max-w-full truncate rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {deal.client}
                    </button>
                  </td>
                  <td className="whitespace-nowrap p-2 tabular-nums">{brl(deal.deal_value)}</td>
                  <td className="max-w-[110px] truncate p-2">{deal.broker1 || "—"}</td>
                  <td className="max-w-[110px] truncate p-2">{deal.manager1 || "—"}</td>
                  <td className="whitespace-nowrap p-2 text-center">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      aria-label={`Agendar visita de ${deal.client}`}
                      onClick={() => onScheduleVisit(deal)}
                    >
                      <CalendarIcon className={cn("h-3.5 w-3.5", deal.visit_date && "text-warning")} />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      aria-label={`Perder o negócio de ${deal.client}`}
                      disabled={!deal.active}
                      onClick={() => onLose(deal)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav aria-label="Paginação dos negócios" className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <Button
            variant="ghost" size="icon" className="h-7 w-7" aria-label="Página anterior"
            disabled={current === 1} onClick={() => setPage(current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums">
            {(current - 1) * PER_PAGE + 1}–{Math.min(current * PER_PAGE, deals.length)} de {deals.length}
          </span>
          <Button
            variant="ghost" size="icon" className="h-7 w-7" aria-label="Próxima página"
            disabled={current >= totalPages} onClick={() => setPage(current + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}
    </>
  );
}
