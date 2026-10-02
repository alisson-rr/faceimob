import { useId, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { SectionCard } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { dbError, describeError } from "@/lib/supabaseError";
import { emLotes, linhasDaLeadfy, resumoDaLeadfy, type LinhaLeadfy, type ResumoLeadfy } from "./importacaoLeadfy";

// RPCs da 0188, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type Casamento = { nome: string; perfil: string | null };
type Total = { inseridos: number; em_atendimento: number; duplicados: number; invalidos: number };

/**
 * Importação da base da Leadfy (pedido de 02/10/2026). A planilha é lida no
 * navegador e vai em lotes para `importar_leads_leadfy`: em negociação com
 * corretor do CRM vira atendimento dele; o resto fica na base como perdido,
 * para exportação. Antes, a prévia mostra quem casou com quem.
 */
export function ImportarLeadfyCard() {
  const id = useId();
  const [linhas, setLinhas] = useState<LinhaLeadfy[] | null>(null);
  const [resumo, setResumo] = useState<ResumoLeadfy | null>(null);
  const [casamentos, setCasamentos] = useState<Casamento[]>([]);
  const [lendo, setLendo] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [total, setTotal] = useState<Total | null>(null);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    setTotal(null);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const matriz = await readSheet(arquivo, 1);
      const lidas = linhasDaLeadfy(matriz as unknown[][]);
      const r = resumoDaLeadfy(lidas);
      const { data, error } = await untyped.rpc("previa_corretores_leadfy", {
        p_nomes: Object.keys(r.corretoresEmNegociacao),
      });
      if (error) throw dbError("previa_corretores_leadfy", error);
      setCasamentos(((data ?? []) as { nome: string; perfil: string | null }[]).map((c) => ({ nome: c.nome, perfil: c.perfil })));
      setLinhas(lidas);
      setResumo(r);
    } catch (err) {
      setLinhas(null);
      setResumo(null);
      toast.error("Não consegui ler a planilha", { description: describeError(err, "Confira se é a exportação 'Leads Todos' da Leadfy.") });
    } finally {
      setLendo(false);
    }
  };

  const importar = async () => {
    if (!linhas) return;
    const lotes = emLotes(linhas, 500);
    const soma: Total = { inseridos: 0, em_atendimento: 0, duplicados: 0, invalidos: 0 };
    setProgresso({ feitos: 0, total: linhas.length });
    try {
      for (const [i, lote] of lotes.entries()) {
        const { data, error } = await untyped.rpc("importar_leads_leadfy", { p_linhas: lote });
        if (error) throw dbError("importar_leads_leadfy", error);
        const r = (data ?? {}) as Partial<Total>;
        soma.inseridos += Number(r.inseridos) || 0;
        soma.em_atendimento += Number(r.em_atendimento) || 0;
        soma.duplicados += Number(r.duplicados) || 0;
        soma.invalidos += Number(r.invalidos) || 0;
        setProgresso({ feitos: Math.min((i + 1) * 500, linhas.length), total: linhas.length });
      }
      setTotal(soma);
      toast.success("Importação concluída", { description: `${num(soma.inseridos)} leads novos no CRM.` });
    } catch (err) {
      setTotal(soma);
      toast.error("A importação parou no meio", {
        description: `${describeError(err, "Tente de novo.")} O que já entrou fica; repetir a mesma planilha não duplica.`,
      });
    } finally {
      setProgresso(null);
    }
  };

  const contagens = casamentos.map((c) => ({ ...c, leads: resumo?.corretoresEmNegociacao[c.nome] ?? 0 }));
  const casados = contagens.filter((c) => c.perfil);
  const semCorretor = contagens.filter((c) => !c.perfil).sort((a, b) => b.leads - a.leads);
  const emAtendimentoPrevisto = casados.reduce((t, c) => t + c.leads, 0);

  return (
    <SectionCard title="Importar base da Leadfy">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Suba a exportação "Leads Todos" da Leadfy. Em negociação com corretor ativo no CRM vira atendimento dele;
          o resto (arquivados, novos e corretores que não estão no CRM) fica na base, para exportação. Telefone ou
          e-mail que já existe no CRM não é duplicado, e repetir a mesma planilha é seguro.
        </p>
        <label htmlFor={`${id}-arquivo`} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-input px-3 py-2 hover:bg-muted">
          <Upload className="h-4 w-4" aria-hidden /> {lendo ? "Lendo a planilha…" : "Escolher planilha (.xlsx)"}
        </label>
        <input
          id={`${id}-arquivo`} type="file" accept=".xlsx" className="sr-only" disabled={lendo || progresso !== null}
          onChange={(e) => void ler(e.target.files?.[0])}
        />

        {resumo && linhas && (
          <div className="space-y-3">
            <p>
              <strong>{num(resumo.total)}</strong> leads na planilha ·{" "}
              {Object.entries(resumo.porStatus).map(([s, n]) => `${s}: ${num(n)}`).join(" · ")}
            </p>
            <p>
              Em negociação: <strong>{num(emAtendimentoPrevisto)}</strong> vão para {num(casados.length)} corretor(es) do CRM.
              {semCorretor.length > 0 && ` ${num(semCorretor.reduce((t, c) => t + c.leads, 0))} ficam na base (nome sem corretor ativo no CRM).`}
            </p>
            {casados.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold">Quem casou com quem ({casados.length})</summary>
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs">
                  {casados.map((c) => <li key={c.nome}>{c.nome} → <strong>{c.perfil}</strong> ({num(c.leads)})</li>)}
                </ul>
              </details>
            )}
            {semCorretor.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold">Sem corretor no CRM ({semCorretor.length})</summary>
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-muted-foreground">
                  {semCorretor.map((c) => <li key={c.nome}>{c.nome} ({num(c.leads)})</li>)}
                </ul>
              </details>
            )}
            <Button size="sm" disabled={progresso !== null} onClick={() => void importar()}>
              {progresso ? `Importando… ${num(progresso.feitos)} de ${num(progresso.total)}` : `Importar ${num(linhas.length)} leads`}
            </Button>
          </div>
        )}

        {total && (
          <p role="status" className="rounded-xl border border-success/40 bg-success/10 p-3">
            {num(total.inseridos)} leads novos ({num(total.em_atendimento)} em atendimento com o corretor) ·{" "}
            {num(total.duplicados)} já estavam no CRM ou repetidos na planilha
            {total.invalidos > 0 ? ` · ${num(total.invalidos)} sem identificador` : ""}.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
