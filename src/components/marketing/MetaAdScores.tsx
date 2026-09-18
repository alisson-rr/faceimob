import { type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, LoadingState, SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brl, date, dateTime, num } from "@/lib/format";
import { functionErrorMessage } from "@/lib/functionError";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * Nota por anúncio (F2.1), na aba "Meta · IA" de /marketing.
 *
 * "Analisar" chama a edge `meta-ad-scores`, que confere `marketing.meta_manage`
 * no servidor e no banco; aqui o botão só nasce desligado sem ela. A tela lê o
 * resultado de `meta_ai_runs`: a última análise boa do período escolhido e,
 * se a mais recente falhou, a falha com a data, acima da boa. Nenhum anúncio
 * some: quem ficou sem nota aparece em "Não analisados", com o motivo.
 */

/** As tabelas entraram na 0115/0116 e ainda não estão no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

/** Raiz do contrato: invalidar esta chave recarrega contas e análises. */
const CHAVE = ["marketing", "meta", "ia", "nota_anuncios"] as const;
const PERIODOS = [7, 14, 30, 60] as const;
type Dias = (typeof PERIODOS)[number];
/** Mesmo prazo da RPC: execução parada há mais de 15 min morreu com a edge, e a tela para de esperar. */
const ESPERA_MAX_MS = 15 * 60_000;

type Canal = "formulario" | "whatsapp" | "landing_page" | "misto" | "outro";
type Balde = "escalar" | "manter" | "cortar" | "nao_analisado";
type Anuncio = {
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  canal: Canal | null;
  spend: number;
  clicks: number;
  ctr: number | null;
  resultados: number;
  custo_por_resultado: number | null;
  nota: number | null;
  balde: Balde;
  motivo: string;
  amostra_pequena: boolean;
  status?: string | null;
};
type Resultado = {
  periodo: { inicio: string; fim: string; dias: number };
  medias: Partial<Record<Canal, { custo_por_resultado: number | null; ctr: number | null }>>;
  anuncios: Anuncio[];
};
type Conta = { id: string; name: string | null; act_id: string };
type Execucao = { id: string; status: "rodando" | "ok" | "falhou"; error: string | null; started_at: string; finished_at: string | null };
type Boa = { id: string; finished_at: string | null; result: Resultado | null };
type Resposta = { ok: boolean; run_id: string; reused?: boolean };

const CANAL: Record<Canal, string> = {
  formulario: "Formulário",
  whatsapp: "WhatsApp",
  landing_page: "Landing page",
  misto: "Misto",
  outro: "Outro",
};

const COLUNAS: { balde: Exclude<Balde, "nao_analisado">; titulo: string; tom: StatusTone }[] = [
  { balde: "escalar", titulo: "Escalar", tom: "success" },
  { balde: "manter", titulo: "Manter", tom: "info" },
  { balde: "cortar", titulo: "Cortar", tom: "danger" },
];

/** `effective_status` do anúncio na Meta; ativo não ganha rótulo. */
const STATUS_ANUNCIO: Record<string, string> = {
  PAUSED: "pausado",
  CAMPAIGN_PAUSED: "campanha pausada",
  ADSET_PAUSED: "conjunto pausado",
  ARCHIVED: "arquivado",
  DELETED: "apagado",
  DISAPPROVED: "reprovado",
  WITH_ISSUES: "com problema",
};

