/**
 * Apresentação da etapa — e só isso.
 *
 * A fonte de verdade das etapas é `pipeline_stages` no banco: `code`, `label`,
 * `position` e o `id` que `can_enter_stage()` autoriza. Antes havia três fontes
 * discordando (`DEAL_STAGES` em `types/crm.ts`, `tableStageLabels` no Pipeline e
 * a coluna `label`, que ninguém lia — achados F10/F11). Agora o rótulo vem do
 * banco (`listPipelineStages` para as colunas, `deal.stage_label` para a linha)
 * e este módulo devolve apenas o TOM de cada etapa.
 *
 * `pipeline_stages.color` existe no banco e é hex (`#94a3b8`) — não pode ser
 * usado: hex não acompanha a troca de tema. Por isso o tom é mapeado por `code`.
 */
import type { StatusTone } from "@/components/shared";
import type { PipelineStageRecord } from "@/integrations/supabase/permissions";

export type PipelineStage = PipelineStageRecord;

/** Etapa de desfecho: aparece na linha da tabela, nunca como coluna do funil. */
export const LOST_STAGE_CODE = "lost";

const TONE_BY_CODE: Record<string, StatusTone> = {
  incomplete: "danger",
  lead: "neutral",
  proposal: "info",
  visit_scheduled: "warning",
  under_analysis: "warning",
  approved: "success",
  contract: "info",
  closed: "highlight",
  [LOST_STAGE_CODE]: "danger",
};

/** Etapa criada pelo admin depois do seed cai em `neutral` — nunca sem cor. */
export const stageTone = (code: string): StatusTone => TONE_BY_CODE[code] ?? "neutral";

/**
 * Classes da coluna do kanban. Escritas por extenso de propósito: classe
 * montada em runtime (`bg-${tom}/15`) não entra no bundle do Tailwind.
 */
export const STAGE_SURFACE: Record<StatusTone, { border: string; header: string; dot: string; body: string }> = {
  success: { border: "border-success/25", header: "bg-success/15", dot: "bg-success", body: "bg-success/5" },
  warning: { border: "border-warning/25", header: "bg-warning/15", dot: "bg-warning", body: "bg-warning/5" },
  info: { border: "border-info/25", header: "bg-info/15", dot: "bg-info", body: "bg-info/5" },
  danger: { border: "border-destructive/25", header: "bg-destructive/15", dot: "bg-destructive", body: "bg-destructive/5" },
  neutral: { border: "border-border", header: "bg-muted/40", dot: "bg-muted-foreground", body: "bg-muted/20" },
  highlight: { border: "border-highlight/30", header: "bg-highlight/20", dot: "bg-highlight", body: "bg-highlight/5" },
};

export const stageSurface = (code: string) => STAGE_SURFACE[stageTone(code)];

/** Colunas do funil: tudo que não é desfecho, na ordem do catálogo. */
export const funnelStages = (stages: PipelineStage[]): PipelineStage[] =>
  stages.filter((stage) => stage.code !== LOST_STAGE_CODE);

/**
 * Rótulo por código. Usado quando só existe o código em mãos (toast de
 * movimentação); a tabela prefere `deal.stage_label`, que já vem do banco.
 */
export const stageLabelOf = (stages: PipelineStage[], code: string): string =>
  stages.find((stage) => stage.code === code)?.label ?? code;
