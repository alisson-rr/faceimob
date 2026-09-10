import {
  ArrowRightCircle, HandMetal, Mail, MessageCircle, Pencil, RefreshCcw, Timer, Trash2, UserPlus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/shared";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  attendSecondsLeft, canClaim, formatCountdown, funnelStageLabel, funnelStageTone,
  isLeadOverdue, isLeadUnattended, leadStatusLabel, leadStatusTone, leadSourceTone,
  type LeadRecord,
} from "@/integrations/supabase/leads";

export type LeadRowActions = {
  onOpen: (lead: LeadRecord) => void;
  onAttend: (lead: LeadRecord) => void;
  onEdit: (lead: LeadRecord) => void;
  onReassign: (lead: LeadRecord) => void;
  onConvert: (lead: LeadRecord) => void;
  onWhatsApp: (lead: LeadRecord) => void;
  onEmail: (lead: LeadRecord) => void;
  /** Encerrar como perdido/descartado com motivo — a saída da conta de atrasados. */
  onCloseLead: (lead: LeadRecord) => void;
  onDelete: (lead: LeadRecord) => void;
};

/**
 * O que ESTE usuário pode fazer com cada lead.
 *
 * Era uma lista fixa de papéis (`GESTOR_ROLES`) e nenhuma checagem nas outras
 * ações: o sócio recebia Editar e Converter em 62 leads que não são dele e o
 * banco recusava com 42501 depois do clique. `canWrite` espelha
 * `can_write_lead()`; `canReassign` e `canDelete` são os códigos que o banco
 * lê (`leads.reassign`, `leads.delete`), então pré-visualizar papel muda a tela.
 */
export type LeadPermissions = {
  canWrite: (lead: LeadRecord) => boolean;
  canReassign: boolean;
  canDelete: boolean;
};

/**
 * Lista de leads.
 *
 * O nome do cliente é um `<button>` de verdade e abre o `LeadDetailModal` — era
 * o único caminho que faltava (só a notificação abria o detalhe). Linha inteira
 * clicável foi descartada de propósito: `<tr onClick>` não recebe foco nem
 * responde a Enter (X06), e a linha ainda carrega outros botões.
 */
