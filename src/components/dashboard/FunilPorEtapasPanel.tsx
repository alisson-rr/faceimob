import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState } from "@/components/shared";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { tone } from "@/lib/tone";
import { cn } from "@/lib/utils";
import {
  carregarFunilPorEtapas, etapasDoFunil, pct, somaDos, type Etapa, type FunilPorEtapas, type ItemDaEtapa,
} from "./funilPorEtapas";

const IMOB = "imob";
const COR: Record<Etapa["chave"], string> = {
  leads: "chart-1", documentos: "chart-5", envios: "chart-2", aprovados: "warning", vendas: "success",
};

/**
 * Funil de vendas fixo no Dashboard (pedido de 21/11/2026, simulação aprovada):
 * as conversões no topo, meta × realizado em degraus e, ao lado, o que entra
 * em cada etapa. Os números vêm prontos do banco (`funil_por_etapas`, 0353).
 */
export function FunilPorEtapasPanel({ month }: { month: string }) {
  const [escolha, setEscolha] = useState<string | null>(null);
  const funil = useQuery({
    queryKey: ["dashboard", "funil-por-etapas", month, escolha],
    queryFn: () => carregarFunilPorEtapas(month, escolha === IMOB ? null : escolha),
  });

  if (funil.isPending) return <LoadingState variant="block" rows={3} label="Carregando o funil…" />;
  if (funil.isError) {
    return <p role="alert" className="text-sm text-destructive">{describeError(funil.error, "Não consegui carregar o funil.")}</p>;
  }
  const dados = funil.data;
  const aberto = escolha ?? dados.diretor ?? IMOB;
  return (
    <section aria-labelledby="funil-por-etapas" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="funil-por-etapas" className="font-display text-xl font-bold">Funil de vendas</h2>
          <p className="text-xs text-muted-foreground">
            Envios do mês sobre leads (10%) · aprovados sobre envios (40%) · vendas sobre aprovados (50%) · documentos sem meta
          </p>
        </div>
        <SeletorDeDiretoria podeVerImob={dados.pode_ver_imob} valor={aberto} opcoes={dados.diretorias} onChange={setEscolha} />
      </div>
      <Conteudo dados={dados} />
    </section>
  );
}

function SeletorDeDiretoria({ podeVerImob, valor, opcoes, onChange }: {
  podeVerImob: boolean; valor: string; opcoes: { id: string; nome: string }[]; onChange: (v: string) => void;
}) {
  if (!podeVerImob && opcoes.length <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger className="w-[240px]" aria-label="Ver o funil de"><SelectValue placeholder="Escolha a diretoria" /></SelectTrigger>
        <SelectContent>
          {podeVerImob && <SelectItem value={IMOB}>Imobiliária inteira</SelectItem>}
          {opcoes.map((d) => <SelectItem key={d.id} value={d.id}>Diretoria {d.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Selo({ etapa }: { etapa: Etapa }) {
  if (etapa.meta == null || etapa.taxa == null) {
    return <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">sem meta</span>;
  }
  const acima = etapa.taxa >= etapa.meta;
  const Icone = acima ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
      acima ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
      <Icone className="h-3 w-3" aria-hidden />{acima ? "acima" : "abaixo"} · meta {pct(etapa.meta).replace(",0", "")}
    </span>
  );
}

function Itens({ itens, cor }: { itens: ItemDaEtapa[]; cor?: string }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex justify-between gap-3" style={cor ? { color: cor } : undefined}>
          <span className={cn(!cor && "text-muted-foreground")}>{i.rotulo}</span>
          <b className={cn("tabular-nums", !cor && "text-foreground")}>{num(i.n)}</b>
        </li>
      ))}
    </ul>
  );
}

function Grupo({ titulo, itens, cor }: { titulo: string; itens: ItemDaEtapa[]; cor: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex justify-between border-b pb-0.5 text-xs font-bold" style={{ color: cor, borderColor: cor }}>
        <span>{titulo}</span><span className="tabular-nums">{num(somaDos(itens))}</span>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2"><Itens itens={itens} cor={cor} /></div>
    </div>
  );
}

