/**
 * Apresentação da etapa — e só isso.
 *
 * A fonte de verdade das etapas é `pipeline_stages` no banco: `code`, `label`,
 * `position` e o `id` que `can_enter_stage()` autoriza. Antes havia três fontes
 * discordando (`DEAL_STAGES` em `types/crm.ts`, `tableStageLabels` no Pipeline e
 * a coluna `label`, que ninguém lia — achados F10/F11). Agora o rótulo vem do
 * banco (`listPipelineStages` para as colunas, `deal.stage_label` para a linha)
 * e este módulo devolve apenas a COR de cada etapa.
 *
 * A cor é `pipeline_stages.color` (hex, `#94a3b8`). Antes ela não podia ser
 * usada porque a coluna era tingida por token e o texto por cima tinha cor
 * fixa; desde o kanban colorido (18/09/2026) o cabeçalho é SÓLIDO e o texto
 * escolhe preto ou branco sozinho (`textOn`), então o hex vale nos dois temas.
 * O tom por `code` fica de reserva para etapa sem hex válido.
 */
import type { StatusTone } from "@/components/shared";
import type { PipelineStageRecord } from "@/integrations/supabase/permissions";
import { TONE_HEX, isHexColor } from "@/lib/tone";

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

/** Cor da coluna como `#RRGGBB`: a do banco, ou a do tom da etapa. */
export const pipelineStageColor = (stage: Pick<PipelineStage, "code" | "color">): string =>
  isHexColor(stage.color) ? stage.color : TONE_HEX[stageTone(stage.code)];

/** Colunas do funil: tudo que não é desfecho, na ordem do catálogo. */
export const funnelStages = (stages: PipelineStage[]): PipelineStage[] =>
  stages.filter((stage) => stage.code !== LOST_STAGE_CODE);

/**
 * Rótulo por código. Usado quando só existe o código em mãos (toast de
 * movimentação); a tabela prefere `deal.stage_label`, que já vem do banco.
 */
export const stageLabelOf = (stages: PipelineStage[], code: string): string =>
  stages.find((stage) => stage.code === code)?.label ?? code;