export function LeadsTable({
  leads, now, profileId, permissions, actions, maxRounds = 5,
}: {
  leads: LeadRecord[];
  now: number;
  profileId: string | null;
  permissions: LeadPermissions;
  actions: LeadRowActions;
  /** `automation_settings.roulette_max_rounds` — o teto de voltas da roleta. */
  maxRounds?: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[200px]">Cliente</TableHead>
          <TableHead className="hidden min-w-[150px] lg:table-cell">Etapa</TableHead>
          <TableHead className="hidden min-w-[130px] lg:table-cell">Origem</TableHead>
          <TableHead className="hidden min-w-[130px] lg:table-cell">Corretor</TableHead>
          <TableHead className="hidden min-w-[130px] lg:table-cell">Recebido</TableHead>
          <TableHead className="min-w-[110px] text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => (
          <LeadRow
            key={lead.id}
            lead={lead}
            now={now}
            claimable={canClaim(lead, profileId)}
            overdue={isLeadOverdue(lead, now)}
            writable={permissions.canWrite(lead)}
            unattended={isLeadUnattended(lead, maxRounds)}
            permissions={permissions}
            actions={actions}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function LeadRow({
  lead, now, claimable, overdue, writable, unattended, permissions, actions,
}: {
  lead: LeadRecord;
  now: number;
  claimable: boolean;
  overdue: boolean;
  writable: boolean;
  /** Saiu da roleta por falta de atendimento: espera na bandeja do gestor. */
  unattended: boolean;
  permissions: LeadPermissions;
  actions: LeadRowActions;
}) {
  const secondsLeft = attendSecondsLeft(lead, now);
  const convertible = lead.status !== "converted" && !lead.converted_deal_id;
  const encerravel = !["converted", "lost", "discarded"].includes(lead.status)
    && !lead.converted_deal_id;

  return (
    <TableRow className={cn(claimable && "bg-primary/5", overdue && "bg-destructive/5")}>
      <TableCell className="align-top">
        <button
          type="button"
          onClick={() => actions.onOpen(lead)}
          className="rounded-md text-left font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {lead.name}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={leadStatusTone(lead.status)}>{leadStatusLabel(lead.status)}</StatusBadge>
          {/* Abaixo de `lg` as quatro colunas seguintes somem para o corretor
              alcançar "Atender" sem rolar a tabela de lado — o que elas dizem
              volta aqui, junto do nome. */}
          <StatusBadge tone={funnelStageTone(lead.funnel_stage)} className="lg:hidden">
            {funnelStageLabel(lead.funnel_stage)}
          </StatusBadge>
          {secondsLeft !== null && (
            <StatusBadge tone={secondsLeft <= 60 ? "danger" : "warning"} icon={Timer}>
              <span className="tabular-nums">{formatCountdown(secondsLeft)}</span>
            </StatusBadge>
          )}
          {overdue && <StatusBadge tone="danger">Atrasado</StatusBadge>}
          {/* Um lead na 19ª volta era indistinguível de um lead novo: as duas
              linhas diziam só "Na fila". A volta é o que separa "acabou de
              chegar" de "ninguém atendeu cinco vezes". */}
          {lead.roulette_misses > 0 && (
            <StatusBadge tone={unattended ? "danger" : "warning"} icon={RefreshCcw}>
              {unattended
                ? `Sem atendimento · ${lead.roulette_misses} voltas`
                : `${lead.roulette_misses}ª volta na roleta`}
            </StatusBadge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground lg:hidden">
          {lead.source || "Sem origem"} · {lead.broker_name || "sem corretor"} · {dateTime(lead.created_at)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {lead.phone && (
            <Button
              variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-success hover:text-success"
              onClick={() => actions.onWhatsApp(lead)}
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </Button>
          )}
          {lead.email && (
            <Button
              variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs"
              onClick={() => actions.onEmail(lead)}
            >
              <Mail className="h-3.5 w-3.5" /> E-mail
            </Button>
          )}
        </div>
      </TableCell>

      <TableCell className="hidden align-top lg:table-cell">
        <StatusBadge tone={funnelStageTone(lead.funnel_stage)}>{funnelStageLabel(lead.funnel_stage)}</StatusBadge>
      </TableCell>

      <TableCell className="hidden align-top lg:table-cell">
        <StatusBadge tone={leadSourceTone(lead.source)}>{lead.source || "Sem origem"}</StatusBadge>
        {lead.campaign_name && (
          <p className="mt-1 max-w-[160px] truncate text-xs text-muted-foreground">{lead.campaign_name}</p>
        )}
      </TableCell>

      <TableCell className="hidden align-top text-sm text-muted-foreground lg:table-cell">{lead.broker_name || "—"}</TableCell>

      <TableCell className="hidden align-top text-sm tabular-nums text-muted-foreground lg:table-cell">{dateTime(lead.created_at)}</TableCell>

      <TableCell className="align-top">
        <div className="flex flex-wrap items-center justify-end gap-1">
          {claimable && (
            <Button size="sm" className="h-8 gap-1" onClick={() => actions.onAttend(lead)}>
              <HandMetal className="h-3.5 w-3.5" /> Atender
            </Button>
          )}
          {writable && (
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${lead.name}`} onClick={() => actions.onEdit(lead)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {permissions.canReassign && (
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Realocar ${lead.name}`} onClick={() => actions.onReassign(lead)}>
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
          {convertible && writable && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-success hover:text-success"
              aria-label={`Converter ${lead.name} em negócio`} onClick={() => actions.onConvert(lead)}
            >
              <ArrowRightCircle className="h-4 w-4" />
            </Button>
          )}
          {encerravel && writable && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label={`Encerrar ${lead.name} como perdido`} onClick={() => actions.onCloseLead(lead)}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          {permissions.canDelete && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
              aria-label={`Excluir ${lead.name}`} onClick={() => actions.onDelete(lead)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
