import { useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  Lock, RotateCcw, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { developerColor, type ChartToken } from "@/lib/tone";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DOCUMENT_REVIEW_META } from "./review";
import { faceimobStatusTone, statusChoices, STATUS_TONE_CLASS } from "./statuses";
import { dealLock } from "./guards";
import { dealMonth, pct, sortDealsBy, type DealSortKey } from "./filters";

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
  /** Espelha `can_edit_deal`. O cabeçalho já anuncia "Somente leitura" ao sócio;
   *  sem isto cada linha continuava oferecendo três controles de escrita que o
   *  banco recusa — e ele só descobria depois de abrir o diálogo. */
  canWrite: boolean;
  /** Meses em `closed_months`. O gatilho `deals_guard_closed_month` recusa
   *  qualquer edição neles (menos para o admin) — e nada na linha dizia isso:
   *  o corretor só descobria pelo toast de erro. */
  closedMonths: string[];
  onOpen: (deal: LegacyDealRecord) => void;
  onStatusChange: (deal: LegacyDealRecord, status: string) => void;
  onScheduleVisit: (deal: LegacyDealRecord) => void;
  onLose: (deal: LegacyDealRecord) => void;
  /** Reabrir negócio encerrado — só o admin, e só por confirmação. */
  onReopen: (deal: LegacyDealRecord) => void;
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
export function DealsTable({
  deals, canWrite, closedMonths, onOpen, onStatusChange, onScheduleVisit, onLose, onReopen,
}: Props) {
  const { isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  // A ordem era fixa (construtora, depois catálogo de Status 2): não dava para
  // perguntar "maiores VGV" nem "parados há mais tempo" sem sair da tela.
  const [sort, setSort] = useState<{ key: DealSortKey; asc: boolean }>({ key: "padrao", asc: true });

  const ordenados = useMemo(() => sortDealsBy(deals, sort.key, sort.asc), [deals, sort]);

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
  const rows = ordenados.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  /** Cabeçalho que ordena. Função, e não componente local: `<Comp/>` declarado
   *  dentro do render tem identidade nova a cada estado e o React remonta a
   *  célula — o botão perderia o foco no clique que acabou de ordenar. */
  const colunaOrdenavel = (label: string, key: Exclude<DealSortKey, "padrao">, align = "text-left") => {
    const ativa = sort.key === key;
    const Icone = ativa ? (sort.asc ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        scope="col"
        className={`p-2 font-medium ${align}`}
        aria-sort={ativa ? (sort.asc ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setPage(1);
            setSort((atual) => (atual.key === key ? { key, asc: !atual.asc } : { key, asc: true }));
          }}
        >
          {label}
          <Icone className="h-3 w-3" aria-hidden />
          <span className="sr-only">
            {ativa
              ? sort.asc ? "— ordenado do menor para o maior; clique inverte" : "— ordenado do maior para o menor; clique inverte"
              : "— clique para ordenar por esta coluna"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-xs">
          <caption className="sr-only">
            Negócios do pipeline. O nome do cliente abre o detalhe do negócio.
          </caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="w-3 p-0"><span className="sr-only">Idade</span></th>
              <th scope="col" className="p-2 text-left font-medium">Status</th>
              {colunaOrdenavel("Construtora", "developer")}
              <th scope="col" className="p-2 text-left font-medium">Empreendimento</th>
              <th scope="col" className="p-2 font-medium">Unidade</th>
              {colunaOrdenavel("Dias", "days", "text-center")}
              <th scope="col" className="p-2 text-left font-medium">Status 2</th>
              <th scope="col" className="p-2 text-left font-medium">Conferência</th>
              {colunaOrdenavel("Cliente", "client")}
              {colunaOrdenavel("VGV", "vgv")}
              <th scope="col" className="p-2 text-left font-medium">Corretor 1</th>
              <th scope="col" className="p-2 text-left font-medium">Gerente 1</th>
              <th scope="col" className="p-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((deal) => {
              const review = DOCUMENT_REVIEW_META[deal.document_review_status ?? "draft"];
              const status = deal.status || "PROPOSTA";
              // Motivo da trava no NOME acessível, não em `title`: o Button do
              // kit tem `disabled:pointer-events-none`, então a dica nativa
              // nunca abre em botão desabilitado — era explicação morta.
              const { locked: travado, reason: motivo, monthClosed } = dealLock(deal, {
                canWrite, isAdmin, closedMonths,
              });
              return (
                // O realce segue o foco, não o ponteiro: a linha inteira não é
                // clicável (só o nome do cliente é), e `hover` na linha prometia
                // um alvo que não existe.
                <tr key={deal.id} className="border-b border-border/40 transition-colors focus-within:bg-secondary/30">
                  <td className="relative w-3 p-0">
                    <span className={cn("absolute bottom-0 left-0 top-0 w-1.5", ageStripe(deal.days_in_pipeline))} aria-hidden />
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <span className="font-semibold">{deal.stage_label}</span>
                    <span className="ml-1 text-muted-foreground tabular-nums">{dealMonth(deal)}</span>
                    {/* O cadeado aparece inclusive para o admin, que continua
                        podendo editar (`deals_guard_closed_month` sai em
                        `is_admin()`): ele precisa VER que está mexendo em mês
                        congelado, não descobrir depois. */}
                    {monthClosed && (
                      <Lock
                        className="ml-1 inline h-3 w-3 text-muted-foreground"
                        aria-label={`Mês ${dealMonth(deal)} fechado`}
                      />
                    )}
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
                      disabled={travado}
                      onValueChange={(value) => onStatusChange(deal, value)}
                    >
                      <SelectTrigger
                        aria-label={`Status 2 de ${deal.client}${motivo}`}
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
                  {/* O rateio (`deal_participants.share_pct`) só aparecia dentro
                      do modal: conferir a comissão do mês exigia abrir negócio
                      por negócio. Aqui ele fica ao lado do dono da fatia. */}
                  <td className="max-w-[110px] p-2">
                    <span className="block truncate">{deal.broker1 || "—"}</span>
                    {deal.broker1_share != null && (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {pct(deal.broker1_share)} do VGV
                      </span>
                    )}
                  </td>
                  <td className="max-w-[110px] truncate p-2">{deal.manager1 || "—"}</td>
                  {/* `flex` com `gap`: os dois ícones ficavam colados na mesma
                      célula e, a 375 px, o alvo de "perder" encostava no de
                      agendar — errar o toque aqui encerra um negócio. */}
                  <td className="whitespace-nowrap p-2">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Mesma trava do botão de perder ao lado: negócio encerrado
                          não agenda visita. Sem ela, o clique aqui reabria o
                          negócio e o fazia voltar para "Visita agendada".
                          O estado "já tem visita" entra no nome acessível: no
                          cartão do kanban ele é um `aria-label`, aqui era só a
                          cor do ícone — invisível para leitor de tela e para
                          quem não distingue o âmbar. */}
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        aria-label={
                          deal.visit_date
                            ? `Reagendar visita de ${deal.client} (já tem visita agendada)${motivo}`
                            : `Agendar visita de ${deal.client}${motivo}`
                        }
                        disabled={travado}
                        onClick={() => onScheduleVisit(deal)}
                      >
                        <CalendarIcon className={cn("h-3.5 w-3.5", deal.visit_date && "text-warning")} />
                      </Button>
                      {/* Negócio encerrado troca o "perder" pelo "reabrir": até
                          aqui desfazer só existia por SQL direto — o diálogo de
                          perda dizia "reabrir depois exige um gestor" e não havia
                          tela, botão nem RPC que o gestor usasse. */}
                      {deal.active ? (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          aria-label={`Perder o negócio de ${deal.client}${motivo}`}
                          disabled={travado}
                          onClick={() => onLose(deal)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      ) : isAdmin ? (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          aria-label={`Reabrir o negócio de ${deal.client}`}
                          onClick={() => onReopen(deal)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
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
