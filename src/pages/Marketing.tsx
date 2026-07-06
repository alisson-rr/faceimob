import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, TrendingUp, TrendingDown, DollarSign, Users, Target, Facebook, Instagram, Globe, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MarketingInvestmentPopup } from "@/components/MarketingInvestmentPopup";
import { cn } from "@/lib/utils";

type Campaign = {
  id: string;
  name: string;
  channel: "Facebook" | "Instagram" | "Google" | "Outros";
  status: "Ativa" | "Pausada" | "Encerrada";
  developer: string;
  spend: number;
  leads: number;
  startDate: string;
};

const MOCK: Campaign[] = [
  { id: "1", name: "MRV Casas Vasco - Conv Lead", channel: "Facebook", status: "Ativa", developer: "MRV", spend: 4820, leads: 312, startDate: "2026-06-01" },
  { id: "2", name: "Tenda Praia Grande - Reels", channel: "Instagram", status: "Ativa", developer: "Tenda", spend: 3150, leads: 198, startDate: "2026-06-05" },
  { id: "3", name: "Direcional Norte - Search", channel: "Google", status: "Ativa", developer: "Direcional", spend: 2780, leads: 121, startDate: "2026-05-20" },
  { id: "4", name: "MRV Litoral - Carrossel", channel: "Instagram", status: "Pausada", developer: "MRV", spend: 1640, leads: 74, startDate: "2026-05-10" },
  { id: "5", name: "Tenda CDHU - Lead Ads", channel: "Facebook", status: "Ativa", developer: "Tenda", spend: 2210, leads: 167, startDate: "2026-06-08" },
  { id: "6", name: "Genérica Performance Mai", channel: "Google", status: "Encerrada", developer: "Geral", spend: 5400, leads: 289, startDate: "2026-05-01" },
  { id: "7", name: "Faceimob Branding Junho", channel: "Instagram", status: "Ativa", developer: "Geral", spend: 980, leads: 32, startDate: "2026-06-15" },
];

const channelIcon = (c: Campaign["channel"]) =>
  c === "Facebook" ? Facebook : c === "Instagram" ? Instagram : Globe;

const statusColor = {
  "Ativa": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "Pausada": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "Encerrada": "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function Marketing() {
  const { role } = useAuth();
  const canEditAporte = role === "admin" || role === "director";
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [realLeads, setRealLeads] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const { count } = await supabase.from("leads").select("*", { count: "exact", head: true });
      if (typeof count === "number") setRealLeads(count);
    })();
  }, []);

  const filtered = useMemo(() => MOCK.filter(c =>
    (channel === "all" || c.channel === channel) &&
    (status === "all" || c.status === status)
  ), [channel, status]);

  const totals = useMemo(() => {
    const spend = filtered.reduce((s, c) => s + c.spend, 0);
    const leads = filtered.reduce((s, c) => s + c.leads, 0);
    return { spend, leads, cpl: leads > 0 ? spend / leads : 0, active: filtered.filter(c => c.status === "Ativa").length };
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" /> Marketing
          </h1>
          <p className="text-sm text-muted-foreground">
            Performance das campanhas Faceimob • {filtered.length} campanhas • {realLeads} leads no CRM
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href="/admin/meta-ads"><Plug className="h-4 w-4" /> Conectar Meta Ads</a>
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Investimento</p>
              <DollarSign className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold mt-1">{fmtBRL(totals.spend)}</p>
            <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1"><TrendingUp className="h-3 w-3" /> +12% vs mês anterior</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Leads Gerados</p>
              <Users className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-1">{totals.leads.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1"><TrendingUp className="h-3 w-3" /> +8% vs mês anterior</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">CPL Médio</p>
              <Target className="h-4 w-4 text-amber-400" />
            </div>
            <p className="text-2xl font-bold mt-1">{fmtBRL(totals.cpl)}</p>
            <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1"><TrendingDown className="h-3 w-3" /> -3% (melhor)</p>
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
          const Icon = channelIcon(c.channel as Campaign["channel"]);
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
                  <div><p className="text-[10px] text-muted-foreground">CPL</p><p className="text-sm font-bold text-amber-400">{fmtBRL(c.cpl)}</p></div>
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
                <SelectItem value="Facebook">Facebook</SelectItem>
                <SelectItem value="Instagram">Instagram</SelectItem>
                <SelectItem value="Google">Google</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="Ativa">Ativa</SelectItem>
                <SelectItem value="Pausada">Pausada</SelectItem>
                <SelectItem value="Encerrada">Encerrada</SelectItem>
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
                <th className="text-right p-3">CPL</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const Icon = channelIcon(c.channel);
                const cpl = c.leads > 0 ? c.spend / c.leads : 0;
                return (
                  <tr key={c.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3"><div className="flex items-center gap-1.5"><Icon className="h-3 w-3" />{c.channel}</div></td>
                    <td className="p-3">{c.developer}</td>
                    <td className="p-3 text-center"><Badge variant="outline" className={cn("text-[10px]", statusColor[c.status])}>{c.status}</Badge></td>
                    <td className="p-3 text-right font-semibold">{fmtBRL(c.spend)}</td>
                    <td className="p-3 text-right">{c.leads}</td>
                    <td className={cn("p-3 text-right font-bold", cpl < 15 ? "text-emerald-400" : cpl < 25 ? "text-amber-400" : "text-red-400")}>{fmtBRL(cpl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Integration hint */}
      <Card className="glass border-primary/30">
        <CardContent className="p-4 text-xs text-muted-foreground">
          💡 <strong className="text-foreground">Próximo passo:</strong> para puxar dados reais, conectamos a <strong>Meta Marketing API</strong> (Access Token de longo prazo + Ad Account ID) e/ou <strong>Google Ads API</strong>. Quando quiser ativar, me avise que eu peço as credenciais e ligo a integração — o layout desta tela já vai consumir os dados automaticamente.
        </CardContent>
      </Card>
    </div>
  );
}
