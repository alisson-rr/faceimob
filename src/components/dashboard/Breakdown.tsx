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
 * `loadDashboardPayload`; aqui so entra a cor semantica de cada situacao.
 */
const CCA_TOKEN: Record<string, string> = {
  "Aprovado Total": "success",
  "Aprovado Condicionado": "chart-2",
  "Análise de Viabilidade": "chart-4",
  "Análise Externa": "chart-4",
  "Enviado à Agência": "chart-1",
  "Assinatura no Banco": "chart-1",
  "Pendente de Viabilidade": "warning",
  Pendente: "warning",
  Reprovado: "destructive",
};

export function CcaStatusCard({ counts }: { counts: Record<string, number> }) {
  const items = Object.entries(counts).map(([label, value], index) => ({
    label,
    value,
    token: CCA_TOKEN[label] ?? seriesToken(index),
  }));

  return (
    <SectionCard title="Esteira de crédito" description="Processos do CCA por situação" icon={Layers}>
      {items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nenhum processo no CCA"
          description="Assim que um negócio entrar na esteira de crédito, a situação dele aparece aqui."
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
