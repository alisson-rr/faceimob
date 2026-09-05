import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Building2, DollarSign, Facebook, Globe, Megaphone, Plug, Target, TrendingUp, Users } from "lucide-react";
import { EmptyState, KpiCard, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MarketingInvestmentPopup } from "@/components/MarketingInvestmentPopup";
import { cn } from "@/lib/utils";
import CampaignPerformancePanel from "@/components/CampaignPerformancePanel";
import {
  AD_PLATFORM_LABEL,
  campaignStats,
  costPerLead,
  cplTone,
  developerSummary,
  listAdCampaigns,
  monthOverMonth,
  previousMonth,
  roas,
  roasLabel,
  type AdPlatform,
  type DeveloperSummaryRow,
} from "@/integrations/supabase/analytics";
import { brl, date, monthStart, num } from "@/lib/format";
import { permissionForPath } from "@/lib/routePermissions";
import { dbError, describeError } from "@/lib/supabaseError";

/** Falha de rede, 500 e timeout não têm `code`: sem uma orientação no fallback,
 *  `describeError` devolve a paráfrase do título e o estado de erro imprime a
 *  mesma frase duas vezes sem dizer o que fazer. */
const TENTE_DE_NOVO = 'A consulta não respondeu. Verifique a conexão e use "Tentar de novo".';

const META_ADS_PATH = "/admin/meta-ads";
/** O mesmo código que o guard de rota cobra — sem isso o botão levava a "Acesso não liberado". */
const META_ADS_PERMISSION = permissionForPath(META_ADS_PATH);

type CampaignRow = {
  id: string;
  externalId: string;
  name: string;
  platform: AdPlatform;
  channel: string;
  status: string;
  rawStatus: string | null;
  developerId: string | null;
  developer: string;
  spend: number;
  dailyBudget: number | null;
  syncedAt: string | null;
  leads: number;
  conversions: number;
  sales: number;
  revenue: number;
};

type DeveloperOption = { id: string; name: string; active: boolean };

const channelIcon = (c: string) => (c === "Meta" ? Facebook : c === "Google" ? Globe : Megaphone);

const statusLabel = (s: string | null) =>
  !s ? "—" : /^active$/i.test(s) ? "Ativa" : /^paused$/i.test(s) ? "Pausada" : s;

const statusColor: Record<string, string> = {
  Ativa: "bg-success/20 text-success border-success/30",
  Pausada: "bg-warning/20 text-warning border-warning/30",
};

const toneClass: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Últimos 12 meses + "todo o período" — o seletor do resumo por construtora. */
const PERIODO_TUDO = "all";
const monthOptions = () => {
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => monthStart(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)));
};
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const monthLabel = (period: string) => `${MESES[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`;

/**
 * Campanhas reais de `ad_campaigns` cruzadas com a RPC `marketing_campaign_stats`
 * (agregada, security definer), que o `meta-ads-webhook` alimenta gravando
 * `campaign_id` no lead com o mesmo id externo da campanha. Conversão é lead com
 * `converted_deal_id` preenchido; receita é o VGV do negócio ganho.
 *
 * É a ÚNICA contagem de lead da tela: o painel do topo recebe estas mesmas
 * linhas. Quando ele somava `leads` no navegador, o RLS recortava o resultado
 * por hierarquia e a mesma campanha aparecia com dois números na mesma dobra.
 *
 * `orphan` é o lead que chegou com `campaign_id` de campanha que ninguém
 * cadastrou: ele existe no CRM, não tem custo nenhum e sumia da tela sem aviso.
 */
async function loadCampaigns(): Promise<{
  rows: CampaignRow[];
  developers: DeveloperOption[];
  orphanLeads: number;
  orphanIds: string[];
}> {
  const [campaigns, devsRes, stats] = await Promise.all([
    listAdCampaigns(),
    supabase.from("developers").select("id,name,active").order("name"),
    campaignStats(),
  ]);
  if (devsRes.error) throw dbError("developers", devsRes.error);

  const developers = (devsRes.data ?? []) as DeveloperOption[];
  const devName = new Map(developers.map((d) => [d.id, d.name]));
  const byCampaign = new Map(stats.map((row) => [row.campaign_id, row]));

  const rows = campaigns.map((c) => {
    const s = byCampaign.get(c.external_id);
    const platform = (c.platform ?? "other") as AdPlatform;
    return {
      id: c.id,
      externalId: c.external_id,
      name: c.name,
      platform,
      channel: AD_PLATFORM_LABEL[platform] ?? c.platform,
      status: statusLabel(c.status),
      rawStatus: c.status,
      developerId: c.developer_id,
      developer: c.developer_id ? devName.get(c.developer_id) ?? "—" : "—",
      spend: Number(c.total_spend ?? 0),
      dailyBudget: c.daily_budget === null || c.daily_budget === undefined ? null : Number(c.daily_budget),
      syncedAt: c.synced_at,
      leads: s?.leads ?? 0,
      conversions: s?.conversions ?? 0,
      sales: s?.sales ?? 0,
      revenue: s?.revenue ?? 0,
    };
  });

  const cadastradas = new Set(campaigns.map((c) => c.external_id));
  const orfas = stats.filter((s) => !cadastradas.has(s.campaign_id));
  return {
    rows,
    developers,
    orphanLeads: orfas.reduce((total, s) => total + s.leads, 0),
    orphanIds: orfas.map((s) => s.campaign_id),
  };
}

