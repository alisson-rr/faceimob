import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Filter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, StatusBadge } from "@/components/shared";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import {
  PASSAGENS, carregarFunil, comparar, diasDesde, pct, taxa, type ContagemDoFunil, type Leitura, type NegocioParado,
} from "./funilDeVendas";

const IMOB = "imob";

const CAMADAS: { chave: keyof ContagemDoFunil; rotulo: string }[] = [
  { chave: "leads", rotulo: "Leads" },
  { chave: "docs", rotulo: "Docs enviadas" },
  { chave: "aprovadas", rotulo: "Docs aprovadas" },
  { chave: "vendas", rotulo: "Vendas" },
];

function Seta({ leitura }: { leitura: Leitura }) {
  if (leitura === "sem-base") return null;
  const Icone = leitura === "acima" ? ArrowUpRight : ArrowDownRight;
  return <Icone className={cn("h-3.5 w-3.5", leitura === "acima" ? "text-success" : "text-destructive")} aria-hidden />;
}

/**
 * Funil de Vendas do mês (pedido de 04/10/2026): 4 camadas, a taxa de cada
 * passagem contra o ideal e contra a imobiliária, recorte por diretoria e os
 * aprovados parados há mais de 3 dias. Os números vêm prontos do banco
 * (`funil_de_vendas`, 0214), sem o teto de 1.000 linhas da lista de leads.
 */
export function FunilDeVendasPanel({ month }: { month: string }) {
  // Nada escolhido: o banco abre a imobiliária para o admin e a própria
  // diretoria para diretor e gerente (0214), e diz qual abriu.
  const [escolha, setEscolha] = useState<string | null>(null);
  const funil = useQuery({
    queryKey: ["dashboard", "funil", month, escolha],
    queryFn: () => carregarFunil(month, escolha === IMOB ? null : escolha),
  });

  if (funil.isPending) return <LoadingState variant="block" rows={3} label="Carregando o funil…" />;
  if (funil.isError) {
    return <p role="alert" className="text-sm text-destructive">{describeError(funil.error, "Não consegui carregar o funil.")}</p>;
  }
  const dados = funil.data;
  const aberto = escolha ?? dados.diretor ?? IMOB;

  return (
    <div className="flex flex-col gap-5">
      <SeletorDeDiretoria podeVerImob={dados.pode_ver_imob} valor={aberto} opcoes={dados.diretorias} onChange={setEscolha} />
      <Conteudo dados={dados.recorte ?? dados.imob} imob={dados.imob} ehImob={!dados.recorte} parados={dados.parados} />
    </div>
  );
}

function SeletorDeDiretoria({ podeVerImob, valor, opcoes, onChange }: {
  podeVerImob: boolean; valor: string; opcoes: { id: string; nome: string }[]; onChange: (v: string) => void;
}) {
  // Uma diretoria só e sem a imobiliária: não há o que escolher.
  if (!podeVerImob && opcoes.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger className="w-[260px]" aria-label="Ver o funil de">
          <SelectValue placeholder="Escolha a diretoria" />
        </SelectTrigger>
        <SelectContent>
          {podeVerImob && <SelectItem value={IMOB}>Imobiliária inteira</SelectItem>}
          {opcoes.map((d) => <SelectItem key={d.id} value={d.id}>Diretoria {d.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Conteudo({ dados, imob, ehImob, parados }: {
  dados: ContagemDoFunil; imob: ContagemDoFunil; ehImob: boolean;
  parados: NegocioParado[];
}) {
  const agora = new Date();
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold">Funil do mês</h2>
          <ol className="mt-4 flex flex-col items-center gap-2" aria-label="Camadas do funil">
            {CAMADAS.map((c, i) => {
              // Formato fixo de funil, como o painel de referência: o volume
              // está no número, a largura só desenha a afunilada.
              const largura = [100, 82, 64, 48][i] ?? 48;
              return (
                <li
                  key={c.chave}
                  className="flex flex-col items-center justify-center rounded-2xl bg-primary/15 px-4 py-3 text-center"
                  style={{ width: `${largura}%` }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.rotulo}</span>
                  <span className="font-display text-2xl font-bold tabular-nums">{num(dados[c.chave])}</span>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="grid gap-3">
          {PASSAGENS.map((p) => {
            const valor = taxa(dados, p.de, p.para);
            const daImob = taxa(imob, p.de, p.para);
            const vsIdeal = comparar(valor, p.ideal);
            const vsImob = comparar(valor, daImob);
            return (
              <Card key={p.rotulo} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.rotulo}</p>
                  <p className="font-display text-2xl font-bold tabular-nums">{pct(valor)}</p>
                  <p className="text-xs text-muted-foreground">Ideal {pct(p.ideal)}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 text-xs">
                  <StatusBadge tone={vsIdeal === "acima" ? "success" : vsIdeal === "abaixo" ? "danger" : "neutral"}>
                    <Seta leitura={vsIdeal} />
                    {vsIdeal === "sem-base" ? "Sem base no mês" : vsIdeal === "acima" ? "Acima do ideal" : "Abaixo do ideal"}
                  </StatusBadge>
                  {!ehImob && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Seta leitura={vsImob} />
                      {vsImob === "sem-base" ? "Imobiliária" : vsImob === "acima" ? "Acima da imobiliária" : "Abaixo da imobiliária"}{" "}
                      ({pct(daImob)})
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
          <h2 className="font-display text-lg font-semibold">Aprovados parados há mais de 3 dias</h2>
          <StatusBadge tone={parados.length > 0 ? "warning" : "success"}>{num(parados.length)}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Em Aprov. Total, Aprov. Cond. ou Virou Negócio sem mudar de status. Cada dia parado é venda esfriando.
        </p>
        {parados.length === 0 ? (
          <p className="mt-4 text-sm text-success">Nenhum aprovado parado. Bom ritmo!</p>
        ) : (
          <ul className="mt-4 max-h-[50vh] divide-y divide-border overflow-y-auto text-sm">
            {parados.map((p) => {
              const dias = diasDesde(p.desde, agora);
              return (
                <li key={p.deal_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{p.cliente ?? "Sem cliente"}</span>
                    {p.code && <span className="text-muted-foreground"> · {p.code}</span>}
                    <span className="block text-xs text-muted-foreground">
                      {[p.status, p.corretor].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <StatusBadge tone={dias >= 7 ? "danger" : "warning"}>{dias} dias</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
