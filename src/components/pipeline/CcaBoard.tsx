import { useState } from "react";
import { Building2, DollarSign, Send, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { brl, num } from "@/lib/format";
import { CCA_TONE_CLASS, ccaStageTone } from "./ccaStage";
import type { CcaDeal, CcaStage } from "./ccaData";

/** Cartões por coluna antes do "Mostrar mais" — ver `limites` no `CcaBoard`. */
const POR_COLUNA = 200;

interface Props {
  stages: CcaStage[];
  deals: CcaDeal[];
  canAct: boolean;
  /** Abre o negócio no `DealDetailModal` — o MESMO editor do Pipeline. */
  onOpen: (deal: CcaDeal) => void;
  onMove: (deal: CcaDeal, stage: CcaStage) => void;
  onSubmitToDeveloper: (deal: CcaDeal) => void;
}

/**
 * Quadro da esteira CCA.
 *
 * "Mover para…" é um `Select` sempre visível. Eram botões em
 * `opacity-0 group-hover:opacity-100` com 8 px de fonte: invisíveis no toque,
 * inalcançáveis pelo teclado e abaixo do piso de tamanho (achados X02 e X07).
 */
export function CcaBoard({ stages, deals, canAct, onOpen, onMove, onSubmitToDeveloper }: Props) {
  /**
   * Quantos cartões cada coluna desenha. Com a esteira inteira (7.560 casos na
   * homologação) eram ~280 mil nós e 15,7 s de montagem no teste; o PostgREST
   * cortava a lista em 1.000 casos e escondia o custo. 200 por coluna fica no
   * volume que a tela já desenhava, os contadores seguem contando todos e a
   * busca alcança qualquer caso.
   */
  const [limites, setLimites] = useState<Record<string, number>>({});
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stages.map((stage) => (
          <div key={stage.id} className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-eyebrow">{stage.name}</p>
            <p className={cn("font-display text-2xl font-bold tabular-nums", CCA_TONE_CLASS[ccaStageTone(stage.color)].text)}>
              {deals.filter((deal) => deal.stageId === stage.id).length}
            </p>
          </div>
        ))}
      </div>

      {/* `contain: paint` fecha a faixa rolável dentro dela mesma. Sem isso o
          transbordo das colunas escapava do `overflow-x-auto` e passava a rolar
          a PÁGINA inteira na horizontal — 735 px de deslocamento a 375 px, com
          o conteúdo real ocupando só a primeira tela. */}
      <div className="overflow-x-auto [contain:paint]">
        <div className="flex min-w-max gap-3 pb-4">
          {stages.map((stage) => {
            const tone = CCA_TONE_CLASS[ccaStageTone(stage.color)];
            const stageDeals = deals.filter((deal) => deal.stageId === stage.id);
            const limite = limites[stage.id] ?? POR_COLUNA;
            return (
              <section key={stage.id} className="w-64 flex-shrink-0 rounded-2xl border border-border bg-muted/10">
                <div className="flex items-center justify-between border-b border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden />
                    <h2 className="text-xs font-semibold">{stage.name}</h2>
                  </div>
                  <Badge variant="secondary" className="h-5 text-xs tabular-nums">{stageDeals.length}</Badge>
                </div>

                <div className="max-h-[calc(100vh-380px)] min-h-[200px] space-y-2 overflow-y-auto p-2">
                  {stageDeals.slice(0, limite).map((deal) => (
                    <article key={deal.caseId} className="space-y-2 rounded-xl border border-border bg-card p-3">
                      {/* Mesmo desenho do `DealCard`: o corpo clicável é IRMÃO
                          do rodapé com o Select e o botão, nunca o pai deles —
                          controle dentro de controle é `nested-interactive`, e
                          o leitor de tela pode não expor "Mover para…".
                          `role="button"` em vez de `<button>` porque o conteúdo
                          é um título e uma lista de definição, que não cabem
                          dentro do conteúdo permitido de um botão. */}
                      <div
                        role="button"
                        tabIndex={0}
                        // O nome acessível repete o cartão de propósito:
                        // descendente de botão é PRESENTACIONAL na especificação
                        // ARIA, então construtora, empreendimento, corretor e VGV
                        // deixariam de ser anunciados assim que entraram aqui.
                        // Mesma solução do `DealCard`.
                        aria-label={`Abrir o negócio de ${deal.client}`
                          + `${deal.developer ? ` — ${deal.developer}` : ""}. `
                          + `Empreendimento ${deal.project || "não informado"}, `
                          + `corretor ${deal.broker || "não informado"}, VGV ${brl(deal.value)}.`}
                        onClick={() => onOpen(deal)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          onOpen(deal);
                        }}
                        className="block cursor-pointer space-y-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-xs font-semibold">{deal.client}</h3>
                          {deal.developer && <Badge variant="outline" className="text-xs">{deal.developer}</Badge>}
                        </div>

                        <dl className="space-y-1 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 flex-shrink-0" aria-hidden />
                            <dt className="sr-only">Empreendimento</dt>
                            <dd className="truncate">{deal.project || "—"}</dd>
                          </div>
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3 flex-shrink-0" aria-hidden />
                            <dt className="sr-only">Corretor</dt>
                            <dd className="truncate">{deal.broker || "—"}</dd>
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 flex-shrink-0" aria-hidden />
                            <dt className="sr-only">VGV</dt>
                            <dd className="tabular-nums">{brl(deal.value)}</dd>
                          </div>
                        </dl>
                      </div>

                      {canAct && (
                        <>
                          <Button
                            size="sm" variant="outline" className="h-7 w-full gap-1 text-xs"
                            onClick={() => onSubmitToDeveloper(deal)}
                          >
                            <Send className="h-3 w-3" aria-hidden /> Enviar à construtora
                          </Button>

                          <MoverPara deal={deal} stages={stages} atual={stage.id} onMove={onMove} />
                        </>
                      )}
                    </article>
                  ))}

                  {stageDeals.length > limite && (
                    <Button
                      size="sm" variant="ghost" className="h-7 w-full text-xs"
                      onClick={() => setLimites((atual) => ({ ...atual, [stage.id]: limite + POR_COLUNA }))}
                    >
                      Mostrar mais ({num(stageDeals.length - limite)} restantes)
                    </Button>
                  )}

                  {stageDeals.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Nenhum caso</p>
                  )}
                </div>
                </section>
              );
            })}
        </div>
      </div>
    </>
  );
}

