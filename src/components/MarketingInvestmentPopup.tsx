import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, DollarSign, Inbox, Pencil, Trash2, Save, X } from "lucide-react";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { aportePayload } from "@/integrations/supabase/analytics";
import { brl, monthStart } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

type Developer = { id: string; name: string; active: boolean };
type Investment = { id: string; period: string; amount: number; developer_id: string; notes: string | null };

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "Set/2026" a partir de `YYYY-MM-01`. */
const monthLabel = (period: string) => `${MESES[Number(period.slice(5, 7)) - 1]}/${period.slice(0, 4)}`;

const VAZIO = { amount: "", developer_id: "", notes: "" };

/** Falha de rede, 500 e timeout não têm `code`: sem orientação no fallback,
 *  `describeError` devolve a paráfrase do título e a tela repete a frase. */
const TENTE_DE_NOVO = 'A consulta não respondeu. Verifique a conexão e use "Tentar de novo".';

/**
 * Aportes de marketing por construtora e mês.
 *
 * O mês em exibição é escolhido no diálogo: o lançamento antigo precisa
 * aparecer para ser corrigido ou excluído. Lançamento NOVO é `upsert` pela
 * chave `(developer_id, period)` — um aporte por construtora e mês é regra do
 * banco, então salvar de novo corrige o valor em vez de recusar com "já
 * existe". CORRIGIR grava pelo `id` da linha, e não pela dupla: só assim
 * trocar a construtora move a verba em vez de duplicá-la.
 *
 * A lista de construtoras vem INTEIRA (ativas e inativas): a FK de
 * `marketing_investments` é RESTRICT, então desativar a construtora não tira o
 * aporte histórico dela do total — carregar só as ativas fazia o dinheiro
 * continuar somando enquanto o nome virava "Sem construtora".
 */
