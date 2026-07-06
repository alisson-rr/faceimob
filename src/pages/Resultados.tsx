import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Loader2, TrendingUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

type Row = { year: number; month: number; sales_count: number; vgv: number };

const currentYear = new Date().getFullYear();
const YEARS = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

export default function Resultados() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { sales: string; vgv: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("annual_results").select("*").order("year", { ascending: false }).order("month");
    const list = (data as Row[]) || [];
    setRows(list);
    const d: Record<string, { sales: string; vgv: string }> = {};
    list.forEach(r => { d[`${r.year}-${r.month}`] = { sales: String(r.sales_count), vgv: String(r.vgv) }; });
    setDrafts(d);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const get = (y: number, m: number) => drafts[`${y}-${m}`] || { sales: "", vgv: "" };
  const set = (y: number, m: number, field: "sales" | "vgv", v: string) =>
    setDrafts(p => ({ ...p, [`${y}-${m}`]: { ...get(y, m), [field]: v } }));

  const save = async (y: number, m: number) => {
    const key = `${y}-${m}`;
    const d = get(y, m);
    setSavingKey(key);
    const payload = { year: y, month: m, sales_count: Number(d.sales || 0), vgv: Number(d.vgv || 0) };
    const { error } = await (supabase as any).from("annual_results").upsert(payload, { onConflict: "year,month" });
    setSavingKey(null);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: `Salvo — ${MONTHS[m - 1]}/${y}` });
    load();
  };

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
        <p className="text-sm text-muted-foreground">VGV e vendas mensais organizados por ano</p>
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
                      const key = `${y}-${m}`;
                      return (
                        <div key={m} className="grid grid-cols-[100px_1fr_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-muted-foreground">{mName}</span>
                          <Input type="number" placeholder="Vendas" value={d.sales} onChange={e => set(y, m, "sales", e.target.value)} disabled={!isAdmin} className="h-8 text-xs" />
                          <Input type="number" placeholder="VGV (R$)" value={d.vgv} onChange={e => set(y, m, "vgv", e.target.value)} disabled={!isAdmin} className="h-8 text-xs" />
                          {isAdmin && (
                            <Button size="sm" onClick={() => save(y, m)} disabled={savingKey === key} className="h-8">
                              <Save className="h-3.5 w-3.5 mr-1" />{savingKey === key ? "..." : "Salvar"}
                            </Button>
                          )}
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
