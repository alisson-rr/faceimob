import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Megaphone, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { campaignPerformance, upsertAdCampaign, type CampaignPerformance } from "@/integrations/supabase/analytics";

const brl = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Investimento × resultado por campanha.
 *
 * O cruzamento existe porque o `meta-ads-webhook` grava `campaign_id` no lead
 * com o mesmo id externo da campanha. Sem cadastrar a campanha e seu gasto, o
 * lead fica rastreado mas sem custo — dá para contar, não para avaliar.
 */
export default function CampaignPerformancePanel() {
  const { toast } = useToast();
  const { isAdmin, can } = useAuth();
  const [rows, setRows] = useState<CampaignPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const [spend, setSpend] = useState("");

  const canEdit = isAdmin || can("reports.view_finance");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await campaignPerformance());
    } catch (e) {
      toast({
        title: "Falha ao carregar campanhas",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!externalId.trim() || !name.trim()) {
      return toast({ title: "Informe o id externo e o nome da campanha", variant: "destructive" });
    }
    setSaving(true);
    try {
      await upsertAdCampaign({
        externalId: externalId.trim(),
        platform: "meta",
        name: name.trim(),
        totalSpend: Number(spend || 0),
      });
      setExternalId(""); setName(""); setSpend("");
      await load();
      toast({ title: "Campanha registrada" });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" /> Investimento × resultado por campanha
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {canEdit && (
          <div className="flex flex-col md:flex-row gap-2">
            <Input
              placeholder="ID da campanha na Meta"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              className="h-8 text-xs"
              aria-label="ID externo da campanha"
            />
            <Input
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
              aria-label="Nome da campanha"
            />
            <Input
              type="number"
              placeholder="Investido (R$)"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
              className="h-8 text-xs md:w-40"
              aria-label="Total investido"
            />
            <Button size="sm" onClick={add} disabled={saving} className="h-8 text-xs gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Salvar
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            Nenhuma campanha cadastrada. O ID precisa ser o mesmo que a Meta envia no webhook.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="p-2 text-left font-medium">Campanha</th>
                  <th className="p-2 text-right font-medium">Investido</th>
                  <th className="p-2 text-right font-medium">Leads</th>
                  <th className="p-2 text-right font-medium">Vendas</th>
                  <th className="p-2 text-right font-medium">Custo/lead</th>
                  <th className="p-2 text-right font-medium">Custo/venda</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.campaignId} className="border-b border-border/10">
                    <td className="p-2 font-medium">{r.campaignName}</td>
                    <td className="p-2 text-right tabular-nums">{brl(r.totalSpend)}</td>
                    <td className="p-2 text-right tabular-nums">{r.leads}</td>
                    <td className="p-2 text-right tabular-nums">{r.sales}</td>
                    <td className="p-2 text-right tabular-nums">{brl(r.costPerLead)}</td>
                    <td className="p-2 text-right tabular-nums">{brl(r.costPerSale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
