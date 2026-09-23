import { memo, useEffect, useId, useState } from "react";
import { Building2, ChevronDown, ChevronUp, DollarSign, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KpiGrid } from "@/components/shared";
import { brl, num } from "@/lib/format";
import { ccaStageColor } from "./ccaStage";
import { KanbanColumnHeader } from "./KanbanColumnHeader";
import type { CcaDeal, CcaSendCount, CcaStage } from "./ccaData";
import { elapsedDays, elapsedLabel } from "./ccaTime";

/** Cartões por coluna antes do "Mostrar mais" — ver `limites` no `CcaBoard`. */
const POR_COLUNA = 200;

/** Faixa de indicadores aberta ou fechada, por navegador: "aberto" | "fechado". */
const CHAVE_INDICADORES = "faceimob-cca-indicadores";

/**
 * Escolha salva; sem ela, aberta a partir de 640 px. No celular a faixa ocupava
 * ~970 px antes do quadro, e o cabeçalho de cada coluna já diz quantidade e
 * total. Sem storage (janela anônima, site bloqueado) vale só o padrão.
 */
function indicadoresAbertosNoInicio(): boolean {
  try {
    const salvo = localStorage.getItem(CHAVE_INDICADORES);
    if (salvo === "aberto" || salvo === "fechado") return salvo === "aberto";
  } catch { /* segue para o padrão */ }
  return window.matchMedia?.("(min-width: 640px)").matches ?? true;
}

/** "2 vezes pela Esteira Ágil": a mesma frase no nome acessível e na dica do selo. */
const vezesPela = (n: number, esteira: string) => `${n} ${n === 1 ? "vez" : "vezes"} pela ${esteira}`;

interface Props {
  stages: CcaStage[];
  deals: CcaDeal[];
  canAct: boolean;
  /** Envios por esteira, por negócio (`cca_send_counts`). Ausente: sem selos. */
  sendCounts?: Map<string, CcaSendCount>;
  /** Abre o negócio no `DealDetailModal` — o MESMO editor do Pipeline. */
  onOpen: (deal: CcaDeal) => void;
  onMove: (deal: CcaDeal, stage: CcaStage) => void;
}

/**
 * Quadro da esteira CCA.
 *
 * **Uma rolagem só** (pedido de 15/09/2026). A raiz é o único contêiner com
 * rolagem da tela, na horizontal e na vertical: os indicadores ficam no alto
 * dela (presos à esquerda ao rolar para o lado), e o cabeçalho de cada coluna
 * fica preso no topo. As colunas não rolam sozinhas — eram 19 barras de rolagem
 * dentro de uma página que também rolava. A tela dá a altura (`flex-1 min-h-0`).
 *
 * "Mover para…" é um `Select` sempre visível. Eram botões em
 * `opacity-0 group-hover:opacity-100` com 8 px de fonte: invisíveis no toque,
 * inalcançáveis pelo teclado e abaixo do piso de tamanho (achados X02 e X07).
 *
 * "Enviar à construtora" saiu do cartão (pedido de 17/09/2026): o envio passou
 * para o gerente, na conferência de documentos.
 *
 * `memo`: abrir um diálogo da tela não redesenha os cartões.
 */
