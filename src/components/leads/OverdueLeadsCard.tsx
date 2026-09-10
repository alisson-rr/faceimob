import { AlertTriangle, CalendarClock, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import { dateTime, num } from "@/lib/format";
import { funnelStageLabel, type LeadRecord } from "@/integrations/supabase/leads";
import { overdueByBroker } from "./model";

/** Quantos atrasados cabem antes de virar rolagem dentro do card. */
const VISIBLE = 8;

/**
 * Leads atrasados — a mesma conta de `overdue_lead_count`, que é a que bloqueia
 * o check-in. Uma heurística de tela diferente daqui mentiria para o corretor
 * sobre por que ele não consegue bater ponto.
 *
 * Duas leituras, porque o limite é INDIVIDUAL:
 *   · dono dos leads (corretor): a própria conta contra o próprio limite;
 *   · quem vê a equipe (gerente, diretor): um bloco por corretor, cada um
 *     comparado com o limite. Somar a equipe inteira contra um limite
 *     individual dizia "Check-in bloqueado" para quem não estava bloqueado —
 *     a Daniela Diretora via 29 atrasados de gente diferente contra o limite 20.
 *
 * Cada linha abre o lead e oferece "Reagendar": o card cobrava "trate cada um
 * para liberar novos check-ins" sem dar a ação que resolve — a próxima ação só
 * podia ser mexida indo até a aba Agenda do lead.
 */
export function OverdueLeadsCard({
  leads, threshold, profileId, onOpen, onReschedule, onCloseLead,
}: {
  leads: LeadRecord[];
  threshold: number;
  /** Quem está olhando. Serve para separar "meus atrasados" dos da equipe. */
  profileId: string | null;
  onOpen: (lead: LeadRecord) => void;
  onReschedule: (lead: LeadRecord) => void;
  /** Encerrar como perdido/descartado: a outra saída, além de reagendar. */
  onCloseLead?: (lead: LeadRecord) => void;
}) {
  // Zero atrasado é informação, não ausência de informação: o card sumia e o
  // corretor não distinguia "estou em dia" de "o bloco quebrou".
  if (leads.length === 0) {
    return (
      <SectionCard
        title="Leads atrasados (0)"
        description="Nenhuma próxima ação vencida: nada aqui bloqueia o seu check-in."
        icon={CheckCircle2}
        actions={<StatusBadge tone="success">Tudo em dia · limite {num(threshold)}</StatusBadge>}
      >
        <p className="text-sm text-muted-foreground">
          Assim que uma próxima ação vencer, o lead aparece aqui com os botões de reagendar e de
          encerrar com motivo.
        </p>
      </SectionCard>
    );
  }

  const meus = leads.filter((lead) => lead.assigned_to === profileId);
  const daEquipe = leads.filter((lead) => lead.assigned_to !== profileId);
  const bloqueado = meus.length >= threshold;
  const gruposDaEquipe = overdueByBroker(daEquipe, threshold);
  const bloqueadosNaEquipe = gruposDaEquipe.filter((grupo) => grupo.blocked);

  return (
    <SectionCard
      title={`Leads atrasados (${num(leads.length)})`}
      description={
        meus.length > 0
          ? "Próxima ação vencida. Reagende ou conclua para liberar novos check-ins."
          : "Próxima ação vencida na sua equipe. O limite de bloqueio é por corretor."
      }
      icon={AlertTriangle}
      actions={
        meus.length > 0 ? (
          <StatusBadge tone={bloqueado ? "danger" : "warning"}>
            {bloqueado
              ? "Seu check-in está bloqueado"
              : `Seus: ${num(meus.length)} de ${num(threshold)}`}
          </StatusBadge>
        ) : (
          <StatusBadge tone={bloqueadosNaEquipe.length ? "danger" : "warning"}>
            {bloqueadosNaEquipe.length
              ? `${num(bloqueadosNaEquipe.length)} corretor(es) bloqueado(s)`
              : `${num(daEquipe.length)} na sua equipe`}
          </StatusBadge>
        )
      }
      contentClassName="space-y-3"
    >
      {meus.length > 0 && (
        <div className="space-y-2">
          {daEquipe.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Seus leads ({num(meus.length)})
            </p>
          )}
          {meus.slice(0, VISIBLE).map((lead) => (
            <OverdueRow
              key={lead.id} lead={lead}
              onOpen={onOpen} onReschedule={onReschedule} onCloseLead={onCloseLead}
            />
          ))}
          {meus.length > VISIBLE && (
            <p className="text-xs text-muted-foreground">
              + {num(meus.length - VISIBLE)} outros leads seus atrasados.
            </p>
          )}
        </div>
      )}

      {gruposDaEquipe.map((grupo) => (
        <div key={grupo.brokerId ?? "sem-corretor"} className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {grupo.brokerName} ({num(grupo.leads.length)})
            <StatusBadge tone={grupo.blocked ? "danger" : "neutral"}>
              {grupo.blocked ? "check-in bloqueado" : `limite ${num(threshold)}`}
            </StatusBadge>
          </p>
          {grupo.leads.slice(0, VISIBLE).map((lead) => (
            <OverdueRow
              key={lead.id} lead={lead}
              onOpen={onOpen} onReschedule={onReschedule} onCloseLead={onCloseLead}
            />
          ))}
          {grupo.leads.length > VISIBLE && (
            <p className="text-xs text-muted-foreground">
              + {num(grupo.leads.length - VISIBLE)} outros de {grupo.brokerName}.
            </p>
          )}
        </div>
      ))}
    </SectionCard>
  );
}

function OverdueRow({
  lead, onOpen, onReschedule, onCloseLead,
}: {
  lead: LeadRecord;
  onOpen: (lead: LeadRecord) => void;
  onReschedule: (lead: LeadRecord) => void;
  onCloseLead?: (lead: LeadRecord) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
      <button
        type="button"
        onClick={() => onOpen(lead)}
        className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{lead.name}</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            venceu em {dateTime(lead.next_action_at)}
          </span>
        </span>
        <StatusBadge tone="neutral" className="shrink-0">{funnelStageLabel(lead.funnel_stage)}</StatusBadge>
      </button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1 px-2 text-xs"
        onClick={() => onReschedule(lead)}
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Reagendar
      </Button>
      {/* A saída que faltava. Sem ela o único jeito de sair da conta dos 20 era
          reagendar para sempre — a trava punia quem é honesto e o lead que
          nunca vai responder ficava atrasado para o resto da vida. */}
      {onCloseLead && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Encerrar ${lead.name} como perdido`}
          onClick={() => onCloseLead(lead)}
        >
          <XCircle className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
