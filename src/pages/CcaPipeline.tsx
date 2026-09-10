import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, FileCog, Inbox, Landmark, Loader2, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { describeError } from "@/lib/supabaseError";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import DeveloperSubmissionDialog from "@/components/DeveloperSubmissionDialog";
import {
  listDocumentTypesForAdmin, updateDocumentType, type DocumentTypeAdminRecord,
} from "@/integrations/supabase/documents";
import {
  CcaBoard, CcaMoveDialog, CcaStageSettingsDialog,
  useCcaBoard, useInvalidateCcaBoard, usePipelineStages,
  type CcaDeal, type CcaStage,
} from "@/components/pipeline";

/** Normaliza para busca: sem acento e em minúscula, como o resto das telas. */
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Catálogo de tipos de documento.
 *
 * Antes disto, "quais documentos são obrigatórios", "quais aceitam vários" e o
 * `naming_pattern` só mudavam por SQL — `document_types` era lido em
 * `documents.ts` e em lugar nenhum mais. Fica aqui, ao lado de "Gerenciar
 * estágios", porque `document_types_write` é do mesmo público (admin e CCA).
 *
 * Não cria nem apaga tipo: `code` é referência do seed e de `naming_pattern`, e
 * apagar tipo com documento anexado esbarraria na FK. Desligar (`active`) é a
 * saída — some da tela do corretor e mantém o histórico de pé.
 */
function DocumentTypesDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const fieldId = useId();
  const [rows, setRows] = useState<DocumentTypeAdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listDocumentTypesForAdmin()
      .then((data) => { if (vivo) setRows(data); })
      .catch((e) => toast({
        title: "Falha ao carregar o catálogo",
        description: describeError(e, "Não foi possível ler os tipos de documento."),
        variant: "destructive",
      }))
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [toast]);

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
      toast({
        title: "Catálogo atualizado",
        description: desligouObrigatorio
          ? `${row.label} era obrigatório: sai da aba Anexos e deixa de travar o envio ao gerente.`
          : row.label,
      });
    } catch (e) {
      setRows(anterior);
      toast({
        title: "Não foi possível salvar",
        description: describeError(e, "O catálogo continua como estava."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tipos de documento</DialogTitle>
          <DialogDescription>
            Define o que o corretor vê na aba Anexos: obrigatoriedade, múltiplos arquivos e o
            padrão de nome. Placeholders aceitos: {"{tipo}"}, {"{cliente}"}, {"{data}"} e {"{negocio}"}.
          </DialogDescription>
        </DialogHeader>

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
                className="rounded-lg border border-border/60 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {row.label} <span className="text-xs font-normal text-muted-foreground">({row.code})</span>
                  </p>
                  {busy === row.id && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                </div>

                <div className="flex flex-wrap items-center gap-4">
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Esteira de crédito (CCA).
 *
 * - **Permissão espelhada** (achado P09). A tela usava papel (`roles.includes
 *   ('cca')`) e o banco usa permissão: `cca_cases_write`, `developer_submissions
 *   _write` e — desde a 0059 — `cca_stages_write` exigem
 *   `has_permission('cca.review')`. Se um admin desligasse `cca.review` na tela
 *   de Permissões, os botões continuavam aparecendo e o banco devolvia 42501.
 *   `can()` já curto-circuita em admin, então o gate é um só.
 * - **Estados de verdade** (A01): a carga vive num `useQuery`, com espera, erro
 *   em pt-BR e "Tentar de novo".
 * - **Mover é um Select visível** (X02) — ver `CcaBoard`.
 * - **Busca** (0059): 12 casos cabem na tela, 200 viram rolagem. O filtro é do
 *   lado do cliente porque a esteira inteira já vem numa consulta só.
 */
export default function CcaPipeline() {
  const { can } = useAuth();
  const board = useCcaBoard();
  const refresh = useInvalidateCcaBoard();
  const pipelineStages = usePipelineStages();
  const buscaId = useId();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [moving, setMoving] = useState<{ deal: CcaDeal; stage: CcaStage } | null>(null);
  const [submissionDeal, setSubmissionDeal] = useState<CcaDeal | null>(null);

  const canAct = can("cca.review");
  const stages = useMemo(() => board.data?.stages ?? [], [board.data]);
  const deals = useMemo(() => board.data?.deals ?? [], [board.data]);

  const visiveis = useMemo(() => {
    const termo = fold(busca.trim());
    if (!termo) return deals;
    return deals.filter((deal) =>
      fold(`${deal.client} ${deal.developer} ${deal.project} ${deal.broker}`).includes(termo),
    );
  }, [deals, busca]);

  // O catálogo de etapas entra no gate porque `CcaMoveDialog` depende dele para
  // levar o negócio junto ao aprovar: abrir a esteira antes de ele chegar
  // deixava o diálogo confirmar com `approvedStageId` indefinido.
  if (board.isPending || pipelineStages.isPending) {
    return <LoadingState variant="kpi" rows={5} label="Carregando a esteira…" />;
  }

  if (board.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar a esteira CCA"
        description={describeError(board.error, "Verifique a conexão e tente de novo.")}
        action={<Button onClick={() => void board.refetch()}>Tentar de novo</Button>}
      />
    );
  }

  return (
    // `min-w-0`: sem isso o quadro rolável estoura a largura da página inteira —
    // o `main` do shell é item de flex e um filho de bloco cresce até o conteúdo.
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Esteira CCA"
        eyebrow="Crédito"
        icon={Landmark}
        description={`${deals.length} caso(s) em ${stages.length} estágio(s).`}
        actions={
          canAct ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setTypesOpen(true)}>
                <FileCog className="mr-1 h-4 w-4" aria-hidden /> Tipos de documento
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-1 h-4 w-4" aria-hidden /> Gerenciar estágios
              </Button>
            </div>
          ) : (
            <StatusBadge tone="neutral">Somente leitura</StatusBadge>
          )
        }
      />

      <div className="relative max-w-sm">
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

      {stages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum estágio configurado"
          description="A esteira precisa de pelo menos um estágio para receber casos."
          action={canAct ? <Button onClick={() => setSettingsOpen(true)}>Criar estágio</Button> : undefined}
        />
      ) : busca.trim() && visiveis.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum caso para esta busca"
          description={`"${busca.trim()}" não aparece em nenhum dos ${deals.length} caso(s) da esteira.`}
          action={<Button variant="outline" onClick={() => setBusca("")}>Limpar busca</Button>}
        />
      ) : (
        <CcaBoard
          stages={stages}
          deals={visiveis}
          canAct={canAct}
          onMove={(deal, stage) => setMoving({ deal, stage })}
          onSubmitToDeveloper={setSubmissionDeal}
        />
      )}

      {settingsOpen && canAct && (
        <CcaStageSettingsDialog
          stages={stages}
          onClose={() => setSettingsOpen(false)}
          onChanged={refresh}
        />
      )}

      {typesOpen && canAct && <DocumentTypesDialog onClose={() => setTypesOpen(false)} />}

      {moving && (
        <CcaMoveDialog
          deal={moving.deal}
          stage={moving.stage}
          approvedStageId={pipelineStages.data?.find((stage) => stage.code === "approved")?.id}
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