export default function Marketing() {
  const { isAdmin, roles, previewRole, can } = useAuth();
  // Espelha `marketing_investments_write` (`has_any_role('admin','marketing')`).
  // `roles` e não `role`: quem é diretor E marketing tem `role = director` e
  // perdia o formulário que o banco aceita. A prévia do cabeçalho entra como
  // em `Resultados`, para "Ver como corretor" mostrar a tela do corretor.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const canEditAporte = isAdmin || effectiveRoles.includes("marketing");
  const canConnectMeta = !META_ADS_PERMISSION || can(META_ADS_PERMISSION);
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [periodo, setPeriodo] = useState<string>(PERIODO_TUDO);
  const [aba, setAba] = useState("campanhas");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["marketing", "campaigns"],
    queryFn: loadCampaigns,
    staleTime: 60_000,
  });
  const campaigns = useMemo(() => data?.rows ?? [], [data]);
  const developers = useMemo(() => data?.developers ?? [], [data]);
  const orphanLeads = data?.orphanLeads ?? 0;
  const orphanIds = data?.orphanIds ?? [];

  // Só busca quando a aba abre: a tela de campanhas não depende deste número, e
  // uma consulta a mais em toda visita paga por informação que ninguém pediu.
  const resumo = useQuery({
    queryKey: ["marketing", "por-construtora", periodo],
    queryFn: () => developerSummary(periodo === PERIODO_TUDO ? null : periodo),
    enabled: aba === "construtoras",
    staleTime: 60_000,
  });

  /**
   * O mesmo resumo, um mês atrás — a única comparação de período que o dado
   * sustenta. Aporte, leads, negócios, vendas e VGV já são recortados por mês
   * pela RPC; CPL e ROAS de campanha não entram porque o gasto é acumulado.
   *
   * A chave é a MESMA da consulta principal (`[..., mês]`): escolher agosto
   * depois de ter comparado setembro reaproveita o que já está em cache, em vez
   * de repetir a chamada.
   */
  const mesAnterior = periodo === PERIODO_TUDO ? null : previousMonth(periodo);
  const anterior = useQuery({
    queryKey: ["marketing", "por-construtora", mesAnterior],
    queryFn: () => developerSummary(mesAnterior),
    enabled: aba === "construtoras" && mesAnterior !== null,
    staleTime: 60_000,
  });

  const channelOptions = useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.channel))).sort(),
    [campaigns],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.status))).sort(),
    [campaigns],
  );

  const filtered = useMemo(() => campaigns.filter(c =>
    (channel === "all" || c.channel === channel) &&
    (status === "all" || c.status === status)
  ), [campaigns, channel, status]);

  const totals = useMemo(() => {
    const spend = filtered.reduce((s, c) => s + c.spend, 0);
    const leads = filtered.reduce((s, c) => s + c.leads, 0);
    const conversions = filtered.reduce((s, c) => s + c.conversions, 0);
    return {
      spend,
      leads,
      conversions,
      cpl: costPerLead(spend, leads),
      active: filtered.filter(c => c.status === "Ativa").length,
    };
  }, [filtered]);

  const byChannel = useMemo(() => {
    const map = new Map<string, { spend: number; leads: number }>();
    filtered.forEach(c => {
      const cur = map.get(c.channel) || { spend: 0, leads: 0 };
      map.set(c.channel, { spend: cur.spend + c.spend, leads: cur.leads + c.leads });
    });
    return Array.from(map.entries()).map(([k, v]) => ({ channel: k, ...v, cpl: costPerLead(v.spend, v.leads) }));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketing"
        eyebrow="Comercial"
        icon={Megaphone}
        // Campanhas e leads saem do MESMO recorte: misturar o filtrado com o
        // total dava "0 campanhas • 24 leads no CRM" com o filtro vazio. E
        // enquanto a consulta corre ou falha, `filtered` é [] — anunciar
        // "0 campanhas • 0 leads" seria afirmar um fato que ninguém apurou.
        description={
          isLoading
            ? "Carregando as campanhas…"
            : isError
              ? "Não foi possível carregar as campanhas."
              : `Performance das campanhas Faceimob • ${num(filtered.length)} campanhas • ${num(totals.leads)} leads atribuídos a elas`
        }
        actions={
          <>
            <MarketingInvestmentPopup canEdit={canEditAporte} />
            {canConnectMeta && (
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to={META_ADS_PATH}><Plug className="h-4 w-4" /> Conectar Meta Ads</Link>
              </Button>
            )}
          </>
        }
      />

      <Tabs value={aba} onValueChange={setAba} className="w-full">
        <TabsList className="bg-transparent border-b border-border/40 rounded-none w-full justify-start gap-4 h-auto p-0">
          {[["campanhas", "Campanhas"], ["construtoras", "Por construtora"]].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2 font-semibold">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="campanhas" className="mt-5 space-y-5">
          {/* O painel carrega, erra e esvazia junto com o resto da tela: uma consulta só.
              Recebe `filtered` para não contradizer a tabela de baixo quando há filtro,
              e a lista INTEIRA de construtoras — a tabela de baixo nomeia a inativa
              (`devName` sobre `developers` sem filtro) e o painel mostrava travessão
              para a mesma campanha, dois valores na mesma dobra. */}
          <CampaignPerformancePanel
            rows={filtered}
            total={campaigns.length}
            developers={developers}
            loading={isLoading}
            error={isError ? describeError(error, TENTE_DE_NOVO) : null}
            onReload={() => void refetch()}
          />

          {orphanLeads > 0 && (
            <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {num(orphanLeads)} {orphanLeads === 1 ? "lead chegou" : "leads chegaram"} com campanha não cadastrada
              ({orphanIds.slice(0, 3).join(", ")}{orphanIds.length > 3 ? "…" : ""}) e {orphanLeads === 1 ? "fica" : "ficam"} fora
              do custo por lead. Cadastre a campanha com esse ID externo para trazer {orphanLeads === 1 ? "esse lead" : "esses leads"} para a conta.
            </p>
          )}

          {isLoading && <LoadingState variant="kpi" rows={4} label="Carregando campanhas…" />}

          {isError && (
            <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Os indicadores e a tabela de campanhas dependem da mesma consulta que falhou — use "Tentar de novo" acima.
            </p>
          )}

          {/* O vazio de "nenhuma campanha" é do painel acima, que já o desenha
              com a orientação do ID externo. Repetir aqui punha duas caixas
              tracejadas iguais, uma embaixo da outra, com descrições diferentes. */}
          {campaigns.length > 0 && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Gasto em campanhas</p>
                      <DollarSign className="h-4 w-4 text-success" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{brl(totals.spend)}</p>
                    {/* Não é a mesma verba do aporte: aporte é o que a construtora
                        põe no mês; isto é o que as campanhas gastaram na vida toda. */}
                    <p className="text-xs text-muted-foreground mt-1">acumulado, não é o aporte do mês</p>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Leads Gerados</p>
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{num(totals.leads)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{num(totals.conversions)} convertidos em negócio</p>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">CPL Médio</p>
                      <Target className="h-4 w-4 text-warning" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{brl(totals.cpl)}</p>
                    {/* Não existe "CPL de setembro": `total_spend` é o gasto da
                        VIDA da campanha, digitado à mão. Comparar mês a mês só
                        passa a ser possível quando o gasto vier da Meta com
                        data — daí a série temporal não é uma tela que falta, é
                        uma credencial que falta. */}
                    <p className="text-xs text-muted-foreground mt-1">gasto acumulado ÷ leads; não há CPL por mês</p>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Campanhas Ativas</p>
                      <Megaphone className="h-4 w-4 text-chart-5" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{num(totals.active)}</p>
                    {/* O painel acima já marca o DINHEIRO como digitado ou
                        sincronizado; o status não tinha marca nenhuma e era
                        lido como o estado real da campanha. Nada no sistema
                        escreve `synced_at` de status: ele é sempre digitado. */}
                    <p className="text-xs text-muted-foreground mt-1">de {num(filtered.length)} no filtro · status digitado; a Meta não é consultada</p>
                  </CardContent>
                </Card>
              </div>

              {/* Channel breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {byChannel.map(c => {
                  const Icon = channelIcon(c.channel);
                  return (
                    <Card key={c.channel} className="glass">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-4 w-4 text-primary" />
                          <span className="font-semibold">{c.channel}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div><p className="text-xs text-muted-foreground">Gasto</p><p className="text-sm font-bold">{brl(c.spend)}</p></div>
                          <div><p className="text-xs text-muted-foreground">Leads</p><p className="text-sm font-bold">{num(c.leads)}</p></div>
                          <div><p className="text-xs text-muted-foreground">CPL</p><p className="text-sm font-bold text-warning">{brl(c.cpl)}</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Filters + table */}
              <Card className="glass">
                {/* Título e filtros em COLUNA no celular, como o cabeçalho de
                    "por construtora" logo abaixo. Em linha, os dois seletores
                    (144 px + 128 px) mais o título não cabiam nos 343 px úteis
                    de uma tela de 375 e empurravam a PÁGINA INTEIRA 16 px para
                    a direita — a rolagem horizontal aparecia no app todo, não
                    só neste card. */}
                <CardHeader className="py-3 px-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-sm">Campanhas</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Select value={channel} onValueChange={setChannel}>
                      <SelectTrigger className="w-36 h-8 text-xs" aria-label="Filtrar por canal"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos canais</SelectItem>
                        {channelOptions.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="w-32 h-8 text-xs" aria-label="Filtrar por status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos status</SelectItem>
                        {statusOptions.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr>
                          <th className="text-left p-3">Campanha</th>
                          <th className="text-left p-3">Canal</th>
                          <th className="text-left p-3">Construtora</th>
                          <th className="text-center p-3">Status</th>
                          <th className="text-right p-3">Investimento</th>
                          <th className="text-right p-3">Leads</th>
                          <th className="text-right p-3">Conversões</th>
                          <th className="text-right p-3">CPL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(c => {
                          const Icon = channelIcon(c.channel);
                          const cpl = costPerLead(c.spend, c.leads);
                          return (
                            <tr key={c.id} className="border-t border-border/30 hover:bg-muted/20">
                              <td className="p-3 font-medium">{c.name}</td>
                              <td className="p-3"><div className="flex items-center gap-1.5"><Icon className="h-3 w-3" />{c.channel}</div></td>
                              <td className="p-3">{c.developer}</td>
                              <td className="p-3 text-center">
                                <Badge variant="outline" className={statusColor[c.status] || "text-muted-foreground"}>{c.status}</Badge>
                                {/* Mesma marca do painel para o gasto: sem ela a
                                    etiqueta passava por estado real da campanha. */}
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {c.syncedAt ? `sincronizado ${date(c.syncedAt)}` : "digitado"}
                                </span>
                              </td>
                              <td className="p-3 text-right font-semibold">{brl(c.spend)}</td>
                              <td className="p-3 text-right">{num(c.leads)}</td>
                              <td className="p-3 text-right">{num(c.conversions)}</td>
                              {/* A cor compara com a MÉDIA do recorte visível: a escala
                                  fixa (verde < 15) deixava 100% das linhas vermelhas. */}
                              <td className={cn("p-3 text-right font-bold", toneClass[cplTone(cpl, totals.cpl)])}>{brl(cpl)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Fora da <tbody> de propósito: o vazio é da tela, não uma linha de dado. */}
                  {filtered.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      Nenhuma campanha neste filtro. Volte para "Todos canais" e "Todos status" para ver as {num(campaigns.length)} cadastradas.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="construtoras" className="mt-5">
          <DeveloperSummaryPanel
            periodo={periodo}
            onPeriodo={setPeriodo}
            rows={resumo.data ?? []}
            loading={resumo.isPending}
            error={resumo.isError ? describeError(resumo.error, TENTE_DE_NOVO) : null}
            onReload={() => void resumo.refetch()}
            comparacao={
              mesAnterior
                ? {
                    label: monthLabel(mesAnterior),
                    rows: anterior.data ?? null,
                    carregando: anterior.isPending,
                    erro: anterior.isError,
                  }
                : null
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ResumoTotal = { investment: number; campaign_spend: number; leads: number; deals: number; sales: number; vgv: number };

/** Soma do recorte inteiro — a mesma conta serve ao rodapé e ao mês anterior. */
const somarResumo = (rows: DeveloperSummaryRow[]): ResumoTotal =>
  rows.reduce(
    (acc, r) => ({
      investment: acc.investment + r.investment,
      campaign_spend: acc.campaign_spend + r.campaign_spend,
      leads: acc.leads + r.leads,
      deals: acc.deals + r.deals,
      sales: acc.sales + r.sales,
      vgv: acc.vgv + r.vgv,
    }),
    { investment: 0, campaign_spend: 0, leads: 0, deals: 0, sales: 0, vgv: 0 },
  );

/**
 * Aporte, gasto de campanha, leads, negócios e VGV lado a lado, por construtora.
 *
 * Os quatro números já existiam no banco com a mesma chave e moravam em três
 * telas diferentes — o dono não conseguia responder "quanto investi na
 * Horizonte e quanto ela me devolveu". O agrupamento é por `developers.id` e
 * não pelo nome: renomear a construtora criava duas linhas.
 *
 * A RPC é agregada e `security definer` justamente porque `deals` é recortado
 * por RLS: sem ela, o corretor veria "por construtora" só dos negócios dele,
 * com o mesmo título que o diretor vê para a empresa inteira.
 *
 * Aporte é MENSAL; `ad_campaigns.total_spend` é ACUMULADO. Por isso os dois
 * ficam em colunas separadas, nunca somados, e o ROAS só aparece em "todo o
 * período", onde custo e retorno cobrem a mesma janela.
 */
function DeveloperSummaryPanel({
  periodo,
  onPeriodo,
  rows,
  loading,
  error,
  onReload,
  comparacao,
}: {
  periodo: string;
  onPeriodo: (value: string) => void;
  rows: DeveloperSummaryRow[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** O mesmo resumo um mês atrás. `null` em "Todo o período": não há anterior. */
  comparacao: { label: string; rows: DeveloperSummaryRow[] | null; carregando: boolean; erro: boolean } | null;
}) {
  const tudo = periodo === PERIODO_TUDO;
  const total = useMemo(() => somarResumo(rows), [rows]);
  const totalAnterior = useMemo(
    () => (comparacao?.rows ? somarResumo(comparacao.rows) : null),
    [comparacao?.rows],
  );

  return (
    <Card className="glass">
      <CardHeader className="py-3 px-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" /> Investimento e retorno por construtora
        </CardTitle>
        <Select value={periodo} onValueChange={onPeriodo}>
          <SelectTrigger className="w-44 h-8 text-xs" aria-label="Período do resumo"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PERIODO_TUDO}>Todo o período</SelectItem>
            {monthOptions().map((m) => (
              <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      {/* Comparação de período — a metade que o dado sustenta.
          Aporte, leads, vendas e VGV são recortados por mês pela mesma RPC, dos
          dois lados. CPL e ROAS de campanha ficam de fora de propósito: o
          denominador dos dois é `total_spend`, gasto acumulado e sem data, e
          comparar dois números desses seria fabricar uma série temporal. */}
      {comparacao && !loading && !error && rows.length > 0 && (
        <div role="group" aria-label="Comparação com o mês anterior" className="border-t border-border/60 px-4 py-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Comparado com <strong className="text-foreground">{comparacao.label}</strong>
            {comparacao.carregando && " — carregando…"}
            {comparacao.erro && " — não consegui ler o mês anterior; a variação fica de fora."}
          </p>
          {/* Uma coluna a 375 px, como todo KpiCard do repositório: em duas, o
              cartão sobra ~109 px úteis e "R$ 1.250.000" é um token
              inquebrável (o pt-BR usa NBSP depois do "R$") que o
              `overflow-hidden` do KpiCard CORTA em vez de quebrar. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              { label: "Aporte do mês", icon: DollarSign, atual: total.investment, antes: totalAnterior?.investment, fmt: brl },
              { label: "Leads", icon: Users, atual: total.leads, antes: totalAnterior?.leads, fmt: num },
              { label: "Vendas", icon: Target, atual: total.sales, antes: totalAnterior?.sales, fmt: num },
              { label: "VGV", icon: TrendingUp, atual: total.vgv, antes: totalAnterior?.vgv, fmt: brl },
            ] as const).map(({ label, icon, atual, antes, fmt }) => (
              <KpiCard
                key={label}
                label={label}
                value={fmt(atual)}
                icon={icon}
                // Sem o mês anterior em mãos não há variação: o cartão mostra o
                // número do mês e cala sobre a comparação, em vez de exibir 0%.
                delta={antes === undefined ? undefined : monthOverMonth(atual, antes) ?? undefined}
                hint={antes === undefined ? undefined : `${comparacao.label}: ${fmt(antes)}`}
              />
            ))}
          </div>
        </div>
      )}

      <CardContent className="p-0">
        {loading ? (
          <div className="p-4"><LoadingState variant="table" rows={3} label="Carregando o resumo por construtora…" /></div>
        ) : error ? (
          <div className="p-4">
            <EmptyState
              icon={AlertTriangle}
              tone="danger"
              title="Não consegui carregar o resumo"
              description={error}
              action={<Button variant="outline" onClick={onReload}>Tentar de novo</Button>}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Building2} title="Nenhuma construtora cadastrada" description="Cadastre a construtora em Administração › Construtoras." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Construtora</th>
                  <th className="text-right p-3">{tudo ? "Aporte (todos os meses)" : "Aporte do mês"}</th>
                  <th className="text-right p-3">Gasto em campanhas</th>
                  <th className="text-right p-3">Leads</th>
                  <th className="text-right p-3">Negócios</th>
                  <th className="text-right p-3">Vendas</th>
                  <th className="text-right p-3">VGV</th>
                  <th className="text-right p-3">ROAS</th>
                  {/* Só com um mês escolhido: aporte e VGV compartilham a janela
                      mensal, então esta é a única divisão honesta do mês. Em
                      "todo o período" a coluna sairia e o ROAS de campanha, que
                      é acumulado dos dois lados, é quem responde. */}
                  {!tudo && <th className="text-right p-3">Retorno sobre aporte</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const retorno = tudo ? roas(r.vgv, r.campaign_spend) : null;
                  const sobreAporte = tudo ? null : roas(r.vgv, r.investment);
                  return (
                    <tr key={r.developer_id ?? "sem-construtora"} className="border-t border-border/30 hover:bg-muted/20">
                      <td className="p-3 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {r.developer_name}
                          {r.developer_id && !r.active && <StatusBadge tone="neutral">inativa</StatusBadge>}
                          {!r.developer_id && <StatusBadge tone="warning">sem vínculo</StatusBadge>}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums text-success font-semibold">{brl(r.investment)}</td>
                      <td className="p-3 text-right tabular-nums">{brl(r.campaign_spend)}</td>
                      <td className="p-3 text-right tabular-nums">{num(r.leads)}</td>
                      <td className="p-3 text-right tabular-nums">{num(r.deals)}</td>
                      <td className="p-3 text-right tabular-nums">{num(r.sales)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{brl(r.vgv)}</td>
                      <td className="p-3 text-right tabular-nums font-bold">{roasLabel(retorno)}</td>
                      {!tudo && <td className="p-3 text-right tabular-nums font-bold">{roasLabel(sobreAporte)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20 font-semibold">
                  <td className="p-3">Total</td>
                  <td className="p-3 text-right tabular-nums">{brl(total.investment)}</td>
                  <td className="p-3 text-right tabular-nums">{brl(total.campaign_spend)}</td>
                  <td className="p-3 text-right tabular-nums">{num(total.leads)}</td>
                  <td className="p-3 text-right tabular-nums">{num(total.deals)}</td>
                  <td className="p-3 text-right tabular-nums">{num(total.sales)}</td>
                  <td className="p-3 text-right tabular-nums">{brl(total.vgv)}</td>
                  <td className="p-3 text-right tabular-nums">{roasLabel(tudo ? roas(total.vgv, total.campaign_spend) : null)}</td>
                  {!tudo && <td className="p-3 text-right tabular-nums">{roasLabel(roas(total.vgv, total.investment))}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
      <div className="border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p>
          <strong className="text-foreground">Aporte</strong> é o que a construtora põe por mês (marketing_investments);{" "}
          <strong className="text-foreground">gasto em campanhas</strong> é o total lançado em cada campanha desde que ela existe.
          São verbas diferentes: somar as duas contaria dobrado.
        </p>
        <p>
          {tudo
            ? "ROAS = VGV dos negócios ganhos ÷ gasto em campanhas, na mesma janela (todo o período)."
            : "Com um mês escolhido, aporte, leads, negócios e VGV são do mês; o gasto em campanhas continua acumulado, então o ROAS do mês não existe. Retorno sobre aporte = VGV do mês ÷ aporte do mês — as duas pontas na mesma janela. A comparação com o mês anterior cobre só esses números mensais: não há CPL nem ROAS de campanha por mês enquanto o gasto for digitado e acumulado."}
        </p>
      </div>
    </Card>
  );
}
