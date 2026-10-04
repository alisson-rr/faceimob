import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { isSystemStatus } from "@/lib/dealStatus";
import {
  statusKey, statusMoveBlock, type DealStatus, type DealStatusCatalog,
} from "@/integrations/supabase/dealStatuses";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DealCard } from "./DealCard";
import { KanbanColumnHeader } from "./KanbanColumnHeader";
import { dealLock } from "./guards";
import type { PipelineStage } from "./stages";
import { faceimobStatusColor, ordemDeEvolucao } from "./statuses";

/** Coluna do quadro: um Status 2 do cadastro, ou a de quem está fora dele. */
type Coluna = { stage: PipelineStage; status: DealStatus | null; deals: LegacyDealRecord[] };

const FORA_DO_CADASTRO = "fora-do-cadastro";

/** Coluna de quem ainda não tem Status 2: o negócio recém-cadastrado, com a
 *  documentação em preparação ou já conferida, antes de entrar na esteira. */
const COLUNA_INICIAL = "Em preparação (sem Status 2)";

interface Props {
  catalog: DealStatusCatalog;
  /** Status 1 escolhido no filtro; `null` = todos. As colunas são os Status 2 dele. */
  statusGroupId: string | null;
  deals: LegacyDealRecord[];
  onOpen: (deal: LegacyDealRecord) => void;
  /** O `moveStatus` do `useDealActions`, estável: o cartão é `memo`. */
  onMoveStatus: (deal: LegacyDealRecord, statusValue: string) => void;
  onLose: (deal: LegacyDealRecord) => void;
  canWrite: boolean;
  closedMonths: string[];
}

/**
 * Kanban pelo Status 2 (pedido de 29/09/2026: "deixe com os mesmos estágios
 * existentes no Status 2 … o que iremos mover é somente o Status 2").
 *
 * As colunas são os Status 2 ativos do cadastro, na ordem de evolução do
 * negócio (`ordemDeEvolucao`). Mover o cartão
 * troca SÓ o Status 2; a etapa e o Status 1 seguem no banco (0164). Quem pode
 * colocar e tirar de cada coluna é a matriz por função do cadastro — a mesma
 * resposta que o banco dá, desenhada antes do gesto.
 *
 * Coluna vazia fica recolhida numa faixa estreita com o nome: some o espaço,
 * mas não a etapa (pedido: "deixe um sinal que a etapa existe"). A faixa
 * continua recebendo o cartão solto nela.
 */
