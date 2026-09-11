import { type ReactNode, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bot, ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, LoadingState, SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brl, date, dateTime, num } from "@/lib/format";
import { functionErrorMessage } from "@/lib/functionError";
import { dbError, describeError } from "@/lib/supabaseError";
import { invocarAcaoMeta } from "./acaoMeta";

/**
 * Gestor de tráfego IA (F2.2), na aba "Meta · IA" de /marketing.
 *
 * Em cima, a última análise boa da conta (nota 0-100, até 3 alertas, até 3
 * ações) e, se a mais recente falhou, a falha com a data. "Rodar agora" chama
 * a edge `meta-traffic-manager`. Embaixo, a fila de aprovação: as propostas
 * da IA, que só vão para a Meta quando uma pessoa aprova — pela MESMA edge da
 * ação manual (`meta-campaign-action`, {action_id, decisao}), com a mesma
 * permissão e o mesmo aviso de fase de aprendizado (409). As travas da tela
 * repetem as do banco: sem `marketing.meta_manage`, dá para ver, não decidir.
 */

/** As tabelas entraram na 0115/0116 e ainda não estão no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

const CHAVE = ["marketing", "meta", "ia", "gestor"] as const;
const CHAVE_FILA = ["marketing", "meta", "fila"] as const;
/** Mesmo prazo da RPC: execução parada há mais de 15 min morreu com a edge, e a tela para de esperar. */
const ESPERA_MAX_MS = 15 * 60_000;

type Acao = "pausar" | "ativar" | "verba";
type Conta = { id: string; name: string | null; act_id: string };
type Execucao = {
  id: string;
  status: "rodando" | "ok" | "falhou";
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
type Sugerida = {
  action_id: string;
  acao: Acao;
  campaign_external_id: string;
  campaign_name: string | null;
  verba_nova?: number | null;
  motivo: string;
};
type Resultado = {
  nota: number;
  resumo: string;
  alertas: { severidade: string; texto: string }[];
  acoes: Sugerida[];
  periodo?: { inicio: string; fim: string };
  dados_ate?: string | null;
  descartadas?: number;
};
type Boa = { id: string; trigger: "cron" | "manual"; finished_at: string | null; result: Resultado | null };
type Proposta = {
  id: string;
  campaign_name: string | null;
  campaign_external_id: string;
  acao: Acao;
  verba_anterior: number | null;
  verba_nova: number | null;
  variacao: number | null;
  motivo: string | null;
  expires_at: string;
};
type Run = { status: "rodando" | "ok" | "falhou"; reused: boolean; propostas: number; descartadas: number; erro?: string };
type Decisao = { action_id: string; decisao: "aprovar" | "recusar"; confirma_aprendizado?: true };
type Aviso = { variacao: number | null; verba_atual: number | null; verba_nova: number | null };
type RespostaDecisao =
  | { tipo: "feito"; status: string; erro: string | null }
  | { tipo: "aprendizado"; aviso: Aviso }
  | { tipo: "falha"; mensagem: string };

const reais = (v: number | null | undefined) => brl(v, { cents: true });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });

const SEVERIDADE: Record<string, { tom: StatusTone; texto: string }> = {
  alta: { tom: "danger", texto: "alta" },
  media: { tom: "warning", texto: "média" },
  baixa: { tom: "info", texto: "baixa" },
};

function faixaDaNota(n: number): { tom: StatusTone; texto: string } {
  if (n >= 75) return { tom: "success", texto: "saudável" };
  if (n >= 50) return { tom: "warning", texto: "pede atenção" };
  return { tom: "danger", texto: "crítica" };
}

function descreverAcao(acao: Acao, verbaNova?: number | null, verbaAnterior?: number | null, variacao?: number | null) {
  if (acao === "pausar") return "Pausar a campanha";
  if (acao === "ativar") return "Ativar a campanha";
  const de = verbaAnterior != null ? ` de ${reais(verbaAnterior)}` : "";
  const quanto = variacao != null ? ` (${pct.format(variacao)})` : "";
  return `Mudar a verba diária${de} para ${reais(verbaNova)}${quanto}`;
}

async function lerContas(): Promise<Conta[]> {
  const { data, error } = await untyped
    .from("meta_ad_accounts")
    .select("id, name, act_id")
    .eq("enabled", true)
    .order("name");
  if (error) throw dbError("listar contas de anúncios", error);
  return (data ?? []) as Conta[];
}