/**
 * "Mover para…" com a lista de estágios montada só depois da primeira abertura.
 *
 * Fechado, o `SelectContent` do Radix monta os itens mesmo assim, num fragmento
 * (2 renders por cartão). Aqui o valor é sempre vazio — o Select só dispara o
 * movimento —, então não há rótulo a buscar nos itens. Com a esteira inteira
 * (7.560 casos na homologação) eram milhares de listas que ninguém abria; a
 * montagem de 7.560 cartões estourava a memória do teste. Depois de aberto uma
 * vez ele fica montado, e a animação de fechar continua a mesma.
 */
function MoverPara({ deal, stages, atual, onMove }: {
  deal: CcaDeal;
  stages: CcaStage[];
  /** Estágio em que o caso está: não aparece como destino. */
  atual: string;
  onMove: (deal: CcaDeal, stage: CcaStage) => void;
}) {
  const [montado, setMontado] = useState(false);
  return (
    <Select
      value=""
      onOpenChange={(aberto) => { if (aberto) setMontado(true); }}
      onValueChange={(stageId) => {
        const target = stages.find((item) => item.id === stageId);
        if (target) onMove(deal, target);
      }}
    >
      <SelectTrigger className="h-7 text-xs" aria-label={`Mover ${deal.client} para outro estágio`}>
        <SelectValue placeholder="Mover para…" />
      </SelectTrigger>
      {montado && (
        <SelectContent>
          {stages.filter((item) => item.id !== atual).map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
          ))}
        </SelectContent>
      )}
    </Select>
  );
}