export function StatusKanban({
  catalog, statusGroupId, deals, onOpen, onMoveStatus, onLose, canWrite, closedMonths,
}: Props) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { isAdmin, roles } = useAuth();

  const colunas = useMemo<Coluna[]>(() => {
    const doCadastro = ordemDeEvolucao(catalog.statuses.filter((status) =>
      status.active && (!statusGroupId || status.group_id === statusGroupId)));
    const porChave = new Map<string, LegacyDealRecord[]>();
    const fora: LegacyDealRecord[] = [];
    const chaves = new Set(doCadastro.map((status) => statusKey(status.value)));
    for (const deal of deals) {
      const chave = statusKey(deal.status);
      if (chaves.has(chave)) porChave.set(chave, [...(porChave.get(chave) ?? []), deal]);
      else fora.push(deal);
    }
    const lista: Coluna[] = doCadastro.map((status) => ({
      status,
      deals: porChave.get(statusKey(status.value)) ?? [],
      stage: {
        id: status.id, code: statusKey(status.value), label: status.label,
        position: status.position, color: faceimobStatusColor(catalog, status.value),
      },
    }));
    // Quem está fora das colunas (sem Status 2, texto antigo fora do cadastro)
    // não some do quadro: fica numa coluna própria, no começo.
    if (fora.length) {
      lista.unshift({
        status: null,
        deals: fora,
        stage: { id: FORA_DO_CADASTRO, code: FORA_DO_CADASTRO, label: COLUNA_INICIAL, position: -1, color: "#94a3b8" },
      });
    }
    return lista;
  }, [catalog, statusGroupId, deals]);

  const statusPorColuna = useMemo(
    () => new Map(colunas.map((coluna) => [coluna.stage.id, coluna.status])),
    [colunas],
  );

  /** O Status 2 atual do negócio no cadastro, ou `null` se estiver fora dele. */
  const statusAtual = useCallback((deal: LegacyDealRecord) => {
    const indice = catalog.indexByKey.get(statusKey(deal.status));
    return indice === undefined ? null : catalog.statuses[indice];
  }, [catalog]);

  /** A matriz deixa tirar o negócio do status em que ele está? */
  const podeSair = useCallback((deal: LegacyDealRecord) => {
    if (isAdmin) return true;
    const atual = statusAtual(deal);
    if (!atual) return true;
    const porFuncao = catalog.permissions.get(atual.id) ?? {};
    return roles.some((role) => porFuncao[role as keyof typeof porFuncao]?.exit);
  }, [catalog.permissions, isAdmin, roles, statusAtual]);

  /** A recusa da matriz para este destino, ou `null`. Voltar à análise (envio
   *  ao gerente) só confere a saída: quem pode enviar, o banco diz no envio. */
  const blockedMove = useCallback((deal: LegacyDealRecord, destino: PipelineStage) => {
    const status = statusPorColuna.get(destino.id);
    if (!status) return "Esta coluna não é um Status 2 do cadastro.";
    if (statusKey(deal.status) === statusKey(status.value)) return "O negócio já está neste status.";
    if (isSystemStatus(status.value)) {
      return podeSair(deal) ? null : `Seu perfil não tira o negócio de "${statusAtual(deal)?.label ?? deal.status}".`;
    }
    return statusMoveBlock(catalog, deal.status, status.value, { isAdmin, roles });
  }, [catalog, statusPorColuna, isAdmin, roles, podeSair, statusAtual]);

  const mover = useCallback((deal: LegacyDealRecord, destino: PipelineStage) => {
    const status = statusPorColuna.get(destino.id);
    if (!status) return;
    setAnnouncement(`Movendo ${deal.client} para ${status.label}.`);
    onMoveStatus(deal, status.value);
  }, [onMoveStatus, statusPorColuna]);
  const iniciarArraste = useCallback((deal: LegacyDealRecord) => setDragged(deal.id), []);
  const encerrarArraste = useCallback(() => { setDragged(null); setDragOver(null); }, []);

  const emArraste = dragged ? deals.find((row) => row.id === dragged) ?? null : null;
  const soltar = (coluna: Coluna) => {
    const deal = emArraste;
    setDragged(null);
    setDragOver(null);
    if (!canWrite || !deal || !coluna.status) return;
    if (statusKey(deal.status) === statusKey(coluna.status.value)) return;
    const recusa = blockedMove(deal, coluna.stage);
    if (recusa) {
      setAnnouncement(recusa);
      return;
    }
    mover(deal, coluna.stage);
  };

  return (
    <div className="overflow-x-auto">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <div className="flex min-w-max gap-2 pb-4">
        {colunas.map((coluna, index) => {
          const cor = coluna.stage.color ?? "#94a3b8";
          const recusa = emArraste && coluna.status && statusKey(emArraste.status) !== statusKey(coluna.status.value)
            ? blockedMove(emArraste, coluna.stage) : null;
          const eventos = {
            onDragOver: (event: React.DragEvent) => { event.preventDefault(); setDragOver(coluna.stage.id); },
            onDragLeave: () => setDragOver(null),
            onDrop: () => soltar(coluna),
          };
          const destacada = dragOver === coluna.stage.id && (recusa ? "ring-2 ring-destructive" : "ring-2 ring-ring");

          // Vazia: faixa estreita com o nome — a etapa existe, só não ocupa espaço.
          if (coluna.deals.length === 0) {
            return (
              <section
                key={coluna.stage.id}
                aria-label={`${coluna.stage.label}: nenhum negócio`}
                className={cn("flex w-9 flex-shrink-0 flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 py-2 transition-all", destacada)}
                {...eventos}
              >
                <span className="mb-2 h-2 w-2 rounded-full" style={{ backgroundColor: cor }} aria-hidden />
                <span className="text-xs text-muted-foreground [writing-mode:vertical-rl]" title={coluna.stage.label}>
                  {coluna.stage.label} · 0
                </span>
              </section>
            );
          }

          return (
            <section
              key={coluna.stage.id}
              aria-label={coluna.stage.label}
              className={cn("flex w-60 flex-shrink-0 flex-col transition-all", destacada)}
              {...eventos}
            >
              <KanbanColumnHeader
                name={coluna.stage.label}
                color={cor}
                total={coluna.deals.reduce((soma, deal) => soma + (deal.deal_value || 0), 0)}
                count={coluna.deals.length}
                noun="negócio"
              />
              {dragOver === coluna.stage.id && recusa && (
                <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {recusa}
                </p>
              )}
              <div className="max-h-[calc(100vh-420px)] min-h-[180px] flex-1 space-y-2 overflow-y-auto rounded-b-2xl bg-muted/50 p-2">
                {coluna.deals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    color={cor}
                    onOpen={onOpen}
                    onMove={mover}
                    lock={dealLock(deal, { canWrite, isAdmin, closedMonths })}
                    canExit={podeSair(deal)}
                    blockedMove={blockedMove}
                    onBlockedMove={setAnnouncement}
                    previousStage={colunas[index - 1]?.status ? colunas[index - 1].stage : undefined}
                    nextStage={colunas[index + 1]?.stage}
                    onLose={onLose}
                    dragging={dragged === deal.id}
                    onDragStart={iniciarArraste}
                    onDragEnd={encerrarArraste}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
