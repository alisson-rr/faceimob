import { AlertTriangle, CheckCircle2, HandMetal, Inbox, Timer, Users } from "lucide-react";
import { KpiCard } from "@/components/shared";
import { num } from "@/lib/format";
import type { LeadMetrics } from "./model";

/**
 * Régua de indicadores da tela.
 *
 * "Atrasados" leva `tone: "danger"` explícito: subir é ruim aqui, e é essa a
 * conta que bloqueia o check-in (`overdue_lead_count`). Sem o tom, a seta para
 * cima sairia verde.
 *
 * O primeiro card depende de quem olha. "Na fila" é estruturalmente 0 para o
 * corretor — `leads_select` só mostra lead sem dono a quem tem
 * `leads.view_queue`, que nenhum corretor tem —, então para ele o card vira
 * "Aguardando você atender", que é o número que corre contra a trava de 5
 * minutos e o único acionável nessa posição.
 */
export function LeadsSummary({ metrics, canViewQueue }: { metrics: LeadMetrics; canViewQueue: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard label="Total" value={num(metrics.total)} icon={Users} />
      {canViewQueue ? (
        <KpiCard label="Na fila" value={num(metrics.queued)} icon={Inbox} hint="aguardando a roleta" />
      ) : (
        <KpiCard
          label="Aguardando você"
          value={num(metrics.awaiting)}
          icon={Timer}
          hint={metrics.awaiting > 0 ? "clique em Atender antes do prazo" : "nenhum lead na trava"}
        />
      )}
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
