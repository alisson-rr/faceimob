import { Award, Crown, Medal, Trophy, Users, type LucideIcon } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brl, num } from "@/lib/format";
import { podiumToken, tone } from "@/lib/tone";
import type { RankRow } from "./data";

export interface TopBrokersProps {
  title: string;
  description: string;
  rows: RankRow[];
  /** Lista longa (corretores) ganha rolagem propria em vez de esticar a pagina. */
  scroll?: boolean;
}

const MEDAL: { icon: LucideIcon; label: string }[] = [
  { icon: Crown, label: "1º · Ouro" },
  { icon: Medal, label: "2º · Prata" },
  { icon: Award, label: "3º · Bronze" },
];

/**
 * Pódio de vendas + tabela do restante.
 *
 * Não reusa o `Podium` de `@/components/engagement`: aquele imprime "pts" fixo
 * no número, e aqui o número é VENDA — o dado é outro. Os tokens `gold`,
 * `silver` e `bronze` são os mesmos dos dois (achado T06); quando o `Podium`
 * ganhar uma prop de unidade, esta metade do arquivo some.
 */
export function TopBrokers({ title, description, rows, scroll = false }: TopBrokersProps) {
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);

  if (rows.length === 0) {
    return (
      <SectionCard title={title} description={description} icon={Trophy}>
        <EmptyState
          icon={Users}
          title="Sem venda no período"
          description="Ninguém fechou venda no mês selecionado. Troque o período no filtro do topo."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={title}
      description={description}
      icon={Trophy}
      footer={`${num(rows.length)} com venda no período · empate desfeito pelo VGV`}
    >
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {top.map((row, index) => {
          const token = podiumToken(index) ?? "muted-foreground";
          const { icon: Icon, label } = MEDAL[index];
          return (
            <li
              key={row.id}
              className="ease-premium flex flex-col items-center gap-1 rounded-2xl border p-5 text-center transition-transform duration-200 hover:-translate-y-0.5"
              style={{ borderColor: tone(token, 0.4), background: tone(token, 0.12) }}
            >
              <Icon className="h-5 w-5" style={{ color: tone(token) }} aria-hidden />
              <p className="text-eyebrow" style={{ color: tone(token) }}>
                {label}
              </p>
              <p className="mt-1 max-w-full truncate font-display text-lg font-bold tracking-tight text-foreground">
                {row.name}
              </p>
              <p className="font-display text-4xl font-bold leading-none tabular-nums text-foreground">
                {num(row.vendas)}
              </p>
              <p className="text-xs text-muted-foreground">{row.vendas === 1 ? "venda" : "vendas"}</p>
              <p className="mt-2 text-sm font-semibold tabular-nums text-foreground">{brl(row.vgv)}</p>
              <p className="text-eyebrow">VGV</p>
            </li>
          );
        })}
      </ol>

      {rest.length > 0 && (
        <div className={scroll ? "mt-5 max-h-96 overflow-y-auto rounded-xl border border-border" : "mt-5 rounded-xl border border-border"}>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">VGV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rest.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{index + 4}</TableCell>
                  <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{num(row.vendas)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{brl(row.vgv)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