async function lerExecucoes(contaId: string): Promise<{ ultima: Execucao | null; boa: Boa | null }> {
  const [ultima, boa] = await Promise.all([
    untyped.from("meta_ai_runs")
      .select("id, status, error, started_at, finished_at")
      .eq("kind", "gestor")
      .eq("account_id", contaId)
      .order("started_at", { ascending: false })
      .limit(1),
    untyped.from("meta_ai_runs")
      .select("id, trigger, finished_at, result")
      .eq("kind", "gestor")
      .eq("account_id", contaId)
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(1),
  ]);
  if (ultima.error) throw dbError("ler a última análise do gestor", ultima.error);
  if (boa.error) throw dbError("ler a última análise boa do gestor", boa.error);
  return {
    ultima: ((ultima.data ?? []) as Execucao[])[0] ?? null,
    boa: ((boa.data ?? []) as Boa[])[0] ?? null,
  };
}

/** Propostas ainda válidas; a vencida sai da fila (decidir devolveria "expirada"). */
async function lerFila(): Promise<Proposta[]> {
  const { data, error } = await untyped
    .from("meta_actions")
    .select("id, campaign_name, campaign_external_id, acao, verba_anterior, verba_nova, variacao, motivo, expires_at")
    .eq("status", "proposta")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw dbError("ler a fila de aprovação", error);
  return (data ?? []) as Proposta[];
}

const emAndamento = (u: Execucao | null) =>
  u?.status === "rodando" && Date.now() - new Date(u.started_at).getTime() < ESPERA_MAX_MS;

/** Aprovar ou recusar pelo executor único. O 409 'aprendizado' volta como aviso, não como falha. */
const decidir = (pedido: Decisao): Promise<RespostaDecisao> =>
  invocarAcaoMeta(pedido, "A decisão respondeu sem dizer o que aconteceu: confira o histórico de ações.");

