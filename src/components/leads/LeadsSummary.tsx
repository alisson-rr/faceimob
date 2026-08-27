import { AlertTriangle, CheckCircle2, HandMetal, Inbox, Users } from "lucide-react";
import { KpiCard } from "@/components/shared";
import { num } from "@/lib/format";
import type { LeadMetrics } from "./model";

/**
 * Régua de indicadores da tela.
 *
 * "Atrasados" leva `tone: "danger"` explícito: subir é ruim aqui, e é essa a
 * conta que bloqueia o check-in (`overdue_lead_count`). Sem o tom, a seta para
 * cima sairia verde.
 */
export function LeadsSummary({ metrics }: { metrics: LeadMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard label="Total" value={num(metrics.total)} icon={Users} />
      <KpiCard label="Na fila" value={num(metrics.queued)} icon={Inbox} hint="aguardando a roleta" />
      <KpiCard label="Em atendimento" value={num(metrics.attending)} icon={HandMetal} />
      <KpiCard label="Convertidos" value={num(metrics.converted)} icon={CheckCircle2} variant="highlight" />
      <KpiCard
        label="Atrasados"
        value={num(metrics.overdue)}
        icon={AlertTriangle}
        hint={metrics.overdue > 0 ? "próxima ação vencida" : "nenhuma ação vencida"}
        delta={metrics.overdue > 0 ? { label: `${num(metrics.overdue)} para tratar`, direction: "up", tone: "danger" } : undefined}
      />
    </div>
  );
}
