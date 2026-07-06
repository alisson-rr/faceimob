import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Investment = { id: string; invested_at: string; amount: number; developer: string | null; note: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function MarketingInvestmentPopup({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Investment[]>([]);
  const [devs, setDevs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthTotal, setMonthTotal] = useState(0);
  const [form, setForm] = useState({ invested_at: new Date().toISOString().slice(0, 10), amount: "", developer: "", note: "" });
  const [saving, setSaving] = useState(false);

  const loadTotal = async () => {
    const first = new Date();
    first.setDate(1);
    const from = first.toISOString().slice(0, 10);
    const { data } = await (supabase as any).from("marketing_investments").select("amount").gte("invested_at", from);
    const t = (data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    setMonthTotal(t);
  };

  const load = async () => {
    setLoading(true);
    const first = new Date();
    first.setDate(1);
    const from = first.toISOString().slice(0, 10);
    const [{ data }, devsRes] = await Promise.all([
      (supabase as any).from("marketing_investments").select("*").gte("invested_at", from).order("invested_at", { ascending: false }),
      (supabase as any).from("cca_developers").select("name").order("name"),
    ]);
    setRows((data as Investment[]) || []);
    setDevs(((devsRes.data as any[]) || []).map(d => d.name));
    setLoading(false);
  };

  useEffect(() => { loadTotal(); }, []);
  useEffect(() => { if (open) load(); }, [open]);

  const save = async () => {
    if (!form.amount || !form.invested_at) return toast({ title: "Preencha data e valor", variant: "destructive" });
    setSaving(true);
    const { error } = await (supabase as any).from("marketing_investments").insert({
      invested_at: form.invested_at,
      amount: Number(form.amount),
      developer: form.developer || null,
      note: form.note || null,
    });
    setSaving(false);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Aporte salvo" });
    setForm({ invested_at: new Date().toISOString().slice(0, 10), amount: "", developer: "", note: "" });
    load(); loadTotal();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir aporte?")) return;
    const { error } = await (supabase as any).from("marketing_investments").delete().eq("id", id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    load(); loadTotal();
  };

  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.developer || "Sem construtora", (m.get(r.developer || "Sem construtora") || 0) + Number(r.amount)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const now = new Date();

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2 border-emerald-500/40" onClick={() => setOpen(true)}>
        <DollarSign className="h-4 w-4 text-emerald-400" />
        <span className="text-xs">Aporte {MESES[now.getMonth()]}:</span>
        <strong className="text-emerald-400">{fmt(monthTotal)}</strong>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              Aportes de Marketing — {MESES[now.getMonth()]}/{now.getFullYear()}
              <Badge variant="outline" className="ml-auto text-emerald-400 border-emerald-500/40">Total: {fmt(monthTotal)}</Badge>
            </DialogTitle>
          </DialogHeader>

          {canEdit && (
            <div className="border border-border/40 rounded-lg p-3 bg-secondary/20 space-y-2">
              <p className="text-xs font-semibold">Novo Aporte</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div><Label className="text-[10px]">Data</Label><Input type="date" value={form.invested_at} onChange={e => setForm(p => ({ ...p, invested_at: e.target.value }))} className="h-8 text-xs" /></div>
                <div><Label className="text-[10px]">Valor (R$)</Label><Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} className="h-8 text-xs" placeholder="5000" /></div>
                <div>
                  <Label className="text-[10px]">Construtora</Label>
                  <Select value={form.developer} onValueChange={v => setForm(p => ({ ...p, developer: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{devs.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-[10px]">Nota</Label><Input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} className="h-8 text-xs" placeholder="opcional" /></div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={save} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />{saving ? "Salvando..." : "Salvar"}</Button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold mb-1">Por construtora</p>
              <div className="flex flex-wrap gap-1">
                {grouped.map(([dev, amt]) => (
                  <Badge key={dev} variant="secondary" className="text-[11px]">{dev}: <strong className="ml-1 text-emerald-400">{fmt(amt)}</strong></Badge>
                ))}
                {grouped.length === 0 && <span className="text-xs text-muted-foreground">Sem aportes no mês</span>}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-border/30 rounded-lg">
              {loading ? (
                <div className="p-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Carregando...</div>
              ) : rows.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">Nenhum aporte cadastrado neste mês.</p>
              ) : rows.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 text-xs last:border-0">
                  <span className="w-20 text-muted-foreground">{r.invested_at.slice(8, 10)}/{r.invested_at.slice(5, 7)}</span>
                  <span className="flex-1 truncate">{r.developer || "—"}</span>
                  <span className="text-muted-foreground text-[10px] truncate max-w-[100px]">{r.note}</span>
                  <strong className="text-emerald-400 w-24 text-right">{fmt(Number(r.amount))}</strong>
                  {canEdit && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(r.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
