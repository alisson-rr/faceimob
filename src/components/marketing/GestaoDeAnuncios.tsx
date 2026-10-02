import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ClipboardList, MessageCircle, RefreshCw, Search, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { EmptyState, KpiCard, KpiGrid, LoadingState } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  PERIODOS_META, PERIODO_META_LABEL, fetchMetaMetricas, listAdCampaigns, periodoMeta, sincronizarMeta,
  type PeriodoMeta,
} from "@/integrations/supabase/analytics";
import { brl, num } from "@/lib/format";
import { dbError, describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { MetaCampaignActions } from "./MetaCampaignActions";
import {
  ROTULO_DO_RESULTADO, linhasDoPainel, resumoDoPainel, type CampanhaDaConta, type LinhaDoPainel,
} from "./gestaoDeAnuncios";

/** Sem limite cadastrado na conta (Marketing → Alertas), o mesmo da DG. */
const CPL_LIMITE_PADRAO = 12;

const reais = (v: number | null | undefined) => brl(v, { cents: true });
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const COR_DA_LINHA: Record<LinhaDoPainel["alerta"], string> = {
  ok: "border-l-success",
  cpl_alto: "border-l-warning bg-warning/10",
  sem_lead: "border-l-destructive bg-destructive/10",
};

const COR_DO_CUSTO: Record<LinhaDoPainel["alerta"], string> = {
  ok: "text-primary",
  cpl_alto: "text-warning",
  sem_lead: "text-destructive",
};

type Conta = { id: string; prepay_available: number | null; cpl_limite: number | null; last_sync_ok_at: string | null };

async function carregar(periodo: PeriodoMeta) {
  const { from, to } = periodoMeta(periodo);
  const [campanhas, metricas, contas] = await Promise.all([
    listAdCampaigns(),
    fetchMetaMetricas(from, to),
    supabase.from("meta_ad_accounts").select("id,prepay_available,cpl_limite,last_sync_ok_at").eq("enabled", true),
  ]);
  if (contas.error) throw dbError("meta_ad_accounts", contas.error);
  const lista = (contas.data ?? []) as Conta[];
  const limites = lista.map((c) => c.cpl_limite).filter((v): v is number => v !== null).map(Number);
  const cplLimite = limites.length ? Math.min(...limites) : CPL_LIMITE_PADRAO;
  const daConta: CampanhaDaConta[] = campanhas.map((c) => ({
    id: c.id,
    externalId: c.external_id,
    name: c.name,
    status: c.status,
    dailyBudget: c.daily_budget == null ? null : Number(c.daily_budget),
    metaAccountId: c.meta_account_id,
    metaChannel: c.meta_channel ?? null,
    metaBudgetLevel: c.meta_budget_level ?? null,
  }));
  const saldos = lista.map((c) => c.prepay_available).filter((v): v is number => v !== null);
  return {
    linhas: linhasDoPainel(daConta, metricas, cplLimite),
    cplLimite,
    limitePadrao: limites.length === 0,
    saldo: saldos.length ? saldos.reduce((t, v) => t + Number(v), 0) : null,
    sincronizadoEm: lista.map((c) => c.last_sync_ok_at).filter(Boolean).sort().at(-1) ?? null,
  };
}

/**
 * Gestão de anúncios (pedido de 02/10/2026, no modelo da tela da DG): liga e
 * desliga campanha e muda a verba na Meta (o executor `meta-campaign-action`,
 * com confirmação e registro de quem fez), com as cores da casa — amarelo para
 * custo por resultado acima do limite, vermelho para quem gastou sem lead.
 */
export function GestaoDeAnuncios({ podeConectar }: { podeConectar: boolean }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [periodo, setPeriodo] = useState<PeriodoMeta>("mes_atual");
  const [busca, setBusca] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const podeGerir = can("marketing.meta_manage");

  const consulta = useQuery({
    queryKey: ["marketing", "gestao-anuncios", periodo],
    queryFn: () => carregar(periodo),
    staleTime: 60_000,
  });

  const todas = useMemo(() => consulta.data?.linhas ?? [], [consulta.data]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas.filter((l) => (mostrarInativas || l.ativa) && (!termo || l.name.toLowerCase().includes(termo)));
  }, [todas, busca, mostrarInativas]);
  const resumo = useMemo(() => resumoDoPainel(todas), [todas]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await sincronizarMeta();
      const falhas = r.contas.filter((c) => c.status === "falhou");
      if (falhas.length) toast.error("A Meta não respondeu", { description: falhas[0].erro ?? "Tente de novo em instantes." });
      else toast.success("Campanhas atualizadas com a Meta");
      await queryClient.invalidateQueries({ queryKey: ["marketing"] });
    } catch (err) {
      toast.error("Não foi possível sincronizar", { description: describeError(err, "Tente de novo em instantes.") });
    } finally {
      setSincronizando(false);
    }
  };

  if (consulta.isPending) return <LoadingState variant="kpi" rows={4} label="Carregando a gestão de anúncios…" />;
  if (consulta.isError) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Não consegui carregar as campanhas da Meta"
        description={describeError(consulta.error, "Tente de novo em instantes.")}
        action={<Button variant="outline" onClick={() => void consulta.refetch()}>Tentar de novo</Button>}
      />
    );
  }

  const { cplLimite, limitePadrao, saldo, sincronizadoEm } = consulta.data;
  const diasDeSaldo = saldo !== null && resumo.verbaDiaria > 0 ? Math.floor(saldo / resumo.verbaDiaria) : null;

  return (
    <section aria-labelledby="gestao-anuncios-titulo" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="gestao-anuncios-titulo" className="text-xl font-bold">Gestão de anúncios</h2>
          <p className="text-xs text-muted-foreground">
            {sincronizadoEm
              ? `Números da Meta até ${new Date(sincronizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
              : "Ainda sem sincronização com a Meta"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoMeta)}>
            <SelectTrigger className="h-9 w-48 text-xs" aria-label="Período"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODOS_META.map((p) => <SelectItem key={p} value={p}>{PERIODO_META_LABEL[p]}</SelectItem>)}
            </SelectContent>
          </Select>
          {podeGerir && (
            <Button variant="outline" size="sm" disabled={sincronizando} onClick={() => void sincronizar()}>
              <RefreshCw className={cn("h-4 w-4", sincronizando && "animate-spin")} /> Atualizar
            </Button>
          )}
        </div>
      </div>

      {todas.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nenhuma campanha sincronizada da Meta"
          description="Conecte a conta de anúncios com o token da Marketing API (ads_read e ads_management) e clique em Atualizar."
          action={podeConectar ? <Button asChild variant="outline"><Link to="/admin/meta-ads">Conectar Meta Ads</Link></Button> : undefined}
        />
      ) : (
        <>
          {saldo !== null && (
            <div className="flex items-center gap-4 rounded-2xl border border-success/40 bg-success/5 p-4">
              <Wallet className="h-8 w-8 text-success" aria-hidden />
              <div>
                <p className="text-eyebrow">Saldo da conta Meta Ads</p>
                <p className="text-2xl font-bold tabular-nums">{reais(saldo)}</p>
                {diasDeSaldo !== null && (
                  <p className="text-xs text-muted-foreground">
                    ~{num(diasDeSaldo)} dia(s) de campanha com a verba diária atual ({reais(resumo.verbaDiaria)}/dia)
                  </p>
                )}
              </div>
            </div>
          )}

          <KpiGrid cols={4}>
            <KpiCard label="Ativas" value={num(resumo.ativas)} icon={TrendingUp} hint={`Verba/dia ${reais(resumo.verbaDiaria)}`} />
            <KpiCard label="Cadastros (form)" value={num(resumo.cadastros)} icon={ClipboardList} hint={`CPL ${reais(resumo.custoPorCadastro)}`} />
            <KpiCard label="Conversas (WhatsApp)" value={num(resumo.conversas)} icon={MessageCircle} hint={`Custo/conversa ${reais(resumo.custoPorConversa)}`} />
            <KpiCard
              label="Investimento no período"
              value={reais(resumo.investido)}
              icon={BarChart3}
              hint={`${num(resumo.comCplAlto)} com CPL > ${reais(cplLimite)} · ${num(resumo.semLead)} sem lead`}
            />
          </KpiGrid>

          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  className="h-9 pl-8 text-sm" placeholder="Buscar campanha…" aria-label="Buscar campanha"
                  value={busca} onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden />
                CPL &gt; {reais(cplLimite)}{limitePadrao ? " (padrão)" : ""}
              </span>
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden /> Sem lead
              </span>
              <div className="flex items-center gap-2">
                <Switch id="gestao-inativas" checked={mostrarInativas} onCheckedChange={setMostrarInativas} />
                <Label htmlFor="gestao-inativas" className="text-xs">Mostrar inativas</Label>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs tabular-nums">
                {num(visiveis.length)} de {num(todas.length)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-y-1.5 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 font-semibold">Campanha</th>
                    <th className="px-3 text-right font-semibold">Budget/dia</th>
                    <th className="px-3 text-right font-semibold">Investido</th>
                    <th className="px-3 text-right font-semibold">Resultados</th>
                    <th className="px-3 text-right font-semibold">CPL / custo</th>
                    <th className="px-3 text-right font-semibold">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => (
                    <tr key={l.id} className={cn("[&>td]:border-y [&>td]:border-border [&>td]:py-2", !l.ativa && "opacity-60")}>
                      <td className={cn("rounded-l-xl border-l-4 px-3", COR_DA_LINHA[l.alerta])}>
                        <div className="flex items-center gap-3">
                          {podeGerir ? (
                            <MetaCampaignActions compacto campaign={l} onDone={() => void consulta.refetch()} />
                          ) : (
                            <span
                              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", l.ativa ? "bg-success" : "bg-muted-foreground")}
                              aria-label={l.ativa ? "Ativa" : "Pausada"}
                            />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{l.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {ROTULO_DO_RESULTADO[l.canal]}
                              {l.alerta === "sem_lead" && <span className="text-destructive"> · sem lead</span>}
                              {l.alerta === "cpl_alto" && <span className="text-warning"> · CPL alto</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 text-right tabular-nums">{reais(l.dailyBudget)}</td>
                      <td className="px-3 text-right tabular-nums">{reais(l.investido)}</td>
                      <td className="px-3 text-right font-semibold tabular-nums">{num(l.resultados)}</td>
                      <td className={cn("px-3 text-right font-bold tabular-nums", COR_DO_CUSTO[l.alerta])}>
                        {l.custoPorResultado === null ? "—" : reais(l.custoPorResultado)}
                      </td>
                      <td className="rounded-r-xl border-r px-3 text-right tabular-nums text-muted-foreground">{pct(l.ctr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visiveis.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma campanha com esse filtro.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
