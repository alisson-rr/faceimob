import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, TrendingUp, RefreshCw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { listLegacyDeals } from "@/integrations/supabase/newSchema";
import { listAnnualResults, upsertAnnualResult, type AnnualResultRow } from "@/integrations/supabase/analytics";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

const key = (y: number, m: number) => `${y}-${m}`;

type Draft = { sales: string; vgv: string };

const RESULTADOS_KEY = ["resultados", "anual"] as const;
const SEM_RESULTADOS: AnnualResultRow[] = [];

/** Os campos de cada mês, a partir do que está gravado. */
const draftsDe = (rows: AnnualResultRow[]): Record<string, Draft> =>
  Object.fromEntries(rows.map((r) => [key(r.year, r.month), { sales: String(r.sales_count), vgv: String(r.vgv) }]));

/** Um mês que o recálculo vai reescrever, com o antes e o depois. */
type Change = { month: number; fromSales: number; toSales: number; fromVgv: number; toVgv: number };

/** Prévia do recálculo: os meses que mudam e sobre quantos negócios foi feita a conta. */
type Preview = { year: number; changes: Change[]; base: number };

/**
 * Vendas é contagem: `sales_count` é `int` no banco. Digitar "3,5" ou "-1" só
 * dava erro depois do clique, com a mensagem crua do Postgres.
 */
function validate(draft: Draft): string | null {
  const sales = Number(draft.sales || 0);
  const vgv = Number(draft.vgv || 0);
  if (!Number.isInteger(sales) || sales < 0) return "Vendas é um número inteiro, a partir de zero.";
  if (!Number.isFinite(vgv) || vgv < 0) return "VGV não pode ser negativo.";
  return null;
}

/**
 * Consolidado anual.
 *
 * A fonte é `annual_results`, não um recálculo sobre todos os negócios a cada
 * abertura. Recalcular ignorava `closed_months`: editar um negócio antigo mudava
 * o anual retroativamente, que é exatamente a discrepância que a tabela veio
 * resolver. O recálculo continua disponível, mas como ação explícita — e desde
 * 03/09 com prévia, porque ele reescreve o ano inteiro de uma vez.
 */
