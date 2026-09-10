import { num } from "@/lib/format";
import type { LeadCounts } from "@/integrations/supabase/checkin";

/**
 * Contador de leads recebidos por período (ata 23/07).
 *
 * Conta atribuições, não leads em mãos: incluir o que passou pelo corretor e
 * saiu é o que torna o número comparável entre pessoas.
 *
 * Os números chegam prontos de quem já carrega o check-in. Antes este
 * componente buscava por conta própria enquanto o badge do turno mostrava
 * `checkins.leads_received` — que só a roleta incrementa —, então os dois
 * números da mesma tela discordavam a cada realocação manual (F13). Sem número
 * o card mostra travessão: fingir zero seria pior que dizer "não sei".
 */
export default function LeadCounter({ counts }: { counts: LeadCounts | null }) {
  const items = [
    { label: "Hoje", value: counts?.today },
    { label: "Semana", value: counts?.week },
    { label: "Mês", value: counts?.month },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-card p-3 text-center">
          <p className="text-eyebrow">{item.label}</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums">
            {item.value === undefined ? "—" : num(item.value)}
          </p>
        </div>
      ))}
    </div>
  );
}
