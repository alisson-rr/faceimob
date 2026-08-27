import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, RefreshCw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { listLegacyDeals } from "@/integrations/supabase/newSchema";
import { listAnnualResults, upsertAnnualResult, type AnnualResultRow } from "@/integrations/supabase/analytics";
import { describeError } from "@/lib/supabaseError";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

const key = (y: number, m: number) => `${y}-${m}`;

/**
 * Consolidado anual.
 *
 * A fonte é `annual_results`, não um recálculo sobre todos os negócios a cada
 * abertura. Recalcular ignorava `closed_months`: editar um negócio antigo mudava
 * o anual retroativamente, que é exatamente a discrepância que a tabela veio
 * resolver. O recálculo continua disponível, mas como ação explícita.
 */
export default function Resultados() {
  const { toast } = useToast();
  const { can, isAdmin } = useAuth();
  const [rows, setRows] = useState<AnnualResultRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { sales: string; vgv: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // A policy `annual_results_write` já barra quem não pode; isto só evita
  // oferecer um campo que o banco vai recusar.
  const canEdit = isAdmin || can("reports.view_finance");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAnnualResults();
      setRows(data);
      setDrafts(Object.fromEntries(
        data.map((r) => [key(r.year, r.month), { sales: String(r.sales_count), vgv: String(r.vgv) }]),
      ));
    } catch (e) {
      toast({
        title: "Falha ao carregar o consolidado",
        description: describeError(e, "Não foi possível carregar o consolidado."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const get = (y: number, m: number) => drafts[key(y, m)] || { sales: "", vgv: "" };

  const totalsByYear = useMemo(() => {
    const map = new Map<number, { sales: number; vgv: number }>();
    rows.forEach((r) => {
      const cur = map.get(r.year) || { sales: 0, vgv: 0 };
      map.set(r.year, { sales: cur.sales + r.sales_count, vgv: cur.vgv + Number(r.vgv || 0) });
    });
    return map;
  }, [rows]);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const save = async (y: number, m: number) => {
    const d = get(y, m);
    setBusy(key(y, m));
    try {
      await upsertAnnualResult({
        year: y,
        month: m,
        salesCount: Number(d.sales || 0),
        vgv: Number(d.vgv || 0),
      });
      await load();
      toast({ title: `${MONTHS[m - 1]}/${y} atualizado` });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: describeError(e, "Não foi possível salvar o resultado do mês."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /** Recalcula do pipeline e grava no consolidado — explícito, não automático. */
  const recalcFromPipeline = async (y: number) => {
    setBusy(`recalc-${y}`);
    try {
      const deals = await listLegacyDeals();
      const byMonth = new Map<number, { sales: number; vgv: number }>();
      deals
        .filter((deal) => deal.outcome === "won" && deal.month_base)
        .forEach((deal) => {
          const [month, year] = deal.month_base!.split("/").map(Number);
          if (!month || year !== y) return;
          const cur = byMonth.get(month) || { sales: 0, vgv: 0 };
          cur.sales += 1;
          cur.vgv += Number(deal.vgv_liquido || deal.deal_value || 0);
          byMonth.set(month, cur);
        });

      for (const [month, v] of byMonth) {
        await upsertAnnualResult({ year: y, month, salesCount: v.sales, vgv: v.vgv });
      }
      await load();
      toast({ title: `${y} recalculado a partir do pipeline`, description: `${byMonth.size} mês(es) atualizado(s).` });
    } catch (e) {
      toast({
        title: "Falha ao recalcular",
        description: describeError(e, "Não foi possível recalcular o ano a partir do pipeline."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary" /> Resultados Anuais</h1>
        <p className="text-sm text-muted-foreground">
          Consolidado gravado em <code>annual_results</code>. Mês já fechado não muda sozinho.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
      ) : (
        <Accordion type="multiple" defaultValue={[String(currentYear)]} className="space-y-2">
          {YEARS.map((y) => {
            const t = totalsByYear.get(y) || { sales: 0, vgv: 0 };
            return (
              <AccordionItem key={y} value={String(y)} className="border border-border/40 rounded-lg glass">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span className="font-bold text-base">{y}</span>
                    <div className="flex gap-4 text-xs">
                      <span><span className="text-muted-foreground">Vendas:</span> <strong>{t.sales}</strong></span>
                      <span><span className="text-muted-foreground">VGV:</span> <strong className="text-success">{fmt(t.vgv)}</strong></span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      disabled={busy === `recalc-${y}`}
                      onClick={() => recalcFromPipeline(y)}
                    >
                      {busy === `recalc-${y}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Recalcular {y} pelo pipeline
                    </Button>
                  )}
                  <div className="grid gap-2">
                    {MONTHS.map((mName, i) => {
                      const m = i + 1;
                      const d = get(y, m);
                      return (
                        <div key={m} className="grid grid-cols-[100px_1fr_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-muted-foreground">{mName}</span>
                          <Input
                            type="number"
                            placeholder="Vendas"
                            value={d.sales}
                            disabled={!canEdit}
                            aria-label={`Vendas de ${mName} de ${y}`}
                            onChange={(e) => setDrafts((p) => ({ ...p, [key(y, m)]: { ...get(y, m), sales: e.target.value } }))}
                            className="h-8 text-xs"
                          />
                          <Input
                            type="number"
                            placeholder="VGV (R$)"
                            value={d.vgv}
                            disabled={!canEdit}
                            aria-label={`VGV de ${mName} de ${y}`}
                            onChange={(e) => setDrafts((p) => ({ ...p, [key(y, m)]: { ...get(y, m), vgv: e.target.value } }))}
                            className="h-8 text-xs"
                          />
                          {canEdit ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`Salvar ${mName} de ${y}`}
                              disabled={busy === key(y, m)}
                              onClick={() => save(y, m)}
                            >
                              {busy === key(y, m) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                          ) : <span />}
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
