import { useMemo, useState } from "react";
import { AlertTriangle, Inbox, Landmark, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import DeveloperSubmissionDialog from "@/components/DeveloperSubmissionDialog";
import {
  CcaBoard, CcaMoveDialog, CcaStageSettingsDialog,
  useCcaBoard, useInvalidateCcaBoard, usePipelineStages,
  type CcaDeal, type CcaStage,
} from "@/components/pipeline";

/**
 * Esteira de crédito (CCA).
 *
 * Três correções de fundo:
 *
 * - **Permissão espelhada** (achado P09). A tela não tinha gate nenhum, mas
 *   `cca_stages_write` e `cca_cases_write` só aceitam `admin` e `cca` — o sócio,
 *   que tem `menu.cca`, clicava e levava 42501 com mensagem crua. `canAct` usa
 *   `roles.includes('cca')`: papel é N:N em `user_roles`, e comparar `role` com
 *   igualdade negaria quem é CCA **e** gerente.
 * - **Estados de verdade** (A01): a carga vive num `useQuery`, com espera, erro
 *   em pt-BR e "Tentar de novo".
 * - **Mover é um Select visível** (X02) — ver `CcaBoard`.
 */
export default function CcaPipeline() {
  const { isAdmin, roles } = useAuth();
  const board = useCcaBoard();
  const refresh = useInvalidateCcaBoard();
  const pipelineStages = usePipelineStages();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moving, setMoving] = useState<{ deal: CcaDeal; stage: CcaStage } | null>(null);
  const [submissionDeal, setSubmissionDeal] = useState<CcaDeal | null>(null);

  const canAct = isAdmin || roles.includes("cca");
  const stages = useMemo(() => board.data?.stages ?? [], [board.data]);
  const deals = useMemo(() => board.data?.deals ?? [], [board.data]);

  if (board.isPending) return <LoadingState variant="kpi" rows={5} label="Carregando a esteira…" />;

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
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings className="mr-1 h-4 w-4" /> Gerenciar estágios
            </Button>
          ) : (
            <StatusBadge tone="neutral">Somente leitura</StatusBadge>
          )
        }
      />

      {stages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum estágio configurado"
          description="A esteira precisa de pelo menos um estágio para receber casos."
          action={canAct ? <Button onClick={() => setSettingsOpen(true)}>Criar estágio</Button> : undefined}
        />
      ) : (
        <CcaBoard
          stages={stages}
          deals={deals}
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
        />
      )}
    </div>
  );
}