export function MarketingInvestmentPopup({ canEdit }: { canEdit: boolean }) {
  // O popup mora no cabeçalho de /marketing, ao lado da aba "Por construtora".
  // Sem invalidar, a faixa de comparação e a tabela ficavam até 60 s
  // (`staleTime`) exibindo o aporte ANTIGO enquanto o botão do popup já mostrava
  // o novo: dois números do mesmo mês na mesma dobra. A chave-prefixo pega mês
  // corrente e mês anterior de uma vez.
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(() => monthStart());
  const [rows, setRows] = useState<Investment[]>([]);
  const [devs, setDevs] = useState<Developer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTotal, setCurrentTotal] = useState<number | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Total do mês corrente, para o botão — independe do mês aberto no diálogo.
  const loadCurrentTotal = useCallback(async () => {
    const { data, error } = await supabase.from("marketing_investments").select("amount").eq("period", monthStart());
    if (error) {
      setCurrentTotal(null);
      return toast({ title: "Falha ao carregar os aportes", description: describeError(error, "O total do mês não pôde ser somado; recarregue a tela."), variant: "destructive" });
    }
    setCurrentTotal((data ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  }, []);

  const load = useCallback(async (month: string) => {
    setLoading(true);
    setLoadError(null);
    const [inv, devsRes] = await Promise.all([
      supabase.from("marketing_investments").select("*").eq("period", month).order("amount", { ascending: false }),
      supabase.from("developers").select("id,name,active").order("name"),
    ]);
    setLoading(false);
    const error = inv.error ?? devsRes.error;
    if (error) return setLoadError(describeError(error, TENTE_DE_NOVO));
    setRows((inv.data as Investment[]) ?? []);
    setDevs(devsRes.data ?? []);
  }, []);

  useEffect(() => { void loadCurrentTotal(); }, [loadCurrentTotal]);
  useEffect(() => { if (open) void load(period); }, [open, period, load]);

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.amount || !form.developer_id || !Number.isFinite(amount) || amount < 0) {
      return toast({ title: "Preencha valor e construtora", variant: "destructive" });
    }
    setSaving(true);
    // `aportePayload` decide se a nota vai: lançamento novo com o campo em
    // branco deixa `notes` FORA do upsert, senão gravaria null por cima da nota
    // já lançada para a mesma dupla (construtora, mês). Corrigindo, o branco é
    // ordem explícita de apagar — a nota estava no campo e o operador a limpou.
    const payload = aportePayload({ period, amount, developer_id: form.developer_id, notes: form.notes, editing: !!editing });
    // Corrigir grava pela chave DA LINHA. Pelo `upsert`, trocar a construtora
    // durante a edição criava uma verba nova na construtora escolhida e deixava
    // a antiga intacta — o mês passava a contar as duas e a tela dizia "Aporte
    // salvo". Trocar para uma construtora que já tem aporte no mês bate no
    // unique `(developer_id, period)` e volta como erro, que é a verdade.
    const { data, error } = editing
      ? await supabase.from("marketing_investments").update(payload).eq("id", editing).select("id")
      : await supabase.from("marketing_investments").upsert(payload, { onConflict: "developer_id,period" }).select("id");
    setSaving(false);
    if (error) return toast({ title: "Falha ao salvar o aporte", description: describeError(error, "Confira valor e construtora e tente de novo."), variant: "destructive" });
    // O RLS não erra ao recusar: filtra a linha e o PostgREST devolve 204.
    if (!data?.length) {
      return toast({
        title: editing
          ? "O aporte não foi alterado: ou alguém já o excluiu, ou seu papel não pode lançar aporte (apenas admin e marketing)."
          : "Sem permissão para lançar aporte (apenas admin e marketing).",
        variant: "destructive",
      });
    }
    toast({ title: "Aporte salvo" });
    setForm(VAZIO);
    setEditing(null);
    void load(period);
    void loadCurrentTotal();
    void qc.invalidateQueries({ queryKey: ["marketing", "por-construtora"] });
  };

  const startEdit = (row: Investment) => {
    setEditing(row.id);
    setForm({ amount: String(row.amount), developer_id: row.developer_id, notes: row.notes ?? "" });
  };

  const remove = async (row: Investment) => {
    if (!confirm(`Excluir o aporte de ${devName(row.developer_id)} em ${monthLabel(row.period)}?`)) return;
    const { data, error } = await supabase.from("marketing_investments").delete().eq("id", row.id).select("id");
    if (error) return toast({ title: "Falha ao excluir o aporte", description: describeError(error, "Não foi possível excluir o aporte."), variant: "destructive" });
    if (!data?.length) return toast({ title: "Sem permissão para excluir aporte (apenas admin e marketing).", variant: "destructive" });
    if (editing === row.id) { setEditing(null); setForm(VAZIO); }
    toast({ title: "Aporte excluído" });
    void load(period);
    void loadCurrentTotal();
    void qc.invalidateQueries({ queryKey: ["marketing", "por-construtora"] });
  };

  const devName = (id: string) => devs.find(d => d.id === id)?.name || "Sem construtora";

  const monthTotal = useMemo(() => rows.reduce((sum, r) => sum + Number(r.amount), 0), [rows]);
  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      const developer = devs.find(d => d.id === r.developer_id)?.name || "Sem construtora";
      m.set(developer, (m.get(developer) || 0) + Number(r.amount));
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows, devs]);

  /** Ativas + a que está sendo corrigida: não se lança aporte novo em construtora
   *  desativada, mas corrigir um lançamento antigo dela precisa funcionar. */
  const opcoes = useMemo(
    () => devs.filter(d => d.active || d.id === form.developer_id),
    [devs, form.developer_id],
  );

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2 border-success/40" onClick={() => setOpen(true)}>
        <DollarSign className="h-4 w-4 text-success" />
        <span className="text-xs">Aporte {MESES[new Date().getMonth()]}:</span>
        <strong className="text-success">{brl(currentTotal)}</strong>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* `max-h` + rolagem: o Radix centraliza com translate e trava o scroll
            do body, então sem isso tudo que passa da altura útil — inclusive o
            botão Salvar — fica inalcançável em tela baixa e no celular.

            `grid-cols-[minmax(0,1fr)]` é o que impede o diálogo de ficar mais
            largo que a tela: o `DialogContent` do kit é `grid` sem template, e
            a coluna `auto` cresce até o min-content do item mais largo — a
            lista de aportes, com nome de construtora e valor lado a lado, pedia
            640 px numa tela de 375. O diálogo então rolava na horizontal e
            Salvar, que fica alinhado à direita, saía da tela. Com `minmax(0,…)`
            a coluna pode encolher e quem rola é a lista, dentro do próprio
            quadro. */}
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Aportes de Marketing — {monthLabel(period)}
              <StatusBadge tone="success" className="ml-auto">Total: {brl(monthTotal)}</StatusBadge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Label htmlFor="aporte-mes" className="text-xs">Mês</Label>
            <Input
              id="aporte-mes"
              type="month"
              value={period.slice(0, 7)}
              onChange={e => { if (e.target.value) setPeriod(`${e.target.value}-01`); }}
              className="h-8 w-40 text-xs"
            />
          </div>

          {canEdit && (
            <div className="border border-border/40 rounded-lg p-3 bg-secondary/20 space-y-2">
              <p className="text-xs font-semibold">{editing ? "Corrigir aporte" : "Aporte"} de {monthLabel(period)}</p>
              <p className="text-xs text-muted-foreground">
                Um aporte por construtora e mês: salvar de novo corrige o valor. A nota em branco preserva a que já
                está gravada — use Editar para trocá-la.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><Label htmlFor="aporte-valor" className="text-xs">Valor (R$)</Label><Input id="aporte-valor" type="number" min={0} value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} className="h-8 text-xs" placeholder="5000" /></div>
                <div>
                  <Label htmlFor="aporte-construtora" className="text-xs">Construtora</Label>
                  {/* O `id` no gatilho é o que faz o rótulo nomear e focar o
                      controle; o Radix repassa o id para o botão do Select. */}
                  <Select value={form.developer_id} onValueChange={v => setForm(p => ({ ...p, developer_id: v }))}>
                    <SelectTrigger id="aporte-construtora" className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{opcoes.map(d => <SelectItem key={d.id} value={d.id}>{d.active ? d.name : `${d.name} (inativa)`}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label htmlFor="aporte-nota" className="text-xs">Nota</Label><Input id="aporte-nota" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-8 text-xs" placeholder="opcional" /></div>
              </div>
              <div className="flex justify-end gap-2">
                {editing && (
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => { setEditing(null); setForm(VAZIO); }}>
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                )}
                <Button size="sm" onClick={save} disabled={saving} className="gap-1"><Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar"}</Button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Só com aporte no mês: vazio quem explica é o estado da lista, uma
                caixa só — antes o mesmo nada aparecia duas vezes seguidas. */}
            {grouped.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1">Por construtora</p>
                <div className="flex flex-wrap gap-1">
                  {grouped.map(([dev, amt]) => (
                    <StatusBadge key={dev} tone="neutral">{dev}: <strong className="ml-1 text-success">{brl(amt)}</strong></StatusBadge>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <LoadingState variant="list" rows={3} label="Carregando aportes…" />
            ) : loadError ? (
              <EmptyState
                icon={AlertTriangle}
                tone="danger"
                title="Não consegui carregar os aportes"
                description={loadError}
                action={<Button variant="outline" onClick={() => void load(period)}>Tentar de novo</Button>}
              />
            ) : rows.length === 0 ? (
              <EmptyState icon={Inbox} title="Nenhum aporte neste mês" description="Troque o mês acima para ver lançamentos anteriores." />
            ) : (
              <div className="max-h-64 overflow-y-auto border border-border/30 rounded-lg">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 text-xs last:border-0">
                    {/* No celular sobram ~325 px para nome, valor e dois botões:
                        o mês e a nota saem porque são os dois que a tela já dá
                        em outro lugar — o mês está no título (a lista é de um
                        mês só) e a nota inteira aparece ao clicar em Editar.
                        Sem isso o nome da construtora ficava com 0 px. */}
                    <span className="hidden sm:block w-20 text-muted-foreground">{monthLabel(r.period)}</span>
                    <span className="flex-1 truncate">{devName(r.developer_id)}</span>
                    <span className="hidden sm:block text-muted-foreground text-xs truncate max-w-[100px]">{r.notes}</span>
                    <strong className="text-success w-24 text-right">{brl(Number(r.amount))}</strong>
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Editar aporte de ${devName(r.developer_id)}`} onClick={() => startEdit(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Excluir aporte de ${devName(r.developer_id)}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* O `DialogContent` do kit já traz um X no canto com o nome
              acessível "Fechar". Dois botões "Fechar" no mesmo diálogo é o que
              o leitor de tela anuncia duas vezes sem dizer qual é qual — e o
              que o Playwright acusa como seletor ambíguo. O rótulo visível
              continua curto ("Fechar", como nos outros diálogos) e o nome
              acessível é o específico; o visível é prefixo do acessível, como
              o WCAG 2.5.3 exige. Este botão existe porque no celular o X rola
              junto com o conteúdo e some — aqui embaixo ele é alcançável. */}
          <DialogFooter>
            <Button variant="outline" aria-label="Fechar esta janela" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