const pct = (f: number | null) =>
  f === null ? "—" : `${(f * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

async function lerContas(): Promise<Conta[]> {
  const { data, error } = await untyped
    .from("meta_ad_accounts")
    .select("id, name, act_id")
    .eq("enabled", true)
    .order("name");
  if (error) throw dbError("listar contas de anúncios", error);
  return (data ?? []) as Conta[];
}

const analisesDaConta = (colunas: string, contaId: string, dias: Dias) =>
  untyped
    .from("meta_ai_runs")
    .select(colunas)
    .eq("kind", "nota_anuncios")
    .eq("account_id", contaId)
    .eq("params->>dias", String(dias));

async function lerAnalises(contaId: string, dias: Dias): Promise<{ ultima: Execucao | null; boa: Boa | null }> {
  const [ultima, boa] = await Promise.all([
    analisesDaConta("id, status, error, started_at, finished_at", contaId, dias)
      .order("started_at", { ascending: false })
      .limit(1),
    analisesDaConta("id, finished_at, result", contaId, dias)
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1),
  ]);
  if (ultima.error) throw dbError("ler a última análise", ultima.error);
  if (boa.error) throw dbError("ler a última análise boa", boa.error);
  return {
    // `colunas` é string de runtime: o parser de tipos do select não a lê.
    ultima: ((ultima.data ?? []) as unknown as Execucao[])[0] ?? null,
    boa: ((boa.data ?? []) as unknown as Boa[])[0] ?? null,
  };
}

const emAndamento = (u: Execucao | null) =>
  u?.status === "rodando" && Date.now() - new Date(u.started_at).getTime() < ESPERA_MAX_MS;

function CartaoAnuncio({ a, tom }: { a: Anuncio; tom: StatusTone }) {
  const situacao =
    a.status && a.status !== "ACTIVE" ? STATUS_ANUNCIO[a.status] ?? a.status.toLowerCase().replace(/_/g, " ") : null;
  return (
    <li className="space-y-1.5 rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium">{a.ad_name ?? a.ad_id}</p>
        {a.nota !== null ? (
          <StatusBadge tone={tom} className="shrink-0">
            nota {a.nota.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10
          </StatusBadge>
        ) : a.amostra_pequena ? (
          <StatusBadge tone="neutral" className="shrink-0">amostra pequena</StatusBadge>
        ) : null}
      </div>
      <p className="break-words text-xs text-muted-foreground">
        {[a.campaign_name ?? "campanha sem nome", a.canal ? CANAL[a.canal] : "canal desconhecido", situacao]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="text-sm">{a.motivo}</p>
      <p className="text-xs text-muted-foreground">
        Gasto {brl(a.spend, { cents: true })} · {num(a.resultados)} {a.resultados === 1 ? "resultado" : "resultados"} ·
        custo por resultado {brl(a.custo_por_resultado, { cents: true })} · CTR {pct(a.ctr)}
      </p>
    </li>
  );
}

function ResultadoDaAnalise({ r, quando }: { r: Resultado; quando: string | null }) {
  const doBalde = (b: Balde) => r.anuncios.filter((a) => a.balde === b);
  const naoAnalisados = doBalde("nao_analisado");
  const medias = Object.entries(r.medias) as [Canal, { custo_por_resultado: number | null; ctr: number | null }][];

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Análise de {dateTime(quando)} · de {date(r.periodo.inicio)} a {date(r.periodo.fim)} ({r.periodo.dias} dias) ·{" "}
          {num(r.anuncios.length)} {r.anuncios.length === 1 ? "anúncio" : "anúncios"} com entrega
        </p>
        {medias.length > 0 && (
          <p>
            Média de cada canal no período:{" "}
            {medias
              .map(([c, m]) => `${CANAL[c]}: ${brl(m.custo_por_resultado, { cents: true })} por resultado, CTR ${pct(m.ctr)}`)
              .join(" · ")}
          </p>
        )}
      </div>

      {r.anuncios.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum anúncio teve entrega neste período.</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {COLUNAS.map((col) => {
              const itens = doBalde(col.balde);
              return (
                <section key={col.balde} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <StatusBadge tone={col.tom}>{col.titulo}</StatusBadge>
                    <span className="text-muted-foreground">{itens.length}</span>
                  </h3>
                  {itens.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum anúncio.</p>
                  ) : (
                    <ul className="space-y-2">
                      {itens.map((a) => <CartaoAnuncio key={a.ad_id} a={a} tom={col.tom} />)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {naoAnalisados.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <StatusBadge tone="neutral">Não analisados</StatusBadge>
                <span className="text-muted-foreground">{naoAnalisados.length}</span>
              </h3>
              <p className="text-xs text-muted-foreground">Ficaram sem nota nesta análise; o motivo está em cada um.</p>
              <ul className="grid gap-2 lg:grid-cols-2">
                {naoAnalisados.map((a) => <CartaoAnuncio key={a.ad_id} a={a} tom="neutral" />)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function MetaAdScores() {
  const { can } = useAuth();
  const podeAnalisar = can("marketing.meta_manage");
  const queryClient = useQueryClient();
  const [dias, setDias] = useState<Dias>(7);
  const [escolhida, setEscolhida] = useState<string | null>(null);

  const contas = useQuery({ queryKey: [...CHAVE, "contas"], queryFn: lerContas });
  const lista = contas.data ?? [];
  // Conta desligada depois de escolhida some da lista: volta para a primeira.
  const conta = lista.find((c) => c.id === escolhida) ?? lista[0] ?? null;

  const analises = useQuery({
    queryKey: [...CHAVE, conta?.id ?? null, dias],
    queryFn: () => (conta ? lerAnalises(conta.id, dias) : Promise.resolve({ ultima: null, boa: null })),
    enabled: conta !== null,
    refetchInterval: (q) => (emAndamento(q.state.data?.ultima ?? null) ? 5000 : false),
  });

  const analisar = useMutation({
    mutationFn: async (corpo: { account_id: string; dias: Dias }) => {
      const { data, error } = await supabase.functions.invoke<Resposta>("meta-ad-scores", { body: corpo });
      if (error) throw new Error(await functionErrorMessage(error, "Não foi possível rodar a análise."));
      if (!data) throw new Error("A análise respondeu sem conteúdo.");
      return data;
    },
    onSuccess: (r) => {
      if (r.reused) {
        toast.info("Análise reaproveitada", {
          description: "Já havia uma análise igual em andamento ou feita há menos de 10 minutos: nenhuma chamada nova de IA.",
        });
        return;
      }
      // A edge só responde depois de gravar o resultado: aqui a análise já terminou.
      toast.success("Análise concluída");
    },
    onError: (e) => toast.error("Não foi possível rodar a análise", { description: e.message }),
    // A falha também fica gravada na execução: a tela relê e a mostra com a data.
    onSettled: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
  });

  const ultima = analises.data?.ultima ?? null;
  const boa = analises.data?.boa ?? null;
  const rodando = emAndamento(ultima);
  const resultado = boa?.result && Array.isArray(boa.result.anuncios) ? boa.result : null;

  let corpo: ReactNode;
  if (contas.isPending) {
    corpo = <LoadingState variant="list" rows={2} label="Carregando contas de anúncios…" />;
  } else if (contas.isError) {
    corpo = (
      <p role="status" className="text-sm text-destructive">
        {describeError(contas.error, "Não consegui ler as contas de anúncios.")}
      </p>
    );
  } else if (!conta) {
    corpo = (
      <EmptyState
        title="Nenhuma conta de anúncios ligada"
        description="Ligue uma conta em Admin → Meta Ads e sincronize; depois a análise fica disponível aqui."
      />
    );
  } else if (analises.isPending) {
    corpo = <LoadingState variant="list" rows={3} label="Carregando a última análise…" />;
  } else if (analises.isError) {
    corpo = (
      <p role="status" className="text-sm text-destructive">
        {describeError(analises.error, "Não consegui ler as análises desta conta.")}
      </p>
    );
  } else {
    corpo = (
      <div className="space-y-4">
        {rodando && ultima && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Análise em andamento desde{" "}
            {dateTime(ultima.started_at)}. A tela atualiza sozinha.
          </p>
        )}
        {ultima?.status === "falhou" && (
          <div role="status" className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-semibold text-destructive">
              A última análise falhou em {dateTime(ultima.finished_at ?? ultima.started_at)}:{" "}
              {ultima.error ?? "sem mensagem"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {resultado
                ? `Abaixo, a última análise boa, de ${dateTime(boa?.finished_at)}.`
                : "Ainda não há análise boa deste período para mostrar."}
            </p>
          </div>
        )}
        {resultado ? (
          <ResultadoDaAnalise r={resultado} quando={boa?.finished_at ?? null} />
        ) : (
          !rodando && ultima?.status !== "falhou" && (
            <EmptyState
              title={`Ainda não há análise de ${dias} dias`}
              description="Clique em Analisar: a IA dá nota aos anúncios de maior gasto e diz se vale escalar, manter ou cortar."
            />
          )
        )}
      </div>
    );
  }

  return (
    <SectionCard
      title="Nota por anúncio"
      icon={Sparkles}
      description="A IA compara cada anúncio com a média do próprio canal e sugere escalar, manter ou cortar."
      actions={
        <>
          {lista.length > 1 && conta && (
            <Select value={conta.id} onValueChange={setEscolhida}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label="Conta de anúncios"><SelectValue /></SelectTrigger>
              <SelectContent>
                {lista.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.act_id}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div role="group" aria-label="Período da análise" className="flex rounded-xl border border-border p-0.5">
            {PERIODOS.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={d === dias ? "secondary" : "ghost"}
                aria-pressed={d === dias}
                className="h-8 px-3"
                onClick={() => setDias(d)}
              >
                {d} dias
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            disabled={!podeAnalisar || !conta || rodando || analisar.isPending}
            onClick={() => conta && analisar.mutate({ account_id: conta.id, dias })}
          >
            {analisar.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Analisando…</> : "Analisar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!podeAnalisar && (
          <p role="status" className="text-xs text-warning">
            Sem a permissão &quot;Gerenciar campanhas na Meta&quot;: dá para ver as análises, não para rodar uma nova.
          </p>
        )}
        {corpo}
      </div>
    </SectionCard>
  );
}