export default function Resultados() {
  const { toast } = useToast();
  const { isAdmin, roles, user } = useAuth();
  const queryClient = useQueryClient();
  // Cache do TanStack Query: voltar à tela mostra o consolidado que já estava
  // aqui e relê por trás, em vez de repetir o "Carregando…" a cada entrada. Sem
  // releitura ao focar a aba: a carga manual nunca releu assim, e uma releitura
  // com o ano aberto reescreveria os campos que a pessoa está digitando. O
  // usuário entra na chave para quem entra depois no mesmo navegador não herdar
  // a leitura de quem saiu.
  const resultados = useQuery({
    queryKey: [...RESULTADOS_KEY, user?.id ?? null],
    // O aviso sai da leitura, uma vez por carga, como na carga manual — e sem
    // `retry`, que o repetiria.
    queryFn: () => listAnnualResults().catch((e: unknown) => {
      toast({ title: "Não foi possível carregar o consolidado", description: describeError(e, "Verifique a conexão e tente de novo."), variant: "destructive" });
      throw e;
    }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rows = resultados.data ?? SEM_RESULTADOS;
  const loading = resultados.data === undefined && resultados.isFetching;
  const loadError = resultados.error;
  const load = () => queryClient.invalidateQueries({ queryKey: RESULTADOS_KEY });
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsDe(rows));
  // Cada leitura nova do banco reescreve os rascunhos, como o `load()` fazia:
  // salvar recarrega e alinha os campos ao que ficou gravado.
  const [leituraDosRascunhos, setLeituraDosRascunhos] = useState(resultados.data);
  if (resultados.data !== leituraDosRascunhos) {
    setLeituraDosRascunhos(resultados.data);
    if (resultados.data) setDrafts(draftsDe(resultados.data));
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // Espelha a policy `annual_results_write` (`has_any_role('admin','director')`).
  // `reports.view_finance` também vale para marketing e sócio, que só leem —
  // oferecer campo a eles era prometer o que o banco recusa.
  // `roles` já vem efetivo do AuthContext, então a prévia vale aqui sem remendo.
  const canEdit = isAdmin || roles.includes("director");

  /**
   * Recalcular é SÓ do admin, e a razão não é permissão de escrita — é o
   * recorte da leitura. A origem do número é `listLegacyDeals()`, que lê `deals`
   * sob RLS: o diretor enxerga apenas a própria hierarquia, enquanto
   * `annual_results` é da casa inteira. O recálculo dele reescreveria o ano com
   * um pipeline parcial e zeraria os meses das outras diretorias — gravação
   * irreversível a partir de um número que a tela nem tinha como qualificar.
   * O lançamento mês a mês continua com o diretor: ali ele digita o valor que
   * conhece, em vez de deixar a conta sair de um recorte que ele não vê.
   */
  const podeRecalcular = isAdmin;

  const byMonthKey = useMemo(
    () => new Map(rows.map((r) => [key(r.year, r.month), r])),
    [rows],
  );

  const get = (y: number, m: number): Draft => drafts[key(y, m)] || { sales: "", vgv: "" };

  const totalsByYear = useMemo(() => {
    const map = new Map<number, { sales: number; vgv: number; meses: number }>();
    rows.forEach((r) => {
      const cur = map.get(r.year) || { sales: 0, vgv: 0, meses: 0 };
      map.set(r.year, {
        sales: cur.sales + r.sales_count,
        vgv: cur.vgv + Number(r.vgv || 0),
        meses: cur.meses + 1,
      });
    });
    return map;
  }, [rows]);

  /**
   * `notes` é o campo que só o banco tem: nenhuma tela o escreve, e
   * `upsertAnnualResult` manda `notes ?? null`. Sem repassar a nota atual, o
   * primeiro "Salvar" apagava em silêncio o texto que explicava o número
   * ("Parcial do mês corrente…").
   */
  const gravar = (y: number, m: number, salesCount: number, vgv: number) =>
    upsertAnnualResult({
      year: y,
      month: m,
      salesCount,
      vgv,
      notes: byMonthKey.get(key(y, m))?.notes ?? null,
    });

  const save = async (y: number, m: number) => {
    const d = get(y, m);
    const invalid = validate(d);
    if (invalid) {
      toast({ title: "Confira o lançamento", description: invalid, variant: "destructive" });
      return;
    }
    setBusy(key(y, m));
    try {
      await gravar(y, m, Number(d.sales || 0), Number(d.vgv || 0));
      await load();
      toast({ title: `Resultado de ${MONTHS[m - 1]}/${y} salvo`, variant: "success" });
    } catch (e) {
      toast({
        title: `Não foi possível salvar o resultado de ${MONTHS[m - 1]}/${y}`,
        description: describeError(e, "Tente de novo em instantes."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Monta a prévia do recálculo.
   *
   * Antes gravava direto e só os meses COM negócio ganho: um mês que já tinha
   * número e perdeu as vendas ficava com o valor antigo para sempre. Agora todo
   * mês que muda entra na lista — inclusive o que vai a zero — e o operador vê
   * o antes e o depois antes de confirmar.
   */
  const prepararRecalculo = async (y: number) => {
    setBusy(`recalc-${y}`);
    try {
      const deals = await listLegacyDeals();
      const byMonth = new Map<number, { sales: number; vgv: number }>();
      const ganhos = deals.filter((deal) => deal.outcome === "won" && deal.month_base);
      ganhos
        .forEach((deal) => {
          const [month, year] = deal.month_base!.split("/").map(Number);
          if (!month || year !== y) return;
          const cur = byMonth.get(month) || { sales: 0, vgv: 0 };
          cur.sales += 1;
          cur.vgv += Number(deal.vgv_liquido || deal.deal_value || 0);
          byMonth.set(month, cur);
        });

      const changes: Change[] = [];
      for (let month = 1; month <= 12; month += 1) {
        const alvo = byMonth.get(month) ?? { sales: 0, vgv: 0 };
        const atual = byMonthKey.get(key(y, month));
        if (!atual && alvo.sales === 0 && alvo.vgv === 0) continue;
        const fromSales = atual?.sales_count ?? 0;
        const fromVgv = Number(atual?.vgv ?? 0);
        if (fromSales === alvo.sales && fromVgv === alvo.vgv) continue;
        changes.push({ month, fromSales, toSales: alvo.sales, fromVgv, toVgv: alvo.vgv });
      }

      if (changes.length === 0) {
        toast({ title: `${y} já está igual ao pipeline`, description: "Nenhum mês precisou mudar." });
        return;
      }
      setPreview({ year: y, changes, base: ganhos.length });
    } catch (e) {
      toast({
        title: "Não foi possível ler o pipeline",
        description: describeError(e, "Os negócios não carregaram para o recálculo. Tente de novo."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Grava mês a mês, sem transação — o PostgREST não tem uma para vários
   * upserts, e a prévia é justamente o que dá ao operador a chance de conferir
   * antes.
   *
   * Por isso a falha no meio recarrega a tela ANTES de avisar: sem o `load()`,
   * os meses já gravados continuavam aparecendo com o valor antigo (e os totais
   * do ano junto), e a prévia "antes → depois" ficava aberta descrevendo um
   * estado que não existe mais. A mensagem diz quantos meses passaram.
   */
  const aplicarRecalculo = async () => {
    if (!preview) return;
    const { year, changes } = preview;
    setBusy(`recalc-${year}`);
    let gravados = 0;
    try {
      for (const change of changes) {
        await gravar(year, change.month, change.toSales, change.toVgv);
        gravados += 1;
      }
      await load();
      setPreview(null);
      toast({
        title: `${year} recalculado`,
        description: `${changes.length} mês(es) atualizado(s) a partir do pipeline.`,
        variant: "success",
      });
    } catch (e) {
      await load();
      setPreview(null);
      toast({
        title: `Não foi possível recalcular ${year}`,
        description: `${gravados} de ${changes.length} mês(es) já foram gravados antes da falha. ${describeError(e, "Tente de novo em instantes.")}`,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Resultados Anuais"
        eyebrow="Relatórios"
        icon={TrendingUp}
        description={
          <>
            Consolidado gravado em <code>annual_results</code>. Mês já fechado não muda sozinho.
          </>
        }
        actions={!canEdit
          ? <StatusBadge tone="neutral">Somente leitura: administrador e diretor lançam o consolidado.</StatusBadge>
          : undefined}
      />

      {loading ? (
        <LoadingState variant="list" rows={5} label="Carregando o consolidado…" />
      ) : loadError ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar o consolidado"
          description={describeError(loadError, "Não foi possível carregar o consolidado.")}
          action={<Button variant="outline" onClick={() => void load()}>Tentar de novo</Button>}
        />
      ) : (
        <Accordion type="multiple" defaultValue={[String(currentYear)]} className="space-y-2">
          {YEARS.map((y) => {
            const t = totalsByYear.get(y) || { sales: 0, vgv: 0, meses: 0 };
            return (
              <AccordionItem key={y} value={String(y)} className="rounded-2xl border border-border bg-card">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex w-full flex-col gap-1 pr-4 text-left sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-display text-base font-bold">{y}</span>
                    <div className="flex gap-4 text-xs">
                      <span><span className="text-muted-foreground">Vendas:</span> <strong>{num(t.sales)}</strong></span>
                      <span><span className="text-muted-foreground">VGV:</span> <strong className="text-success">{brl(t.vgv)}</strong></span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 px-4 pb-4">
                  {podeRecalcular && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      disabled={busy === `recalc-${y}`}
                      onClick={() => void prepararRecalculo(y)}
                    >
                      {busy === `recalc-${y}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Recalcular {y} pelo pipeline
                    </Button>
                  )}

                  {t.meses === 0 && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      Nenhum mês lançado em {y}. Os campos abaixo estão vazios porque não há registro, não porque
                      a tela ainda esteja carregando.
                    </p>
                  )}

                  <div className="grid gap-2">
                    {MONTHS.map((mName, i) => {
                      const m = i + 1;
                      const d = get(y, m);
                      const invalid = canEdit ? validate(d) : null;
                      const dirty = Boolean(d.sales || d.vgv);
                      // Mês em branco que nem existe no banco: `validate` aceita
                      // (`Number("" || 0)` é 0), então um clique gravava 0/0 com
                      // toast de sucesso, criava a linha em `annual_results` e
                      // apagava o aviso honesto "Nenhum mês lançado em {y}" — a
                      // tela passava a afirmar um lançamento que ninguém fez.
                      // Zerar um mês JÁ lançado continua valendo: aí a linha
                      // existe e apagar os campos é uma correção deliberada.
                      const vazioENovo = !dirty && !byMonthKey.has(key(y, m));
                      return (
                        <div
                          key={m}
                          className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 sm:grid-cols-[6.5rem_1fr_1fr_auto]"
                        >
                          <span className="text-xs text-muted-foreground">{mName}</span>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            placeholder="Vendas"
                            value={d.sales}
                            disabled={!canEdit}
                            aria-label={`Vendas de ${mName} de ${y}`}
                            aria-invalid={Boolean(invalid && dirty) || undefined}
                            onChange={(e) => setDrafts((p) => ({ ...p, [key(y, m)]: { ...get(y, m), sales: e.target.value } }))}
                            className="h-8 text-xs"
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            placeholder="VGV (R$)"
                            value={d.vgv}
                            disabled={!canEdit}
                            aria-label={`VGV de ${mName} de ${y}`}
                            onChange={(e) => setDrafts((p) => ({ ...p, [key(y, m)]: { ...get(y, m), vgv: e.target.value } }))}
                            className="col-span-2 h-8 text-xs sm:col-span-1"
                          />
                          {canEdit ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`Salvar ${mName} de ${y}`}
                              title={vazioENovo ? "Preencha vendas ou VGV para lançar este mês." : undefined}
                              disabled={busy === key(y, m) || vazioENovo || Boolean(invalid && dirty)}
                              onClick={() => void save(y, m)}
                            >
                              {busy === key(y, m) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                          ) : <span />}
                          {invalid && dirty && (
                            <p className="col-span-full text-xs text-destructive">{invalid}</p>
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

      <AlertDialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" aria-hidden />
              Recalcular {preview?.year} pelo pipeline
            </AlertDialogTitle>
            <AlertDialogDescription>
              O consolidado destes meses passa a ser o que o pipeline soma hoje, sobre os{" "}
              <strong className="text-foreground">{num(preview?.base ?? 0)}</strong> negócios ganhos que o seu
              perfil enxerga. Mês sem negócio ganho nesse recorte vai a zero, e o consolidado é da casa inteira.
              {" "}A gravação é mês a mês: se falhar no meio, os meses anteriores já ficam gravados.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Mês</th>
                  <th className="px-3 py-2 text-right font-medium">Vendas</th>
                  <th className="px-3 py-2 text-right font-medium">VGV</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.changes ?? []).map((c) => (
                  <tr key={c.month} className="border-t border-border">
                    <td className="px-3 py-2">{MONTHS[c.month - 1]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-muted-foreground">{num(c.fromSales)}</span> → <strong>{num(c.toSales)}</strong>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-muted-foreground">{brl(c.fromVgv)}</span> → <strong>{brl(c.toVgv)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === `recalc-${preview?.year}`}
              onClick={(e) => { e.preventDefault(); void aplicarRecalculo(); }}
            >
              {busy === `recalc-${preview?.year}` ? "Gravando…" : `Gravar ${preview?.changes.length ?? 0} mês(es)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