function ResultadoDoGestor({ boa, r, naFila }: { boa: Boa; r: Resultado; naFila: Set<string> | null }) {
  const faixa = faixaDaNota(r.nota);
  const foraDaFila = naFila ? r.acoes.filter((a) => !naFila.has(a.action_id)).length : 0;
  const descartadas = r.descartadas ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="shrink-0 space-y-1 rounded-2xl border border-border bg-background/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">Nota da conta</p>
          <p className="flex items-baseline gap-1">
            <span className="text-4xl font-semibold tabular-nums">{r.nota}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </p>
          <StatusBadge tone={faixa.tom}>{faixa.texto}</StatusBadge>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm">{r.resumo}</p>
          <p className="text-xs text-muted-foreground">
            Análise de {dateTime(boa.finished_at)} · {boa.trigger === "cron" ? "automática, das 07:00" : "rodada sob demanda"}
            {r.periodo ? ` · números da Meta de ${date(r.periodo.inicio)} a ${date(r.periodo.fim)}` : ""}
            {r.dados_ate ? `, da sincronização de ${dateTime(r.dados_ate)}` : ""}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Alertas</h3>
        {r.alertas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum alerta nesta análise.</p>
        ) : (
          <ul className="space-y-2">
            {r.alertas.map((a, i) => {
              const s = SEVERIDADE[a.severidade] ?? SEVERIDADE.baixa;
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <StatusBadge tone={s.tom} className="shrink-0">{s.texto}</StatusBadge>
                  <span className="min-w-0 break-words">{a.texto}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Ações sugeridas</h3>
        {r.acoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ação sugerida nesta análise.</p>
        ) : (
          <ul className="space-y-2">
            {r.acoes.map((a) => (
              <li key={a.action_id} className="space-y-1 rounded-xl border border-border bg-background/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium">{a.campaign_name ?? a.campaign_external_id}</p>
                  {naFila && (
                    naFila.has(a.action_id)
                      ? <StatusBadge tone="info">na fila de aprovação</StatusBadge>
                      : <StatusBadge tone="neutral">fora da fila</StatusBadge>
                  )}
                </div>
                <p className="text-sm">{descreverAcao(a.acao, a.verba_nova)}</p>
                <p className="break-words text-xs text-muted-foreground">Motivo: {a.motivo}</p>
              </li>
            ))}
          </ul>
        )}
        {foraDaFila > 0 && (
          <p className="text-xs text-muted-foreground">
            Fora da fila = já decidida ou vencida (cada proposta vale 24 h): veja o histórico de ações.
          </p>
        )}
        {descartadas > 0 && (
          <p className="text-xs text-muted-foreground">
            {num(descartadas)} {descartadas === 1 ? "sugestão da IA ficou" : "sugestões da IA ficaram"} de fora por não
            passar nas travas: campanha fora da conta, ação desconhecida ou que não muda nada, verba fora de metade a
            dobro da atual, ou verba total.
          </p>
        )}
      </section>
    </div>
  );
}

export function MetaTrafficManager() {
  const { can } = useAuth();
  const pode = can("marketing.meta_manage");
  const queryClient = useQueryClient();
  const origem = useRef<HTMLElement | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [aprovar, setAprovar] = useState<Proposta | null>(null);
  const [aprendizado, setAprendizado] = useState<{ pedido: Decisao; aviso: Aviso } | null>(null);

  const contas = useQuery({ queryKey: [...CHAVE, "contas"], queryFn: lerContas });
  const lista = contas.data ?? [];
  // Conta desligada depois de escolhida some da lista: volta para a primeira.
  const conta = lista.find((c) => c.id === escolhida) ?? lista[0] ?? null;

  const analises = useQuery({
    queryKey: [...CHAVE, conta?.id ?? null],
    queryFn: () => (conta ? lerExecucoes(conta.id) : Promise.resolve({ ultima: null, boa: null })),
    enabled: conta !== null,
    refetchInterval: (q) => (emAndamento(q.state.data?.ultima ?? null) ? 5000 : false),
  });
  const fila = useQuery({ queryKey: CHAVE_FILA, queryFn: lerFila });

  const rodar = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; runs?: Run[] }>("meta-traffic-manager", {
        body: { account_id: accountId },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Não foi possível rodar o gestor."));
      const run = data?.runs?.[0];
      if (!run) throw new Error("O gestor respondeu sem a execução.");
      return run;
    },
    onSuccess: (run) => {
      if (run.status === "falhou") {
        toast.error("O gestor falhou", { description: run.erro ?? "Falha sem mensagem." });
      } else if (run.reused) {
        toast.info("Análise reaproveitada", {
          description: "Já havia uma análise do gestor em andamento ou feita há menos de 10 minutos: nenhuma chamada nova de IA.",
        });
      } else {
        toast.success("Gestor rodou", {
          description: run.propostas === 0
            ? "Nenhuma ação nova na fila de aprovação."
            : `${run.propostas} ${run.propostas === 1 ? "ação nova" : "ações novas"} na fila de aprovação.`,
        });
      }
    },
    onError: (e) => toast.error("O gestor falhou", { description: e.message }),
    // A falha também fica gravada na execução: a tela relê e a mostra com a data.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CHAVE }),
        queryClient.invalidateQueries({ queryKey: CHAVE_FILA }),
      ]),
  });

  const decisao = useMutation({
    mutationFn: decidir,
    onSuccess: async (r, pedido) => {
      setAprovar(null);
      setAprendizado(r.tipo === "aprendizado" ? { pedido, aviso: r.aviso } : null);
      // Em qualquer desfecho a fila, o histórico e a campanha podem ter mudado.
      const recarregar = queryClient.invalidateQueries({ queryKey: ["marketing"] });
      if (r.tipo === "aprendizado") return;
      await recarregar;
      if (r.tipo === "falha") {
        toast.error("A decisão não foi concluída", { description: r.mensagem });
      } else if (r.status === "recusada") {
        toast.success("Proposta recusada", { description: "Saiu da fila; nada foi feito na Meta." });
      } else if (r.status === "parcial") {
        toast.warning("Aprovada, mas a verba mudou só em parte", {
          description: r.erro ?? "Veja conjunto por conjunto no histórico de ações.",
        });
      } else {
        toast.success("Aprovada e feita na Meta", { description: "Fica registrado no histórico de ações, com o seu nome." });
      }
    },
    onError: (e) => {
      setAprovar(null);
      setAprendizado(null);
      toast.error("A decisão não foi concluída", { description: e.message });
    },
  });

  // Sem Trigger do Radix, o foco volta à mão para o botão que abriu o diálogo.
  const devolverFoco = (e: Event) => {
    e.preventDefault();
    origem.current?.focus();
  };

  const ultima = analises.data?.ultima ?? null;
  const boa = analises.data?.boa ?? null;
  const rodando = emAndamento(ultima);
  const resultado = boa?.result && typeof boa.result.nota === "number" && Array.isArray(boa.result.acoes) ? boa.result : null;
  const naFila = fila.data ? new Set(fila.data.map((p) => p.id)) : null;
  const pendente = decisao.isPending;
  const aviso = aprendizado?.aviso;

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
        description="Ligue uma conta em Admin → Meta Ads e sincronize; depois o gestor fica disponível aqui."
      />
    );
  } else if (analises.isPending) {
    corpo = <LoadingState variant="list" rows={3} label="Carregando a última análise do gestor…" />;
  } else if (analises.isError) {
    corpo = (
      <p role="status" className="text-sm text-destructive">
        {describeError(analises.error, "Não consegui ler as análises do gestor.")}
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
              A última análise falhou em {dateTime(ultima.finished_at ?? ultima.started_at)}: {ultima.error ?? "sem mensagem"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {resultado
                ? `Abaixo, a última análise boa, de ${dateTime(boa?.finished_at)}.`
                : "Ainda não há análise boa do gestor para mostrar."}
            </p>
          </div>
        )}
        {resultado && boa ? (
          <ResultadoDoGestor boa={boa} r={resultado} naFila={naFila} />
        ) : (
          !rodando && ultima?.status !== "falhou" && (
            <EmptyState
              title="O gestor ainda não rodou nesta conta"
              description="Ele roda sozinho todo dia às 07:00, depois da sincronização; ou clique em Rodar agora."
            />
          )
        )}
      </div>
    );
  }

  let filaCorpo: ReactNode;
  if (fila.isPending) {
    filaCorpo = <LoadingState variant="list" rows={2} label="Carregando a fila de aprovação…" />;
  } else if (fila.isError) {
    filaCorpo = (
      <p role="status" className="text-sm text-destructive">
        {describeError(fila.error, "Não consegui ler a fila de aprovação.")}
      </p>
    );
  } else if (fila.data.length === 0) {
    filaCorpo = <p className="text-sm text-muted-foreground">Nenhuma proposta esperando decisão.</p>;
  } else {
    filaCorpo = (
      <ul className="divide-y divide-border">
        {fila.data.map((p) => {
          const nome = p.campaign_name ?? p.campaign_external_id;
          const oQue = descreverAcao(p.acao, p.verba_nova, p.verba_anterior, p.variacao);
          return (
            <li key={p.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="break-words text-sm font-medium">{nome}</p>
                <p className="text-sm">{oQue}</p>
                {p.motivo && <p className="break-words text-xs text-muted-foreground">Motivo do gestor IA: {p.motivo}</p>}
                <p className="text-xs text-muted-foreground">Vale até {dateTime(p.expires_at)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={!pode || pendente}
                  aria-label={`Aprovar: ${oQue} em ${nome}`}
                  onClick={(e) => {
                    origem.current = e.currentTarget;
                    setAprovar(p);
                  }}
                >
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!pode || pendente}
                  aria-label={`Recusar: ${oQue} em ${nome}`}
                  onClick={() => decisao.mutate({ action_id: p.id, decisao: "recusar" })}
                >
                  Recusar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Gestor de tráfego IA"
        icon={Bot}
        description="Nota da conta de 0 a 100, até 3 alertas e até 3 ações sugeridas. Roda sozinho todo dia às 07:00; nada vai para a Meta sem aprovação."
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
            <Button
              size="sm"
              disabled={!pode || !conta || rodando || rodar.isPending}
              onClick={() => conta && rodar.mutate(conta.id)}
            >
              {rodar.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Rodando…</> : "Rodar agora"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!pode && (
            <p role="status" className="text-xs text-warning">
              Sem a permissão &quot;Gerenciar campanhas na Meta&quot;: dá para ver a análise e a fila, não para rodar o
              gestor nem decidir.
            </p>
          )}
          {corpo}
        </div>
      </SectionCard>

      <SectionCard
        title="Fila de aprovação"
        icon={ListChecks}
        description="Ações sugeridas pelo gestor IA. Cada uma vale 24 h; aprovar executa na Meta pelo mesmo caminho da ação manual."
      >
        {filaCorpo}
      </SectionCard>

      <AlertDialog open={aprovar !== null} onOpenChange={(abrir) => { if (!abrir && !pendente) setAprovar(null); }}>
        <AlertDialogContent onCloseAutoFocus={devolverFoco}>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar e executar na Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              {aprovar
                ? `${descreverAcao(aprovar.acao, aprovar.verba_nova, aprovar.verba_anterior, aprovar.variacao)} em "${aprovar.campaign_name ?? aprovar.campaign_external_id}". `
                : ""}
              A ação vai para a Meta assim que você confirmar e fica registrada com o seu nome no histórico de ações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente}
              onClick={(e) => {
                e.preventDefault();
                if (aprovar) decisao.mutate({ action_id: aprovar.id, decisao: "aprovar" });
              }}
            >
              {pendente ? "Enviando à Meta…" : "Aprovar e executar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={aprendizado !== null} onOpenChange={(abrir) => { if (!abrir && !pendente) setAprendizado(null); }}>
        <AlertDialogContent onCloseAutoFocus={devolverFoco}>
          <AlertDialogHeader>
            <AlertDialogTitle>A campanha volta para a fase de aprendizado</AlertDialogTitle>
            <AlertDialogDescription>
              A verba diária sobe {aviso?.variacao != null ? pct.format(aviso.variacao) : "muito"}
              {aviso?.verba_atual != null && aviso.verba_nova != null
                ? `: de ${reais(aviso.verba_atual)} para ${reais(aviso.verba_nova)} por dia`
                : ""}
              . Uma subida desse tamanho faz a Meta reiniciar a fase de aprendizado, e o custo por resultado costuma
              subir por alguns dias.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendente}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendente}
              onClick={(e) => {
                e.preventDefault();
                if (aprendizado) decisao.mutate({ ...aprendizado.pedido, confirma_aprendizado: true });
              }}
            >
              {pendente ? "Enviando à Meta…" : "Aprovar mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
