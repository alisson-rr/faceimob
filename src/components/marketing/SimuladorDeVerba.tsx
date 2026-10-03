import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, num, parseBrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invocarAcaoMeta } from "./acaoMeta";
import type { LinhaDoPainel } from "./gestaoDeAnuncios";
import { ROTULO_DA_ESTRATEGIA, simularVerba, type Estrategia } from "./simuladorDeVerba";

const reais = (v: number | null | undefined) => brl(v, { cents: true });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const leads = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

/**
 * Simulador de budget diário (pedido de 03/10/2026): escolhe o alvo por dia e
 * a estratégia, vê campanha por campanha o de → para (nunca mais de 20%, sem
 * fase de aprendizado) e executa pela mesma edge das ações manuais, uma
 * campanha por vez, cortes antes das subidas.
 */
export function SimuladorDeVerba({ linhas, podeGerir }: { linhas: LinhaDoPainel[]; podeGerir: boolean }) {
  const queryClient = useQueryClient();
  const [estrategia, setEstrategia] = useState<Estrategia>("mais_leads");
  const [alvoTexto, setAlvoTexto] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [executando, setExecutando] = useState(false);

  const base = useMemo(() => simularVerba(linhas, 0, estrategia), [linhas, estrategia]);
  const alvo = parseBrl(alvoTexto) ?? base.totalAtual;
  const sim = useMemo(() => simularVerba(linhas, alvo, estrategia), [linhas, alvo, estrategia]);
  const faltou = sim.totalNovo + 0.005 < alvo;
  const sobrou = sim.totalNovo - 0.005 > alvo;

  if (base.campanhas === 0) return null;

  const definirAlvo = (v: number) => setAlvoTexto(v.toFixed(2).replace(".", ","));

  const executar = async () => {
    setExecutando(true);
    const falhas: string[] = [];
    // Em série e na ordem do simulador (cortes primeiro): a conta nunca passa do alvo no meio.
    for (const a of sim.ajustes) {
      const r = await invocarAcaoMeta(
        { campaign_id: a.id, acao: "verba", verba_diaria: a.para },
        "A ação respondeu sem dizer o que a Meta fez.",
      );
      if (r.tipo === "aprendizado") falhas.push(`${a.name}: a verba na Meta mudou desde a sincronização; ajuste à mão.`);
      else if (r.tipo === "falha") falhas.push(`${a.name}: ${r.mensagem}`);
    }
    setExecutando(false);
    setConfirmando(false);
    await queryClient.invalidateQueries({ queryKey: ["marketing"] });
    const feitas = sim.ajustes.length - falhas.length;
    if (falhas.length === 0) {
      toast.success(`Verba realocada em ${num(feitas)} campanha(s)`, {
        description: `Novo total: ${reais(sim.totalNovo)} por dia. Para escalar mais, repita daqui a 48 h.`,
      });
    } else {
      toast.warning(`${num(feitas)} de ${num(sim.ajustes.length)} campanhas mudaram`, { description: falhas[0] });
    }
  };

  return (
    <details className="group rounded-2xl border border-primary/30 bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <Calculator className="h-5 w-5 text-primary" aria-hidden />
        Simulador de budget diário
        <span className="text-xs font-normal text-muted-foreground">
          · mais leads sem entrar em fase de aprendizado (máx. 20% por campanha)
        </span>
      </summary>

      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="simulador-alvo" className="text-eyebrow">Alvo por dia (R$)</Label>
            <Input
              id="simulador-alvo" className="mt-1" inputMode="decimal" autoComplete="off"
              placeholder={base.totalAtual.toFixed(2).replace(".", ",")}
              value={alvoTexto} onChange={(e) => setAlvoTexto(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="simulador-estrategia" className="text-eyebrow">Distribuição</Label>
            <Select value={estrategia} onValueChange={(v) => setEstrategia(v as Estrategia)}>
              <SelectTrigger id="simulador-estrategia" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROTULO_DA_ESTRATEGIA) as Estrategia[]).map((e) => (
                  <SelectItem key={e} value={e}>{ROTULO_DA_ESTRATEGIA[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => definirAlvo(base.totalAtual)}>
              Só realocar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => definirAlvo(sim.teto)}>
              <TrendingUp className="h-4 w-4" aria-hidden /> Escalar ao máximo
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-border px-3 py-2">
            <dt className="text-eyebrow">Verba/dia</dt>
            <dd className="font-bold tabular-nums">{reais(sim.totalAtual)} → {reais(sim.totalNovo)}</dd>
          </div>
          <div className="rounded-xl border border-border px-3 py-2">
            <dt className="text-eyebrow">Leads/dia (estimativa)</dt>
            <dd className="font-bold tabular-nums">{leads(sim.leadsAtuais)} → {leads(sim.leadsNovos)}</dd>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
            <dt className="text-eyebrow">CPL R$ esperado</dt>
            <dd className="text-lg font-bold tabular-nums text-primary">{reais(sim.cplAtual)} → {reais(sim.cplNovo)}</dd>
          </div>
          <div className="rounded-xl border border-border px-3 py-2">
            <dt className="text-eyebrow">Hoje dá para ir de</dt>
            <dd className="font-bold tabular-nums">{reais(sim.piso)} a {reais(sim.teto)}</dd>
          </div>
        </dl>

        {(faltou || sobrou) && (
          <p role="status" className="text-sm text-warning">
            {faltou
              ? `Sem reiniciar o aprendizado, hoje dá para chegar a ${reais(sim.totalNovo)}. Execute e repita daqui a 48 h para continuar escalando.`
              : `Sem reiniciar o aprendizado, hoje dá para descer só até ${reais(sim.totalNovo)}. Para cortar mais, pause campanhas.`}
          </p>
        )}
        {sim.foraDoSimulador > 0 && (
          <p className="text-xs text-muted-foreground">
            {num(sim.foraDoSimulador)} campanha(s) ativa(s) fora do simulador: verba total ou ainda sem sincronizar.
          </p>
        )}

        {sim.ajustes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mudança para esse alvo.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {sim.ajustes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">CPL {reais(a.cpl)}</span>
                <span className="tabular-nums">{reais(a.de)} → <strong>{reais(a.para)}</strong></span>
                <span className={cn("w-16 text-right font-semibold tabular-nums", a.variacao > 0 ? "text-success" : "text-destructive")}>
                  {pct.format(a.variacao)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {podeGerir && sim.ajustes.length > 0 && (
          <Button onClick={() => setConfirmando(true)} disabled={executando}>
            Executar realocação
          </Button>
        )}
      </div>

      <AlertDialog open={confirmando} onOpenChange={(abrir) => { if (!abrir && !executando) setConfirmando(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mudar a verba de {num(sim.ajustes.length)} campanha(s) na Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              O total vai de {reais(sim.totalAtual)} para {reais(sim.totalNovo)} por dia. Nenhuma campanha muda mais de
              20%, então nenhuma volta para a fase de aprendizado. Cada mudança fica no histórico de ações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={executando} onClick={(e) => { e.preventDefault(); void executar(); }}>
              {executando ? "Enviando à Meta…" : "Executar na Meta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </details>
  );
}
