import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, DollarSign, Users, Target, Facebook, Globe, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MarketingInvestmentPopup } from "@/components/MarketingInvestmentPopup";
import { cn } from "@/lib/utils";
import CampaignPerformancePanel from "@/components/CampaignPerformancePanel";
import { listAdCampaigns } from "@/integrations/supabase/analytics";

type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  developer: string;
  spend: number;
  leads: number;
  conversions: number;
};

const CHANNEL_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  other: "Outros",
};

const channelIcon = (c: string) => (c === "Meta" ? Facebook : c === "Google" ? Globe : Megaphone);

const statusLabel = (s: string | null) =>
  !s ? "—" : /^active$/i.test(s) ? "Ativa" : /^paused$/i.test(s) ? "Pausada" : s;

const statusColor: Record<string, string> = {
  Ativa: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Pausada: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Campanhas reais de `ad_campaigns` cruzadas com `leads.campaign_id`, que o
 * meta-ads-webhook grava com o mesmo id externo da campanha. Conversão é lead
 * com `converted_deal_id` preenchido — virou negócio no pipeline.
 */
async function loadCampaigns(): Promise<{ rows: CampaignRow[]; totalLeads: number }> {
  const [campaigns, devsRes, statsRes] = await Promise.all([
    listAdCampaigns(),
    supabase.from("developers").select("id,name"),
    supabase.rpc("marketing_campaign_stats"),
  ]);
  if (devsRes.error) throw new Error(`developers: ${devsRes.error.message}`);
  if (statsRes.error) throw new Error(`marketing_campaign_stats: ${statsRes.error.message}`);

  const devName = new Map((devsRes.data ?? []).map((d) => [d.id, d.name]));
  const stats = new Map((statsRes.data ?? []).map((row) => [row.campaign_id, row]));

  const rows = campaigns.map((c) => {
    const campaignStats = stats.get(c.external_id);
    return {
      id: c.id,
      name: c.name,
      channel: CHANNEL_LABELS[c.platform] ?? c.platform,
      status: statusLabel(c.status),
      developer: c.developer_id ? devName.get(c.developer_id) ?? "—" : "—",
      spend: Number(c.total_spend ?? 0),
      leads: campaignStats?.leads ?? 0,
      conversions: campaignStats?.conversions ?? 0,
    };
  });
  return { rows, totalLeads: rows.reduce((total, row) => total + row.leads, 0) };
}

export default function Marketing() {
  const { role } = useAuth();
  const canEditAporte = role === "admin" || role === "marketing";
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["marketing", "campaigns"],
    queryFn: loadCampaigns,
    staleTime: 60_000,
  });
  const campaigns = useMemo(() => data?.rows ?? [], [data]);
  const totalLeads = data?.totalLeads ?? 0;

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
      cpl: leads > 0 ? spend / leads : 0,
      active: filtered.filter(c => c.status === "Ativa").length,
    };
  }, [filtered]);

  const byChannel = useMemo(() => {
    const map = new Map<string, { spend: number; leads: number }>();
    filtered.forEach(c => {
      const cur = map.get(c.channel) || { spend: 0, leads: 0 };
      map.set(c.channel, { spend: cur.spend + c.spend, leads: cur.leads + c.leads });
    });
    return Array.from(map.entries()).map(([k, v]) => ({ channel: k, ...v, cpl: v.leads > 0 ? v.spend / v.leads : 0 }));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <CampaignPerformancePanel />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" /> Marketing
          </h1>
          <p className="text-sm text-muted-foreground">
            Performance das campanhas Faceimob • {filtered.length} campanhas • {totalLeads} leads no CRM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MarketingInvestmentPopup canEdit={canEditAporte} />
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a href="/admin/meta-ads"><Plug className="h-4 w-4" /> Conectar Meta Ads</a>
          </Button>
        </div>
      </div>

      {isError && (
        <Card className="glass border-destructive/40">
          <CardContent className="p-4 text-xs text-destructive">
            Falha ao carregar campanhas: {error instanceof Error ? error.message : "erro desconhecido"}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <p className="text-xs text-muted-foreground">Carregando campanhas…</p>
      )}

      {!isLoading && !isError && campaigns.length === 0 && (
        <Card className="glass">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma campanha sincronizada ainda. Cadastre no painel acima ou conecte o Meta Ads.
          </CardContent>
        </Card>
      )}

      {campaigns.length > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Investimento</p>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-2xl font-bold mt-1">{fmtBRL(totals.spend)}</p>
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Leads Gerados</p>
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <p className="text-2xl font-bold mt-1">{totals.leads.toLocaleString("pt-BR")}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{totals.conversions} convertidos em negócio</p>
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">CPL Médio</p>
                  <Target className="h-4 w-4 text-amber-400" />
                </div>
                <p className="text-2xl font-bold mt-1">{totals.leads > 0 ? fmtBRL(totals.cpl) : "—"}</p>
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Campanhas Ativas</p>
                  <Megaphone className="h-4 w-4 text-purple-400" />
                </div>
                <p className="text-2xl font-bold mt-1">{totals.active}</p>
                <p className="text-[10px] text-muted-foreground mt-1">de {filtered.length} no período</p>
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
                      <div><p className="text-[10px] text-muted-foreground">Gasto</p><p className="text-sm font-bold">{fmtBRL(c.spend)}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Leads</p><p className="text-sm font-bold">{c.leads}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">CPL</p><p className="text-sm font-bold text-amber-400">{c.leads > 0 ? fmtBRL(c.cpl) : "—"}</p></div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Filters + table */}
          <Card className="glass">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Campanhas</CardTitle>
              <div className="flex gap-2">
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos canais</SelectItem>
                    {channelOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos status</SelectItem>
                    {statusOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
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
                    const cpl = c.leads > 0 ? c.spend / c.leads : null;
                    return (
                      <tr key={c.id} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="p-3 font-medium">{c.name}</td>
                        <td className="p-3"><div className="flex items-center gap-1.5"><Icon className="h-3 w-3" />{c.channel}</div></td>
                        <td className="p-3">{c.developer}</td>
                        <td className="p-3 text-center"><Badge variant="outline" className={cn("text-[10px]", statusColor[c.status] || "text-muted-foreground")}>{c.status}</Badge></td>
                        <td className="p-3 text-right font-semibold">{fmtBRL(c.spend)}</td>
                        <td className="p-3 text-right">{c.leads}</td>
                        <td className="p-3 text-right">{c.conversions}</td>
                        <td className={cn("p-3 text-right font-bold", cpl === null ? "text-muted-foreground" : cpl < 15 ? "text-emerald-400" : cpl < 25 ? "text-amber-400" : "text-red-400")}>{cpl === null ? "—" : fmtBRL(cpl)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Integration hint */}
      <Card className="glass border-primary/30">
        <CardContent className="p-4 text-xs text-muted-foreground">
          💡 <strong className="text-foreground">Próximo passo:</strong> para puxar dados reais, conectamos a <strong>Meta Marketing API</strong> (Access Token de longo prazo + Ad Account ID) e/ou <strong>Google Ads API</strong>. Quando quiser ativar, me avise que eu peço as credenciais e ligo a integração — o layout desta tela já vai consumir os dados automaticamente.
        </CardContent>
      </Card>
    </div>
  );
}
