import { Trophy, Users } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brl, num } from "@/lib/format";
import { PodiumCards } from "@/components/engagement/PodiumCards";
import type { RankRow } from "./data";

export interface TopBrokersProps {
  title: string;
  description: string;
  rows: RankRow[];
  /** Foto por perfil, para o pódio. */
  avatars?: ReadonlyMap<string, string | null>;
  /** Lista longa (corretores) ganha rolagem propria em vez de esticar a pagina. */
  scroll?: boolean;
}

/**
 * Pódio de vendas + tabela do restante.
 *
 * Os três primeiros usam o `PodiumCards` do Game — degradê do preto para o
 * metal, medalha e foto (pedido de 28/09/2026) —, com "N vendas" no lugar dos
 * pontos e o VGV na linha de apoio. Só quem vendeu sobe ao pódio: um zerado de
 * ouro, num mês de uma venda só, diria o contrário da tabela.
 *
 * `rows` pode trazer zerados (`withZeroSellers`): eles vão para a tabela, em
 * ordem alfabética depois de quem vendeu. `avatars` é a foto por perfil.
 */
export function TopBrokers({ title, description, rows, avatars, scroll = false }: TopBrokersProps) {
  const top = rows.filter((row) => row.vendas > 0).slice(0, 3);
  const rest = rows.slice(top.length);
  const comVenda = rows.filter((row) => row.vendas > 0).length;

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
      // O rodapé afirmava "empate desfeito pelo VGV" e parava aí — mas dois
      // corretores do MESMO negócio rateado empatam também no VGV (1 venda e
      // `deal_value / 2` cada) e ficavam na ordem de chegada dos negócios, que
      // muda a cada cadastro novo. `rankBy` agora fecha no nome.
      footer={`${num(comVenda)} com venda no período · empate desfeito pelo VGV e, nele, pelo nome`}
    >
      <PodiumCards
        entries={top.map((row) => ({
          id: row.id,
          name: row.name,
          points: row.vendas,
          avatarUrl: avatars?.get(row.id) ?? null,
          value: `${num(row.vendas)} ${row.vendas === 1 ? "venda" : "vendas"}`,
          detail: `VGV ${brl(row.vgv)}`,
        }))}
      />

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
                  <TableCell className="tabular-nums text-muted-foreground">{index + top.length + 1}</TableCell>
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
