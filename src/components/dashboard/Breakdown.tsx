import { Layers, UserCog } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { seriesToken, tone } from "@/lib/tone";
import type { DashboardPayload } from "@/integrations/supabase/newSchema";

type CountItem = { label: string; value: number; token: string };

/** Grade de contagem: rotulo escrito em cima, numero grande embaixo. */
function CountGrid({ items }: { items: CountItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <li
          key={item.label}
          className="rounded-xl border p-4"
          style={{ borderColor: tone(item.token, 0.35), background: tone(item.token, 0.1) }}
        >
          <p className="text-eyebrow leading-tight">{item.label}</p>
          <p className="mt-2 font-display text-2xl font-bold leading-none tabular-nums text-foreground">
            {num(item.value)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Situação dos processos na esteira de crédito. O rotulo ja vem traduzido de
 * `loadDashboardPayload`, que hoje usa o mesmo `ccaStatusLabel` da tela do CCA —
 * as chaves aqui seguem esse vocabulario. Antes divergiam ("Análise de
 * Viabilidade", "Assinatura no Banco") e a cor semantica caia no `seriesToken`.
 */
const CCA_TOKEN: Record<string, string> = {
  "Aguardando documentos": "warning",
  "Em análise": "chart-4",
  "Enviado à construtora": "chart-4",
  "Enviado à agência": "chart-1",
  Aprovado: "success",
  Reprovado: "destructive",
  Cancelado: "muted-foreground",
};

/**
 * `toda` = quem le a esteira inteira (`cca_cases_select` libera tudo para admin
 * e cca; para os demais vale `can_see_deal`). Sem essa distincao o corretor lia
 * "Nenhum processo no CCA" sob o titulo da empresa e entendia que a operacao
 * inteira estava parada, quando a contagem era so o recorte dele.
 */
export function CcaStatusCard({
  counts,
  toda,
}: {
  counts: Record<string, number>;
  toda: boolean;
}) {
  const items = Object.entries(counts).map(([label, value], index) => ({
    label,
    value,
    token: CCA_TOKEN[label] ?? seriesToken(index),
  }));

  return (
    <SectionCard
      title="Esteira de crédito"
      description={toda ? "Processos do CCA por situação" : "Processos do CCA nos seus negócios"}
      icon={Layers}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={toda ? "Nenhum processo no CCA" : "Nenhum processo do CCA nos seus negócios"}
          description={
            toda
              ? "Assim que um negócio entrar na esteira de crédito, a situação dele aparece aqui."
              : "Assim que um dos seus negócios entrar na esteira de crédito, a situação dele aparece aqui."
          }
        />
      ) : (
        <CountGrid items={items} />
      )}
    </SectionCard>
  );
}

export function StaffCard({ staff }: { staff: DashboardPayload["staff"] }) {
  const items: CountItem[] = [
    { label: "Corretores", value: staff.brokersTotal, token: "chart-1" },
    { label: "Gerentes", value: staff.managers, token: "chart-5" },
    { label: "Diretores", value: staff.directors, token: "chart-3" },
    { label: "Pessoas ativas", value: staff.active, token: "chart-2" },
  ];

  return (
    <SectionCard title="Time" description="Composição da operação hoje" icon={UserCog}>
      <CountGrid items={items} />
    </SectionCard>
  );
}
