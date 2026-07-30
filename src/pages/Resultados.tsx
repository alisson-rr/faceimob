import { useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Loader2, TrendingUp } from "lucide-react";
import { listLegacyDeals } from "@/integrations/supabase/newSchema";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

type Row = { year: number; month: number; sales_count: number; vgv: number };

const currentYear = new Date().getFullYear();
const YEARS = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

export default function Resultados() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { sales: string; vgv: string }>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const deals = await listLegacyDeals();
    const byMonth = new Map<string, Row>();
    deals.filter(deal => deal.outcome === "won" && deal.month_base).forEach(deal => {
      const [month, year] = deal.month_base!.split("/").map(Number);
      if (!month || !year) return;
      const key = `${year}-${month}`;
      const row = byMonth.get(key) || { year, month, sales_count: 0, vgv: 0 };
      row.sales_count += 1;
      row.vgv += Number(deal.vgv_liquido || deal.deal_value || 0);
      byMonth.set(key, row);
    });
    const list = Array.from(byMonth.values()).sort((a, b) => b.year - a.year || a.month - b.month);
    setRows(list);
    const d: Record<string, { sales: string; vgv: string }> = {};
    list.forEach(r => { d[`${r.year}-${r.month}`] = { sales: String(r.sales_count), vgv: String(r.vgv) }; });
    setDrafts(d);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const get = (y: number, m: number) => drafts[`${y}-${m}`] || { sales: "", vgv: "" };

  const totalsByYear = useMemo(() => {
    const map = new Map<number, { sales: number; vgv: number }>();
    rows.forEach(r => {
      const cur = map.get(r.year) || { sales: 0, vgv: 0 };
      map.set(r.year, { sales: cur.sales + r.sales_count, vgv: cur.vgv + Number(r.vgv || 0) });
    });
    return map;
  }, [rows]);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary" /> Resultados Anuais</h1>
        <p className="text-sm text-muted-foreground">VGV e vendas concluídas, calculados automaticamente pelo pipeline</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
      ) : (
        <Accordion type="multiple" defaultValue={[String(currentYear)]} className="space-y-2">
          {YEARS.map(y => {
            const t = totalsByYear.get(y) || { sales: 0, vgv: 0 };
            return (
              <AccordionItem key={y} value={String(y)} className="border border-border/40 rounded-lg glass">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span className="font-bold text-base">{y}</span>
                    <div className="flex gap-4 text-xs">
                      <span><span className="text-muted-foreground">Vendas:</span> <strong>{t.sales}</strong></span>
                      <span><span className="text-muted-foreground">VGV:</span> <strong className="text-emerald-400">{fmt(t.vgv)}</strong></span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="grid gap-2">
                    {MONTHS.map((mName, i) => {
                      const m = i + 1;
                      const d = get(y, m);
                      return (
                        <div key={m} className="grid grid-cols-[100px_1fr_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-muted-foreground">{mName}</span>
                          <Input type="number" placeholder="Vendas" value={d.sales} disabled className="h-8 text-xs" />
                          <Input type="number" placeholder="VGV (R$)" value={d.vgv} disabled className="h-8 text-xs" />
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
