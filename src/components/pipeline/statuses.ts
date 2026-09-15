/**
 * Status 1 e Status 2 lidos do catálogo do banco (`useDealStatusCatalog`).
 *
 * Até a 0149 o Status 2 era a lista fixa `FACEIMOB_STATUSES` daqui, e status
 * novo exigia deploy. As funções abaixo recebem o catálogo: opções, cor, ordem
 * e nome exibido saem dele. O que continua no código é regra que cita status
 * pelo TEXTO (`LOSS_REASONS`, `SYSTEM_STATUSES`, em `@/lib/dealStatus`).
 *
 * `value` é o que está gravado em `deals.status_detail`; `label` é o que a tela
 * mostra. Fora do catálogo (importação antiga, rótulo derivado do desfecho) o
 * nome cai em `bareStatus`, e a cor em neutro.
 */
import type { StatusTone } from "@/components/shared";
import { bareStatus, isSystemStatus } from "@/lib/dealStatus";
import { statusKey, type DealStatusCatalog, type DealStatusGroup } from "@/integrations/supabase/dealStatuses";

export type StatusOption = { value: string; label: string; tone: StatusTone };

const entryOf = (catalog: DealStatusCatalog, value: string | null | undefined) => {
  const index = catalog.indexByKey.get(statusKey(value));
  return index === undefined ? undefined : catalog.statuses[index];
};

/** Nome exibido do Status 2. */
export const statusLabel = (catalog: DealStatusCatalog, value: string | null | undefined): string =>
  entryOf(catalog, value)?.label ?? bareStatus(value);

export const faceimobStatusTone = (catalog: DealStatusCatalog, value: string | null | undefined): StatusTone =>
  entryOf(catalog, value)?.tone ?? "neutral";

/** Ordem de exibição da tabela — a do catálogo, desconhecido por último. */
export const faceimobStatusRank = (catalog: DealStatusCatalog, value: string | null | undefined): number =>
  catalog.indexByKey.get(statusKey(value)) ?? catalog.statuses.length;

/** Status 1 que o Status 2 leva junto, pelo catálogo. `null` = fora do catálogo. */
export const statusGroupOf = (catalog: DealStatusCatalog, value: string | null | undefined): string | null =>
  entryOf(catalog, value)?.group_id ?? null;

export const statusGroupLabel = (catalog: DealStatusCatalog, groupId: string | null | undefined): string | null =>
  (groupId && catalog.groupById.get(groupId)?.label) || null;

/**
 * Opções do Select de Status 2 garantindo que o valor atual sempre aparece.
 *
 * Um `status_detail` fora do catálogo, ou desativado depois, deixaria o Select
 * em branco (achado F10) — e o primeiro clique sobrescreveria o valor sem
 * ninguém ver qual era. A comparação do valor atual é EXATA: o Radix casa o
 * `value` do Select com o `value` do item, e "QUEDA" não abre "18. QUEDA".
 *
 * Os rótulos do sistema (`SYSTEM_STATUSES`) ficam de fora: o banco os escreve
 * quando o caso entra na esteira e recusa a escolha manual. Os Status 2 de um
 * Status 1 desativado também: desligar o grupo na tela de cadastro tira as
 * opções dele, e escolher uma delas levaria o negócio de volta ao grupo
 * desligado (`deal_status_group_for` não olha `active`).
 */
export const statusChoices = (catalog: DealStatusCatalog, current?: string | null): StatusOption[] => {
  const choices = catalog.statuses
    .filter((status) => status.value === current
      || (status.active && catalog.groupById.get(status.group_id)?.active && !isSystemStatus(status.value)))
    .map(({ value, label, tone }) => ({ value, label, tone }));
  return current && !choices.some((option) => option.value === current)
    ? [{ value: current, label: statusLabel(catalog, current), tone: faceimobStatusTone(catalog, current) }, ...choices]
    : choices;
};

/** Status 1 ativos, mais o atual mesmo desativado — pelo mesmo motivo do F10. */
export const groupChoices = (catalog: DealStatusCatalog, currentId?: string | null): DealStatusGroup[] =>
  catalog.groups.filter((group) => group.active || group.id === currentId);

/**
 * Código de um Status 1 novo: caixa alta, sem acento, só letra, número e `_`,
 * até 40 caracteres (CHECK de `deal_status_groups.code`). "Pós-venda" → "POS_VENDA".
 */
export const statusGroupCode = (name: string): string =>
  name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+/, "").slice(0, 40).replace(/_+$/, "");

/** Classes do gatilho colorido na tabela. Literais, para o Tailwind enxergar. */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  highlight: "bg-highlight text-highlight-foreground",
};
