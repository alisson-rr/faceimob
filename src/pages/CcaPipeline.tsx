import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, FileCog, Inbox, Landmark, Loader2, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { dbError, describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import DealDetailModal from "@/components/DealDetailModal";
import DeveloperSubmissionDialog from "@/components/DeveloperSubmissionDialog";
import {
  listDocumentTypesForAdmin, updateDocumentType, type DocumentTypeAdminRecord,
} from "@/integrations/supabase/documents";
import { saveLegacyDeal } from "@/integrations/supabase/newSchema";
import {
  CcaBoard, CcaMoveDialog, CcaStageSettingsDialog,
  dealRangeError, useCcaBoard, useDevelopers, useInvalidateCcaBoard,
  useInvalidateDeals, usePeople, usePipelineStages,
  type CcaDeal, type CcaStage,
} from "@/components/pipeline";
import {
  periodoValido, ultimos30Dias, useCcaSendCounts, type CcaPeriodo,
} from "@/components/pipeline/ccaData";
import { useDealStatusCatalog } from "@/integrations/supabase/dealStatuses";

/** Normaliza para busca: sem acento e em minúscula, como o resto das telas. */
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Catálogo de tipos de documento.
 *
 * Antes disto, "quais documentos são obrigatórios", "quais aceitam vários" e o
 * `naming_pattern` só mudavam por SQL — `document_types` era lido em
 * `documents.ts` e em lugar nenhum mais. Fica aqui, ao lado de "Gerenciar
 * estágios", porque `document_types_write` é do mesmo público: admin e sócio
 * (`is_admin()`, 0151).
 *
 * Não cria nem apaga tipo: `code` é referência do seed e de `naming_pattern`, e
 * apagar tipo com documento anexado esbarraria na FK. Desligar (`active`) é a
 * saída — some da tela do corretor e mantém o histórico de pé.
 */
function DocumentTypesDialog({ onClose }: { onClose: () => void }) {
  const fieldId = useId();
  const [rows, setRows] = useState<DocumentTypeAdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listDocumentTypesForAdmin()
      .then((data) => { if (vivo) setRows(data); })
      .catch((e) => toast.error("Não foi possível carregar o catálogo", {
        description: describeError(e, "Não foi possível ler os tipos de documento."),
      }))
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  const salvar = async (row: DocumentTypeAdminRecord, patch: Partial<DocumentTypeAdminRecord>) => {
    setBusy(row.id);
    const anterior = rows;
    setRows((atual) => atual.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      await updateDocumentType(row.id, patch);
      // Desligar um tipo OBRIGATÓRIO tem efeito colateral em outra tela: ele
      // some da aba Anexos e `missingRequiredTypes` deixa de contá-lo, então o
      // dossiê passa a poder ir ao gerente sem ele. Dizer isso na hora é mais
      // barato que descobrir depois num negócio sem documento.
      const desligouObrigatorio = patch.active === false && row.required_for_conversion;
      // Caixa marcada é gesto pequeno e repetido: aviso curto. O efeito colateral
      // do obrigatório desligado precisa de tempo para ser lido.
      if (desligouObrigatorio) {
        toast.success("Tipo de documento atualizado", {
          description: `${row.label} era obrigatório: sai da aba Anexos e deixa de travar o envio ao gerente.`,
        });
      } else {
        toast.success("Tipo de documento atualizado", { description: row.label, duration: 2500 });
      }
    } catch (e) {
      setRows(anterior);
      toast.error("Não foi possível salvar o tipo de documento", {
        description: describeError(e, "O catálogo continua como estava."),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      {/* Altura e largura cabem na tela pela base do `DialogContent`; aqui o
          cabeçalho e o rodapé ficam fixos e só a lista rola. Com `90vh` e a
          rolagem no diálogo inteiro, no celular o rodapé sumia atrás da barra
          do navegador. */}
      <DialogContent className="flex max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:p-6 sm:pr-12">
          <DialogTitle>Tipos de documento</DialogTitle>
          <DialogDescription>
            Define o que o corretor vê na aba Anexos: obrigatoriedade, múltiplos arquivos e o
            padrão de nome. Placeholders aceitos: {"{tipo}"}, {"{cliente}"}, {"{data}"} e {"{negocio}"}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <LoadingState variant="list" rows={4} label="Carregando o catálogo…" />
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                // Grupo nomeado: são três caixas e um campo por tipo, com os
                // mesmos rótulos repetidos linha a linha — sem o nome do grupo
                // não dá para saber de qual documento é o "Obrigatório" que se
                // está marcando.
                <div
                  key={row.id}
                  role="group"
                  aria-label={row.label}
                  className="space-y-2 rounded-lg border border-border/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold">
                      {row.label} <span className="text-xs font-normal text-muted-foreground">({row.code})</span>
                    </p>
                    {busy === row.id && <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" aria-hidden />}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id={`${fieldId}-${row.id}-req`}
                        checked={row.required_for_conversion}
                        disabled={busy === row.id}
                        onCheckedChange={(v) => salvar(row, { required_for_conversion: v === true })}
                      />
                      <Label htmlFor={`${fieldId}-${row.id}-req`} className="text-xs">Obrigatório</Label>
                    </span>
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id={`${fieldId}-${row.id}-multi`}
                        checked={row.allows_multiple}
                        disabled={busy === row.id}
                        onCheckedChange={(v) => salvar(row, { allows_multiple: v === true })}
                      />
                      <Label htmlFor={`${fieldId}-${row.id}-multi`} className="text-xs">Aceita vários</Label>
                    </span>
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id={`${fieldId}-${row.id}-ativo`}
                        checked={row.active}
                        disabled={busy === row.id}
                        onCheckedChange={(v) => salvar(row, { active: v === true })}
                      />
                      <Label htmlFor={`${fieldId}-${row.id}-ativo`} className="text-xs">Ativo</Label>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`${fieldId}-${row.id}-pattern`} className="text-xs">Padrão de nome</Label>
                    {/* A `key` amarra o campo ao valor que está em `rows`: quando
                        `salvar` reverte o estado por recusa do banco, o Input
                        remonta com o padrão real. Sem isso a pessoa lia "Não foi
                        possível salvar" com o texto novo ainda na caixa — tela e
                        banco discordando sem sinal nenhum. */}
                    <Input
                      key={`${row.id}-${row.naming_pattern ?? ""}`}
                      id={`${fieldId}-${row.id}-pattern`}
                      className="h-8 text-xs"
                      defaultValue={row.naming_pattern ?? ""}
                      placeholder="{tipo}-{cliente}-{data}"
                      disabled={busy === row.id}
                      onBlur={(event) => {
                        const valor = event.target.value.trim();
                        // Normaliza o que ficou na tela: sem isto, digitar só
                        // espaços em volta do mesmo padrão não salva (certo) e
                        // deixa a caixa diferente do banco (errado).
                        event.target.value = valor;
                        if (valor === (row.naming_pattern ?? "")) return;
                        void salvar(row, { naming_pattern: valor || null });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border p-4 sm:px-6">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Esteira de crédito (CCA).
 *
 * - **Período no banco** (15/09/2026): abre nos últimos 30 dias pela entrada na
 *   esteira (`submitted_at`) e só baixa esses casos e os negócios deles. A busca
 *   procura dentro do que o período trouxe.
 * - **Uma rolagem só**: a página tem a altura da janela e o `CcaBoard` é o único
 *   contêiner que rola.
 * - **Permissão espelhada** (achado P09): mover e enviar seguem `can('cca.review')`,
 *   como `cca_cases_write` e `developer_submissions_write`. Configurar a esteira
 *   (estágios e tipos de documento) é de admin e sócio: `isAdmin`, o mesmo
 *   `is_admin()` de `cca_stages_write` e `document_types_write` desde a 0151.
 * - **Estados de verdade** (A01): a carga vive num `useQuery`, com espera, erro
 *   em pt-BR e "Tentar de novo".
 * - **Mover é um Select visível** (X02) — ver `CcaBoard`.
 * - **O cartão abre o `DealDetailModal`** (pedido do cliente, 10/09/2026): o
 *   MESMO editor do Pipeline, não uma cópia. Nenhuma regra de permissão nasce
 *   aqui — o modal e o `DealForm` já consultam `can()`, `canEnterStage()` e
 *   `useDealWriteLock()`, e é de lá que sai o que a analista pode tocar.
 */
export default function CcaPipeline() {
  const { can, isAdmin } = useAuth();
  // `null` = ninguém mexeu no período: valem os últimos 30 dias, recalculados a
  // cada render para a virada do dia não congelar o "até hoje" (como no Pipeline).
  const [periodoEscolhido, setPeriodoEscolhido] = useState<CcaPeriodo | null>(null);
  const periodo = periodoEscolhido ?? ultimos30Dias();
  const periodoOk = periodoValido(periodo);
  const board = useCcaBoard(periodo, periodoOk);
  const refresh = useInvalidateCcaBoard();
  const pipelineStages = usePipelineStages();
  // Insumos do editor. São as MESMAS consultas do Pipeline (mesmas chaves do
  // TanStack Query), então abrir as duas telas na sessão não refaz a carga.
  const peopleQuery = usePeople();
  const developersQuery = useDevelopers();
  const statusCatalog = useDealStatusCatalog();
  const invalidateDeals = useInvalidateDeals();
  const buscaId = useId();
  const deId = useId();
  const ateId = useId();
  const periodoMsgId = useId();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [moving, setMoving] = useState<{ deal: CcaDeal; stage: CcaStage } | null>(null);
  const [submissionDeal, setSubmissionDeal] = useState<CcaDeal | null>(null);
  /** Negócio aberto no editor — o `id`, não a linha: assim o modal acompanha o
   *  refetch do quadro em vez de segurar uma cópia congelada. */
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  const canAct = can("cca.review");
  const stages = useMemo(() => board.data?.stages ?? [], [board.data]);
  const deals = useMemo(() => board.data?.deals ?? [], [board.data]);
  const negocios = board.data?.negocios;
  const dealIds = useMemo(() => deals.map((deal) => deal.dealId), [deals]);
  // Fora do gate de espera: o selo é complemento, e sem ele o quadro continua útil.
  const envios = useCcaSendCounts(dealIds, canAct);
  const openDeal = useMemo(
    () => negocios?.find((row) => row.id === openDealId) ?? null,
    [negocios, openDealId],
  );

  const visiveis = useMemo(() => {
    const termo = fold(busca.trim());
    if (!termo) return deals;
    return deals.filter((deal) =>
      fold(`${deal.client} ${deal.developer} ${deal.project} ${deal.broker}`).includes(termo),
    );
  }, [deals, busca]);

  // Estáveis: o `CcaBoard` é `memo`, e abrir um diálogo não redesenha os cartões.
  const abrirNegocio = useCallback((deal: CcaDeal) => {
    // O caso existe na esteira mas o negócio pode não estar na visibilidade de
    // quem olha (`can_see_deal`) — é o mesmo motivo pelo qual `loadCcaBoard`
    // cai em "Cliente não informado". Dizer isso é melhor que um clique que
    // não abre nada.
    const registro = negocios?.find((row) => row.id === deal.dealId);
    if (!registro) {
      toast.error("Não foi possível abrir o negócio", {
        description: "O caso está na esteira, mas o negócio não aparece na sua "
          + "visibilidade. Recarregue a página; se continuar, fale com o administrador.",
      });
      return;
    }
    setOpenDealId(registro.id);
  }, [negocios]);
  const moverCaso = useCallback((deal: CcaDeal, stage: CcaStage) => setMoving({ deal, stage }), []);

  // O catálogo de etapas entra no gate porque `CcaMoveDialog` depende dele para
  // levar o negócio junto ao aprovar: abrir a esteira antes de ele chegar
  // deixava o diálogo confirmar com `approvedStage` indefinido.
  //
  // Pessoas e construtoras entram pelo mesmo motivo, agora que o cartão abre o
  // editor: engoli-las com `?? []` daria um modal com os Selects de corretor e
  // construtora vazios — sem erro e sem "Tentar de novo", com a mesma cara de
  // uma base sem cadastro. É o gate que o Pipeline já faz.
  //
  // O catálogo de status também: o editor lê dele os Selects de Status 1 e
  // Status 2, que abriam vazios e sem explicação quando a leitura falhava.
  //
  // `board.isPending` só vale na primeira carga: trocar o período mantém o
  // quadro anterior (`placeholderData`) em vez de desmontar os campos de data.
  if (board.isPending || pipelineStages.isPending
      || peopleQuery.isPending || developersQuery.isPending || statusCatalog.isPending) {
    return <LoadingState variant="kpi" rows={5} label="Carregando a esteira…" />;
  }

  // `pipelineStages` entra aqui, e não só no gate de espera: falhando, ela
  // devolvia `undefined` em silêncio — `CcaMoveDialog` aprovava com
  // `approvedStage` indefinido e o editor abriria com a lista de etapas vazia.
  //
  // O erro do quadro NÃO entra aqui: depende do período, e trocar a página
  // inteira pelo aviso sumia com os campos De/Até — o "Tentar de novo" pedia o
  // mesmo período que falhou. Ele aparece no lugar do quadro, mais abaixo.
  const cargaFalhou = pipelineStages.error
    ?? peopleQuery.error ?? developersQuery.error ?? statusCatalog.error;
  if (cargaFalhou) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar a esteira CCA"
        description={describeError(cargaFalhou, "Verifique a conexão e tente de novo.")}
        action={
          <Button
            onClick={() => {
              void pipelineStages.refetch();
              void peopleQuery.refetch();
              void developersQuery.refetch();
              void statusCatalog.refetch();
            }}
          >
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    // A página não rola: tem a altura da janela menos o cabeçalho do `AppLayout`
    // (h-16) e o respiro vertical dele (py-5 / sm:py-6 / lg:py-8), e o quadro
    // (`flex-1 min-h-0`) fica com o resto. `min-w-0`: sem isso o quadro estoura
    // a largura da página — o `main` do shell é item de flex.
    // ponytail: altura amarrada ao cabeçalho e ao padding do AppLayout; evoluir
    // para flex no próprio layout quando outra tela precisar de altura cheia.
    <div className="flex h-[calc(100dvh-6.5rem)] min-w-0 flex-col gap-3 sm:h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)]">
      <PageHeader
        className="mb-0 sm:mb-0"
        title="Esteira CCA"
        eyebrow="Crédito"
        icon={Landmark}
        // Sem dados (o período falhou) não há contagem a dizer: "0 caso(s)" seria falso.
        description={board.data && (`${deals.length} caso(s) no período, em ${stages.length} estágio(s).`
          + (board.data.outside ? ` ${board.data.outside} caso(s) fora das colunas ativas (cancelados ou sem coluna).` : ""))}
        actions={
          isAdmin ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setTypesOpen(true)}>
                <FileCog className="mr-1 h-4 w-4" aria-hidden /> Tipos de documento
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-1 h-4 w-4" aria-hidden /> Gerenciar estágios
              </Button>
            </>
          ) : !canAct ? (
            <StatusBadge tone="neutral">Somente leitura</StatusBadge>
          ) : undefined
        }
      />

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Label htmlFor={buscaId} className="sr-only">Buscar caso na esteira</Label>
            <Input
              id={buscaId}
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar cliente, construtora, empreendimento ou corretor"
              className="h-9 pl-9 text-xs"
            />
          </div>
          <Label htmlFor={deId} className="text-xs">De</Label>
          <Input
            id={deId} type="date" className="h-9 w-auto text-xs"
            min="2000-01-01" max={periodo.ate || undefined} value={periodo.de}
            aria-describedby={periodoMsgId} aria-invalid={!periodoOk || undefined}
            onChange={(event) => setPeriodoEscolhido({ ...periodo, de: event.target.value })}
          />
          <Label htmlFor={ateId} className="text-xs">Até</Label>
          <Input
            id={ateId} type="date" className="h-9 w-auto text-xs"
            min={periodo.de || "2000-01-01"} value={periodo.ate}
            aria-describedby={periodoMsgId} aria-invalid={!periodoOk || undefined}
            onChange={(event) => setPeriodoEscolhido({ ...periodo, ate: event.target.value })}
          />
          <Button variant="outline" size="sm" className="h-9" onClick={() => setPeriodoEscolhido(null)}>
            Últimos 30 dias
          </Button>
          {/* Sempre montado: `role="status"` só anuncia a mudança de um nó que já existia. */}
          <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            {board.isFetching && <><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Carregando…</>}
          </span>
        </div>
        <p id={periodoMsgId} aria-live="polite" className={cn("text-xs", periodoOk ? "text-muted-foreground" : "text-destructive")}>
          {periodoOk
            ? "Período pela data de entrada na esteira. A busca procura só nos casos deste período."
            : "Preencha as duas datas, com o início antes do fim."}
        </p>
      </div>

      {envios.isError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-warning">
          Os envios por esteira (Ágil e Virar) não carregaram:{" "}
          {describeError(envios.error, "verifique a conexão.")}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void envios.refetch()}>
            Tentar de novo
          </Button>
        </p>
      )}

      {board.error ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar a esteira CCA"
          description={describeError(board.error, "Verifique a conexão e tente de novo.")}
          action={<Button onClick={() => void board.refetch()}>Tentar de novo</Button>}
        />
      ) : stages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum estágio configurado"
          description="A esteira precisa de pelo menos um estágio para receber casos."
          action={isAdmin ? <Button onClick={() => setSettingsOpen(true)}>Criar estágio</Button> : undefined}
        />
      ) : busca.trim() && visiveis.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum caso para esta busca"
          description={`"${busca.trim()}" não aparece em nenhum dos ${deals.length} caso(s) do período.`}
          action={<Button variant="outline" onClick={() => setBusca("")}>Limpar busca</Button>}
        />
      ) : (
        <CcaBoard
          stages={stages}
          deals={visiveis}
          canAct={canAct}
          sendCounts={envios.data}
          onOpen={abrirNegocio}
          onMove={moverCaso}
          onSubmitToDeveloper={setSubmissionDeal}
        />
      )}

      {/* O MESMO editor do Pipeline, não uma cópia. Nenhuma permissão é
          decidida aqui: `DealForm` já lê `useDealWriteLock`, `canEnterStage`/
          `can_exit_stage` e `offDistratoBlocked` (`can('deals.mark_off_distrato')`),
          e `DealCcaPanel` lê `can('cca.review')` — os mesmos gates que valem
          quando o modal abre pelo Pipeline. */}
      {openDeal && (
        <DealDetailModal
          key={openDeal.id}
          deal={openDeal}
          open
          stages={pipelineStages.data ?? []}
          people={peopleQuery.data ?? []}
          developers={developersQuery.data ?? []}
          onClose={() => setOpenDealId(null)}
          onReviewChanged={async () => { await invalidateDeals(); await refresh(); }}
          onSave={async (updated) => {
            // Só esta guarda: `dealRequiredError` e `findDuplicateDeal`, as
            // outras duas que o Pipeline aplica, só valem na CRIAÇÃO (`form.id`
            // vazio) e daqui nunca sai negócio novo — devolveriam `null` sempre.
            const foraDeFaixa = dealRangeError(updated);
            if (foraDeFaixa) throw dbError("deals", { code: "P0001", message: foraDeFaixa });
            await saveLegacyDeal(updated);
            await invalidateDeals();
            await refresh();
            // O modal fica ABERTO de propósito: logo depois deste `await` ele
            // grava a análise da aba CCA (`saveCcaAnalysis`), que a RLS pode
            // recusar. Fechar aqui apagaria da tela a análise recém-digitada,
            // deixando só o toast de erro — e ela é justamente o que a analista
            // veio fazer.
          }}
        />
      )}

      {settingsOpen && isAdmin && (
        <CcaStageSettingsDialog
          stages={stages}
          onClose={() => setSettingsOpen(false)}
          onChanged={refresh}
        />
      )}

      {typesOpen && isAdmin && <DocumentTypesDialog onClose={() => setTypesOpen(false)} />}

      {moving && (
        <CcaMoveDialog
          deal={moving.deal}
          stage={moving.stage}
          approvedStage={pipelineStages.data?.find((stage) => stage.code === "approved")}
          negocio={negocios?.find((row) => row.id === moving.deal.dealId)}
          onClose={() => setMoving(null)}
          onMoved={refresh}
        />
      )}

      {submissionDeal && (
        <DeveloperSubmissionDialog
          open
          onClose={() => setSubmissionDeal(null)}
          dealId={submissionDeal.dealId}
          clientName={submissionDeal.client}
          developerName={submissionDeal.developer}
          // Enfileirar move o caso para "Enviado à Construtora" (gatilho
          // `developer_submissions_advance_case`, 0077): sem recarregar, o
          // cartão ficava na coluna antiga até alguém dar F5 — o mesmo cuidado
          // que `CcaMoveDialog` e `CcaStageSettingsDialog` já tomavam.
          onChanged={refresh}
        />
      )}
    </div>
  );
}
