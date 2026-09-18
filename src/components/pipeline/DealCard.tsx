import { memo, type KeyboardEvent, type MouseEvent } from "react";
import {
  AlertCircle, CalendarCheck, ChevronLeft, ChevronRight, GripVertical, Lock, StickyNote, User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { brokerTextClass, dealAgeTone, DEAL_AGE_CLASS, developerDot } from "@/lib/tone";
import { calcDealProbability } from "@/lib/aiAnalytics";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { dealBrokers, dealMonth, pct } from "./filters";
import type { DealLock } from "./guards";
import { DOCUMENT_REVIEW_META } from "./review";
import type { PipelineStage } from "./stages";

interface Props {
  deal: LegacyDealRecord;
  /** `#RRGGBB` da coluna, na borda esquerda do cartão. String e não objeto de
   *  estilo: o `memo` compara por identidade, e objeto novo por render refazia
   *  todos os cartões. */
  color: string;
  onOpen: (deal: LegacyDealRecord) => void;
  onMove: (deal: LegacyDealRecord, stage: PipelineStage) => void;
  /** A MESMA trava da tabela (`dealLock`): escrita, negócio encerrado e mês
   *  congelado numa função só. O cartão recalculava metade dela e ignorava o
   *  mês fechado — a alça e as setas apareciam num mês que o gatilho recusa. */
  lock: DealLock;
  /** `stage_permissions.can_exit` da coluna. A matriz nega a SAÍDA de algumas
   *  etapas (hoje "Aprovado" para corretor e gerente) e o front nunca lia essa
   *  coluna: a alça e as setas prometiam um gesto que o banco recusa sempre. */
  canExit: boolean;
  /** `blockedMoveReason` para um destino concreto — a MESMA função que
   *  `useDealActions` chama antes de gravar.
   *
   *  `canExit` é só metade da matriz: a outra metade (`can_enter` do destino) e
   *  a conferência documental dependem de PARA ONDE se move, e ficavam para
   *  depois do clique, em toast vermelho. Hoje corretor e gerente saem de
   *  "Em Análise" e não entram em "Aprovado" (medido em 02/09/2026): a seta da
   *  direita aparecia habilitada e sempre voltava recusada.
   *
   *  Recebe o negócio, e não um fecho por cartão: a função é a MESMA para todos
   *  os cartões, e é isso que deixa o `memo` pular o cartão que não mudou. */
  blockedMove: (deal: LegacyDealRecord, stage: PipelineStage) => string | null;
  /** Recusa do Shift+seta a caminho do `role="status"` do quadro.
   *
   *  O botão de mover recusado fica desabilitado com o motivo no nome
   *  acessível; o TECLADO não tinha nem isso — o cartão anuncia "Shift com seta
   *  move de etapa" e o gesto simplesmente não acontecia, sem toast, sem foco e
   *  sem anúncio. O `aria-live` mora no quadro, então a frase sobe por aqui. */
  onBlockedMove: (reason: string) => void;
  /** Encerrar o negócio (abre o diálogo de perda com motivo). No kanban não
   *  havia como perder: era preciso voltar para a visão de tabela. */
  onLose: (deal: LegacyDealRecord) => void;
  previousStage?: PipelineStage;
  nextStage?: PipelineStage;
  dragging: boolean;
  onDragStart: (deal: LegacyDealRecord) => void;
  onDragEnd: () => void;
}

/**
 * Card do kanban.
 *
 * Era um `<div draggable>` e nada mais: sem `tabIndex`, sem `role`, sem
 * teclado. Quem navega por teclado ou usa a tela no celular não conseguia nem
 * abrir o negócio, muito menos movê-lo (achado X01).
 *
 * As setas ← → movem de coluna pelo MESMO `onMove` que o `onDrop` usa — a
 * validação de `can_enter_stage()` fica num lugar só. Duplicar a regra aqui era
 * o jeito garantido de o teclado permitir o que o mouse recusa.
 *
 * **Os botões de mover ficam FORA do `role="button"`.** O papel `button` tem
 * filhos presentacionais na especificação ARIA: enquanto eles moravam dentro do
 * cartão, o leitor de tela podia não expor "Mover X para Y" de jeito nenhum
 * (regra `nested-interactive` do axe). O corpo do cartão continua sendo o alvo
 * único de abrir/arrastar/Shift+seta; o rodapé com os dois botões é irmão dele.
 */
function DealCardBase({
  deal, color, onOpen, onMove, onLose, lock, canExit, blockedMove, onBlockedMove,
  previousStage, nextStage, dragging, onDragStart, onDragEnd,
}: Props) {
  const review = DOCUMENT_REVIEW_META[deal.document_review_status ?? "draft"];
  const probability = calcDealProbability(deal);
  const idade = dealAgeTone(deal.days_in_pipeline);
  const movable = !lock.locked && canExit;
  const mes = dealMonth(deal);
  const corretores = dealBrokers(deal);
  const bolinha = developerDot(deal.developer, deal.developer_color);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(deal);
      return;
    }
    // Só a seta com Shift move: seta sozinha é como se rola uma coluna longa,
    // e mover negócio sem querer aqui é gravação no banco.
    if (!event.shiftKey || !movable) return;
    // O mesmo predicado do botão ao lado: teclado que permite o que o botão
    // desabilita é a divergência que este componente existe para não ter.
    const destino = event.key === "ArrowRight" ? nextStage
      : event.key === "ArrowLeft" ? previousStage : undefined;
    if (!destino) return;
    // `preventDefault` antes da recusa: o gesto foi reconhecido, então ele não
    // pode virar rolagem da coluna só porque o destino está bloqueado.
    event.preventDefault();
    // Recusa MUDA era o defeito: o mesmo motivo que o botão põe no nome
    // acessível vai para o `aria-live` do quadro, em vez de o gesto sumir.
    const recusa = blockedMove(deal, destino);
    if (recusa) return onBlockedMove(recusa);
    onMove(deal, destino);
  };

  /** Botão de mover: é o ÚNICO caminho de toque. `draggable`+`onDragStart` são
   *  HTML5 drag, que não dispara em celular, e `Shift+seta` exige teclado
   *  físico — no telefone o negócio só mudava de etapa abrindo o modal.
   *
   *  Destino recusado fica DESABILITADO com o motivo no nome acessível, em vez
   *  de sumir: quem enxerga a coluna ao lado precisa saber por que não pode
   *  levar o negócio até ela. É o mesmo tratamento do Select de etapa do modal,
   *  que escreve "(sem permissão)" na opção. Quando a linha inteira está
   *  travada (`lock`/`can_exit`) o botão continua não existindo — aí o motivo
   *  já está no nome acessível do cartão. */
  const moveButton = (stage: PipelineStage | undefined, Icon: typeof ChevronLeft) => {
    if (!stage || !movable) return null;
    const recusa = blockedMove(deal, stage);
    return (
      <button
        type="button"
        disabled={Boolean(recusa)}
        aria-label={
          recusa
            ? `Mover ${deal.client} para ${stage.label} — ${recusa}`
            : `Mover ${deal.client} para ${stage.label}`
        }
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        onClick={(event: MouseEvent) => { event.stopPropagation(); onMove(deal, stage); }}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  };

  // O motivo da imobilidade vai para o nome acessível: `lock.reason` já é a
  // frase da tabela (" — perfil somente leitura", " — negócio encerrado",
  // " — mês MM/AAAA fechado") e `can_exit` é o caso que só o kanban tem.
  const impedimento = !canExit
    ? "seu perfil não pode tirar o negócio desta etapa"
    : lock.reason.replace(/^\s*—\s*/, "");

  return (
    <article
      className={cn(
        "rounded-xl border border-l-4 border-border/40 bg-card p-3 text-left transition-all",
        "hover:border-primary/30 hover:shadow-lg",
        dragging && "scale-95 opacity-40",
      )}
      style={{ borderLeftColor: color }}
    >
      <div
        role="button"
        tabIndex={0}
        draggable={movable}
        aria-label={
          movable
            ? `${deal.client} — ${deal.stage_label}. Enter abre; Shift com seta move de etapa.${
              lock.monthClosed ? ` Mês ${mes} fechado.` : ""}`
            : `${deal.client} — ${deal.stage_label}. Enter abre; ${impedimento}.`
        }
        onDragStart={() => onDragStart(deal)}
        onDragEnd={onDragEnd}
        onClick={() => onOpen(deal)}
        onKeyDown={handleKeyDown}
        className={cn(
          "block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        )}
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <p className="text-xs font-semibold leading-tight">{deal.client}</p>
          {/* A alça só aparece para quem pode arrastar: era afordância de
              arraste num cartão que o banco não deixa mover. O cadeado é
              INDEPENDENTE dela — o admin arrasta em mês congelado e precisa
              ver que o mês está congelado, exatamente como na tabela. */}
          <span className="flex flex-shrink-0 items-center gap-1">
            {lock.monthClosed && (
              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
            )}
            {movable && <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{deal.project || "Sem empreendimento"} · {deal.unit || "—"}</p>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {/* Bolinha só com a cor escolhida no cadastro: sem ela o cartão fica
              como sempre foi, só com o nome. */}
          {bolinha.style && (
            <span className={cn("h-2 w-2 shrink-0 rounded-full", bolinha.className)} style={bolinha.style} aria-hidden />
          )}
          {deal.developer || "Sem construtora"}
        </p>

        <Badge variant="outline" className={cn("mb-2 h-5 px-1.5 text-xs", review.className)}>
          {review.label}
        </Badge>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tabular-nums text-primary">{brl(deal.deal_value)}</span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded px-1 py-0.5 text-xs font-bold tabular-nums",
                probability >= 60 ? "bg-success/20 text-success"
                  : probability >= 35 ? "bg-warning/20 text-warning"
                    : "bg-destructive/20 text-destructive",
              )}
            >
              {probability}%
            </span>
            <span className={cn("text-xs font-semibold tabular-nums", DEAL_AGE_CLASS[idade].text)}>
              {deal.days_in_pipeline}d
            </span>
          </div>
        </div>
      </div>

      {/* Rodapé fora do `role="button"`: aqui moram os controles de verdade e os
          ícones de estado, que dentro do papel `button` seriam presentacionais
          e sumiriam do leitor de tela. */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/20 pt-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <User className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
          {/* Corretor 1 e 2, cada um com a fatia no VGV — o número que define
              comissão e que só existia dentro do modal. Nome colorido por
              pessoa, igual à tabela: no quadro a coluna é uma pilha de cartões
              e o nome era mais um cinza entre cinzas. A cor acompanha o nome
              escrito — nunca é o único sinal. */}
          {corretores.length ? (
            <div className="min-w-0 flex-1">
              {corretores.map((corretor, posicao) => (
                <span key={posicao} className="flex min-w-0 items-center gap-1 text-xs">
                  <span className={cn("truncate font-medium", brokerTextClass(corretor.name))} title={corretor.name}>
                    {corretor.name}
                  </span>
                  {corretor.share != null && (
                    <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                      · {pct(corretor.share)}
                    </span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <span className="truncate text-xs text-muted-foreground">Sem corretor</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {deal.visit_date && <CalendarCheck className="h-3 w-3 text-warning" aria-label="Visita agendada" />}
          {deal.notes && <StickyNote className="h-3 w-3 text-muted-foreground" aria-label="Tem observação" />}
          {idade === "danger" && (
            <AlertCircle className="h-3 w-3 text-destructive" aria-label="Parado há 10 dias ou mais" />
          )}
          {moveButton(previousStage, ChevronLeft)}
          {moveButton(nextStage, ChevronRight)}
          {/* Perder existia só na tabela: encerrar um negócio pelo kanban
              obrigava a trocar de visão. Mesma trava dos outros controles —
              linha travada não oferece o gesto. */}
          {!lock.locked && (
            <button
              type="button"
              aria-label={`Perder o negócio de ${deal.client}`}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event: MouseEvent) => { event.stopPropagation(); onLose(deal); }}
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

const mesmaTrava = (a: DealLock, b: DealLock) =>
  a.locked === b.locked && a.reason === b.reason && a.monthClosed === b.monthClosed;

/**
 * O kanban desenha os 2.288 negócios ativos da homologação, e sem `memo` todos
 * eram refeitos a cada render do Pipeline (tecla na busca, abrir o modal) e a
 * cada coluna que o arraste cruzava: ~1,1 s por vez no `desempenho.test.tsx`.
 *
 * `lock` é comparado pelo VALOR porque `dealLock` devolve um objeto novo a cada
 * chamada; o resto das props é estável em quem chama (`DealsKanban` e
 * `Pipeline` usam `useCallback`), então basta a identidade.
 */
export const DealCard = memo(DealCardBase, (antes, depois) =>
  (Object.keys({ ...antes, ...depois }) as (keyof Props)[]).every((chave) =>
    chave === "lock" ? mesmaTrava(antes.lock, depois.lock) : Object.is(antes[chave], depois[chave])));