function Conteudo({ dados }: { dados: FunilPorEtapas }) {
  const etapas = etapasDoFunil(dados);
  const [, documentos, envios, aprovados, vendas] = etapas;
  const producao = somaDos(dados.documentos.producao);
  const legado = somaDos(dados.documentos.legado);
  const verde = tone("success");
  const amarelo = tone("warning");

  const oQueEntra: Record<Etapa["chave"], ReactNode> = {
    leads: <Itens itens={[{ rotulo: "Recebidos no mês", n: dados.leads }]} />,
    documentos: (
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Grupo titulo="Produção (propostas)" itens={dados.documentos.producao} cor={verde} />
        <Grupo titulo="Legado" itens={dados.documentos.legado} cor={amarelo} />
      </div>
    ),
    envios: <Itens itens={[{ rotulo: "Negócios do mês", n: dados.envios.do_mes }, { rotulo: "Negócios de outros meses", n: dados.envios.outros_meses }]} />,
    aprovados: <Itens itens={dados.aprovados.itens} />,
    vendas: <Itens itens={dados.vendas.itens} />,
  };

  const conversoes: { titulo: string; etapa: Etapa; valor: string; nota: string }[] = [
    { titulo: "Documentos", etapa: documentos, valor: num(documentos.total), nota: "sem meta · vem de um mês para o outro" },
    { titulo: "Lead → envio p/ análise", etapa: envios, valor: pct(envios.taxa), nota: "% frente a leads" },
    { titulo: "Envio → aprovado", etapa: aprovados, valor: pct(aprovados.taxa), nota: "% frente a envios do mês" },
    { titulo: "Aprovado → venda", etapa: vendas, valor: pct(vendas.taxa), nota: "% frente a aprovados" },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {conversoes.map((c) => (
          <div key={c.titulo} className="rounded-2xl border border-t-4 bg-card p-4" style={{ borderTopColor: tone(COR[c.etapa.chave]) }}>
            <p className="text-eyebrow">{c.titulo}</p>
            <p className="mt-1 font-display text-3xl font-bold tabular-nums">{c.valor}</p>
            <div className="mt-2">
              {c.etapa.chave === "documentos" ? (
                <span className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ color: verde, borderColor: verde, background: tone("success", 0.1) }}>Produção ({num(producao)})</span>
                  <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ color: amarelo, borderColor: amarelo, background: tone("warning", 0.1) }}>Legado ({num(legado)})</span>
                </span>
              ) : <Selo etapa={c.etapa} />}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{c.nota}</p>
          </div>
        ))}
      </div>

      <div className="hidden gap-3 text-eyebrow lg:grid lg:grid-cols-[1fr_1fr_minmax(0,1.3fr)]">
        <span className="text-right">Meta</span><span>Realizado</span><span>O que entra</span>
      </div>
      <ol className="flex flex-col gap-2" aria-label="Etapas do funil">
        {etapas.map((e, i) => {
          const largura = `${100 - i * 14}%`;
          const cor = tone(COR[e.chave]);
          const dif = e.esperado == null ? null : e.total - e.esperado;
          return (
            <li key={e.chave} className="grid gap-3 lg:grid-cols-[1fr_1fr_minmax(0,1.3fr)]">
              <div className="hidden justify-end lg:flex">
                <div className="flex flex-col items-end justify-center rounded-l-2xl border border-r-0 border-dashed border-border bg-muted/20 px-4 py-3 text-right" style={{ width: largura }}>
                  <span className="text-eyebrow">Meta · {e.chave === "leads" ? "base" : e.meta == null ? "sem meta" : `${pct(e.meta).replace(",0", "")} dos ${e.base}`}</span>
                  <span className="font-display text-2xl font-bold tabular-nums text-muted-foreground">
                    {e.chave === "leads" ? num(e.total) : e.esperado == null ? "—" : num(e.esperado)}
                  </span>
                </div>
              </div>
              <div className="lg:-ml-3">
                <div className="flex h-full flex-col justify-center rounded-2xl border px-4 py-3 lg:rounded-l-none"
                  style={{ width: largura, minWidth: "14rem", borderColor: tone(COR[e.chave], 0.6), background: `linear-gradient(90deg, ${tone(COR[e.chave], 0.28)}, ${tone(COR[e.chave], 0.06)})` }}>
                  <span className="text-eyebrow" style={{ color: cor }}>{e.nome}</span>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-2xl font-bold tabular-nums">{num(e.total)}</span>
                    <span className="text-lg font-bold tabular-nums">{e.chave === "leads" ? "100%" : e.chave === "documentos" ? "" : pct(e.taxa)}</span>
                  </div>
                  {e.chave === "documentos" ? (
                    <span className="text-xs text-muted-foreground">sem meta · vem de um mês para o outro</span>
                  ) : (
                    <span className="flex justify-between text-xs">
                      <span className="text-muted-foreground">diferença p/ meta</span>
                      <b className={cn("tabular-nums", dif == null ? "text-muted-foreground" : dif >= 0 ? "text-success" : "text-destructive")}>
                        {dif == null ? "—" : `${dif >= 0 ? "+" : ""}${num(dif)}`}
                      </b>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-2xl border border-border bg-card px-4 py-3">{oQueEntra[e.chave]}</div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