export const CcaBoard = memo(function CcaBoard({
  stages, deals, canAct, sendCounts, onOpen, onMove,
}: Props) {
  const faixaId = useId();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [indicadoresAbertos, setIndicadoresAbertos] = useState(indicadoresAbertosNoInicio);
  const alternarIndicadores = () => {
    const aberto = !indicadoresAbertos;
    setIndicadoresAbertos(aberto);
    try {
      localStorage.setItem(CHAVE_INDICADORES, aberto ? "aberto" : "fechado");
    } catch { /* sem storage, a escolha vale até recarregar a página */ }
  };

  /**
   * Quantos cartões cada coluna desenha. Com a esteira inteira (7.560 casos na
   * homologação) eram ~280 mil nós e 15,7 s de montagem no teste. O período
   * padrão fica bem abaixo; o teto segura um período longo escolhido à mão.
   */
  const [limites, setLimites] = useState<Record<string, number>>({});

  // Um passe só, na ordem de chegada (mais antigos em cima): indicador e
  // coluna leem a mesma lista.
  const porEstagio = new Map<string, CcaDeal[]>();
  for (const deal of deals) {
    const lista = porEstagio.get(deal.stageId);
    if (lista) lista.push(deal);
    else porEstagio.set(deal.stageId, [deal]);
  }
  const agile = deals.filter((deal) => deal.agile);
  const agileAges = agile.flatMap((deal) => {
    const days = elapsedDays(deal.stageEnteredAt ?? deal.submittedAt, now);
    return days === null ? [] : [days];
  });

  return (
    // `contain: paint` fecha o transbordo aqui dentro: sem ele a faixa das
    // colunas chegou a rolar a PÁGINA na horizontal (735 px a 375 px).
    <div className="min-h-0 flex-1 overflow-auto [contain:paint]">
      {/* Mesma altura e largura para todos: a grade de indicadores do app
          (última linha centralizada) e o nome em duas linhas de altura fixa,
          cortado com reticências (o nome inteiro fica no `title`). A cor da
          coluna vai na faixa do topo, não no número: com a cor livre, número
          colorido podia sumir no fundo de um dos temas. */}
      {/* O botão fica ACIMA da faixa: recolher não o tira do lugar, e o quadro
          sobe. Fechada, a faixa continua no DOM (`hidden`) para o
          `aria-controls` apontar para um elemento que existe. */}
      <div className="sticky left-0 pb-3">
        <div className="flex justify-center">
          <Button
            size="sm" variant="ghost" className="h-8 text-xs"
            aria-expanded={indicadoresAbertos}
            aria-controls={faixaId}
            onClick={alternarIndicadores}
          >
            {indicadoresAbertos
              ? <><ChevronUp aria-hidden /> Recolher indicadores</>
              : <><ChevronDown aria-hidden /> Mostrar indicadores</>}
          </Button>
        </div>
        <div id={faixaId} hidden={!indicadoresAbertos} className="pt-2">
          <KpiGrid cols="faixa">
            <div className="relative flex min-h-[4.75rem] flex-col justify-between border border-info/50 border-t-4 bg-info/10 p-2 text-center">
              <p className="text-eyebrow">Esteira Ágil</p>
              <p className="font-display text-xl font-bold tabular-nums">{agile.length}</p>
              <p className="text-xs text-muted-foreground">{agileAges.length ? `Mais antigo: ${elapsedLabel(Math.max(...agileAges))}` : "Sem espera registrada"}</p>
            </div>
            {stages.map((stage) => (
              // `rounded-none`: o cliente pediu os indicadores "sem os cantos
              // arredondados" (17/09/2026) — é a exceção pedida à escala do app.
              <div
                key={stage.id}
                className="relative flex h-[4.75rem] flex-col justify-between overflow-hidden rounded-none border border-border bg-card p-2 text-center"
              >
                <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: ccaStageColor(stage.color) }} aria-hidden />
                <p className="text-eyebrow line-clamp-2 h-8 break-words leading-4" title={stage.name}>{stage.name}</p>
                <p className="font-display text-xl font-bold leading-none tabular-nums text-foreground">
                  {porEstagio.get(stage.id)?.length ?? 0}
                </p>
              </div>
            ))}
          </KpiGrid>
        </div>
      </div>

      <div className="flex w-max gap-3 pb-2">
        {stages.map((stage) => {
          const cor = ccaStageColor(stage.color);
          const stageDeals = porEstagio.get(stage.id) ?? [];
          const limite = limites[stage.id] ?? POR_COLUNA;
          return (
            // As colunas esticam até a mais alta: o cabeçalho preso vale até o
            // fim da rolagem em todas, não só na coluna mais cheia. O fundo
            // cinza é do corpo e não da coluna: atrás do entalhe da seta tem de
            // aparecer a página. Por isso quem prende é um invólucro com o fundo
            // da página — preso o próprio cabeçalho, os cartões rolando por baixo
            // apareciam pelo entalhe e pela ponta.
            <section key={stage.id} className="flex w-64 flex-shrink-0 flex-col">
              <div className="sticky top-0 z-10 bg-background">
                <KanbanColumnHeader
                  as="h2"
                  name={stage.name}
                  color={cor}
                  total={stageDeals.reduce((soma, deal) => soma + (deal.value || 0), 0)}
                  count={stageDeals.length}
                  noun="caso"
                />
              </div>

              <div className="flex-1 space-y-2 rounded-b-2xl bg-muted/50 p-2">
                {stageDeals.slice(0, limite).map((deal) => {
                  const envio = sendCounts?.get(deal.dealId);
                  const enviado = [
                    envio?.agil ? vezesPela(envio.agil, "Esteira Ágil") : "",
                    envio?.virar ? vezesPela(envio.virar, "Análise p/ virar negócio") : "",
                  ].filter(Boolean).join(" e ");
                  return (
                    <article
                      key={deal.caseId}
                      className="space-y-2 rounded-xl border border-l-4 border-border bg-card p-3"
                      style={{ borderLeftColor: cor }}
                    >
                      {/* Mesmo desenho do `DealCard`: o corpo clicável é IRMÃO
                          do rodapé com o Select, nunca o pai dele —
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
                          + (deal.cpf ? `, CPF ${deal.cpf}` : "")
                          + `${deal.developer ? ` — ${deal.developer}` : ""}. `
                          + `Empreendimento ${deal.project || "não informado"}, `
                          + `corretor ${deal.broker || "não informado"}, VGV ${brl(deal.value)}.`
                          + (enviado ? ` Enviado ${enviado}.` : "")
                          + ` ${elapsedLabel(elapsedDays(deal.stageEnteredAt ?? deal.submittedAt, now))}${deal.stageEnteredAt ? " no status" : deal.submittedAt ? " na esteira" : ""}.`}
                        onClick={() => onOpen(deal)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          onOpen(deal);
                        }}
                        className="block cursor-pointer space-y-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-start justify-between gap-2">
                          {/* Selos por CPF do titular: dentro do `role="button"`
                              eles são presentacionais, então a contagem também
                              está no `aria-label` acima. */}
                          <div className="flex min-w-0 flex-wrap items-center gap-1">
                            <h3 className="text-xs font-semibold">{deal.client}</h3>
                            {deal.cpf && <span className="text-xs tabular-nums text-muted-foreground">CPF {deal.cpf}</span>}
                            {envio?.agil ? (
                              <Badge variant="secondary" className="px-1.5 text-xs tabular-nums" title={`Enviado ${vezesPela(envio.agil, "Esteira Ágil")}`}>
                                Ágil {envio.agil}
                              </Badge>
                            ) : null}
                            {envio?.virar ? (
                              <Badge variant="secondary" className="px-1.5 text-xs tabular-nums" title={`Enviado ${vezesPela(envio.virar, "Análise p/ virar negócio")}`}>
                                Virar {envio.virar}
                              </Badge>
                            ) : null}
                          </div>
                          {deal.developer && <Badge variant="outline" className="text-xs">{deal.developer}</Badge>}
                        </div>

                        <p className="w-fit rounded-md border border-info/30 bg-info/10 px-2 py-1 text-xs font-semibold tabular-nums"
                          title={deal.stageEnteredAt ? "Tempo desde a última entrada neste status" : "Caso anterior ao contador: tempo desde a entrada na esteira; o próximo movimento inicia o tempo por status"}>
                          {elapsedLabel(elapsedDays(deal.stageEnteredAt ?? deal.submittedAt, now))}{deal.stageEnteredAt ? " no status" : deal.submittedAt ? " na esteira" : ""}
                        </p>

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

                      {canAct && <MoverPara deal={deal} stages={stages} atual={stage.id} onMove={onMove} />}
                    </article>
                  );
                })}

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
  );
});

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
