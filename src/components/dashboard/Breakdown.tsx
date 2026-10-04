import { Layers, UserCog } from "lucide-react";
import { KpiGrid, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { tone } from "@/lib/tone";
import type { DashboardPayload } from "@/integrations/supabase/newSchema";
import type { EsteiraDoMes } from "./esteiraDoMes";

type CountItem = { label: string; value: number; token: string };

/** Grade de contagem: rotulo escrito em cima, numero grande embaixo. */
function CountGrid({ items }: { items: CountItem[] }) {
  return (
    <KpiGrid as="ul" cols="contagem">
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
    </KpiGrid>
  );
}

const ESTEIRA: { chave: keyof EsteiraDoMes; rotulo: string; token: string }[] = [
  { chave: "docs", rotulo: "Docs enviadas", token: "chart-1" },
  { chave: "aprovados", rotulo: "Aprovados", token: "success" },
  { chave: "pendentes", rotulo: "Pendentes", token: "warning" },
  { chave: "reprovados", rotulo: "Reprovados", token: "destructive" },
  { chave: "virouNegocio", rotulo: "Virou negócio", token: "chart-5" },
  { chave: "convertidos", rotulo: "Convertidos em venda", token: "chart-2" },
];

/**
 * Esteira de crédito pelo Status 2 (04/10/2026): seis contagens fixas, na
 * ordem do caminho do processo. `toda` = quem lê a esteira inteira; os demais
 * veem o recorte dos próprios negócios.
 */
export function CcaStatusCard({ esteira, toda }: { esteira: EsteiraDoMes; toda: boolean }) {
  return (
    <SectionCard
      title="Esteira de crédito"
      description={toda ? "Processos do CCA no mês vigente" : "Processos do CCA nos seus negócios no mês vigente"}
      icon={Layers}
    >
      <CountGrid items={ESTEIRA.map((e) => ({ label: e.rotulo, value: esteira[e.chave], token: e.token }))} />
    </SectionCard>
  );
}

export function StaffCard({ staff }: { staff: DashboardPayload["staff"] }) {
  const items: CountItem[] = [
    { label: "Corretores", value: staff.brokersTotal, token: "chart-1" },
    { label: "Gerentes", value: staff.managers, token: "chart-5" },
    { label: "Diretores", value: staff.directors, token: "chart-3" },
    { label: "Staff (admin, sócios e CCA)", value: staff.staff, token: "chart-4" },
    { label: "Total ativo", value: staff.active, token: "chart-2" },
  ];

  return (
    <SectionCard title="Time" description="Composição da operação hoje" icon={UserCog}>
      <CountGrid items={items} />
    </SectionCard>
  );
}
