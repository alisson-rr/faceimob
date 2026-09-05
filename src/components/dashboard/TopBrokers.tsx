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

  // O rodape e o estado vazio tinham uma variante para "participante que a RLS
  // de `profiles` nao deixou nomear". Ela nunca acontecia: o nome sai de
  // `deal_participant_names()`, SECURITY DEFINER, que devolve o nome de todo
  // participante de negocio visivel. Codigo que descreve um comportamento que o
  // banco nao tem confunde mais do que ajuda — saiu em 02/09/2026.
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
        // Area rolavel precisa de foco: a tabela do 4º colocado em diante nao
        // tem UM elemento focavel dentro (so texto), entao sem `tabIndex` quem
        // navega por teclado nao consegue rolar ate o fim da lista — e a
        // violacao WCAG 2.1.1 que o axe reporta como
        // `scrollable-region-focusable`. Com foco, ela precisa de nome: dai o
        // `role="region"` com o titulo do bloco.
        <div
          className={
            scroll
              ? "mt-5 max-h-96 overflow-y-auto rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              : "mt-5 rounded-xl border border-border"
          }
          {...(scroll ? { tabIndex: 0, role: "region", "aria-label": title } : {})}
        >
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
