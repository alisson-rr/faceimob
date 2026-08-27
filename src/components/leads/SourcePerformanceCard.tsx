import { BarChart3 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, SectionCard, StatusBadge } from "@/components/shared";
import { num } from "@/lib/format";
import { sourcePerformance, type LeadRecord } from "@/integrations/supabase/leads";

/** Acima disso a origem se paga; abaixo, vira conversa com o marketing. */
const GOOD_RATE = 20;

/**
 * "Quais campanhas convertem mais" (ata 23/07).
 *
 * O tempo médio usa `converted_at`, então mede até a conversão — o cálculo
 * antigo media até hoje e crescia sozinho todo dia.
 */
export function SourcePerformanceCard({ leads }: { leads: LeadRecord[] }) {
  const rows = sourcePerformance(leads);

  return (
    <SectionCard
      title="Desempenho por origem"
      description="Conversão e tempo médio até fechar, por campanha"
      icon={BarChart3}
      flush={rows.length > 0}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Sem leads para medir"
          description="A conversão por origem aparece assim que existir lead com origem cadastrada."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Convertidos</TableHead>
              <TableHead className="text-right">Conversão</TableHead>
              <TableHead className="text-right">Dias até converter</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.source}>
                <TableCell className="font-medium">{row.source}</TableCell>
                <TableCell className="text-right tabular-nums">{num(row.totalLeads)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(row.converted)}</TableCell>
                <TableCell className="text-right">
                  <StatusBadge tone={row.conversionRate > GOOD_RATE ? "success" : "warning"}>
                    <span className="tabular-nums">{row.conversionRate}%</span>
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.avgDaysToConvert || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
