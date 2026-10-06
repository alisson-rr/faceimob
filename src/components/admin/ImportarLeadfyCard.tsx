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

// RPCs da 0188 e 0189, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type Casamento = { nome: string; perfil: string | null };
type Total = { inseridos: number; em_atendimento: number; duplicados: number; invalidos: number };
type Apelido = { nome: string; perfil: string | null; situacao: string };

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
  const [apelidos, setApelidos] = useState<Apelido[] | null>(null);
  const [gravandoApelidos, setGravandoApelidos] = useState(false);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    setTotal(null);
    setApelidos(null);
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

  // O nome curto da Leadfy vira apelido de quem ainda não tem um (0189).
  const gravarApelidos = async () => {
    if (!resumo) return;
    setGravandoApelidos(true);
    try {
      const { data, error } = await untyped.rpc("gravar_apelidos_leadfy", { p_nomes: resumo.corretores });
      if (error) throw dbError("gravar_apelidos_leadfy", error);
      const lista = (data ?? []) as Apelido[];
      setApelidos(lista);
      toast.success("Apelidos gravados", {
        description: `${num(lista.filter((a) => a.situacao === "gravado").length)} corretor(es) ganharam o nome da Leadfy como apelido.`,
      });
    } catch (err) {
      toast.error("Não consegui gravar os apelidos", { description: describeError(err, "Tente de novo.") });
    } finally {
      setGravandoApelidos(false);
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
          Suba a exportação "Leads Todos" da Leadfy. Em negociação ou novo com corretor ativo no CRM vira atendimento dele;
          o resto (arquivados e corretores que não estão no CRM) fica na base, para exportação. Telefone ou
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
              Para os corretores (em negociação e novos): <strong>{num(emAtendimentoPrevisto)}</strong> vão para {num(casados.length)} corretor(es) do CRM.
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
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={progresso !== null} onClick={() => void importar()}>
                {progresso ? `Importando… ${num(progresso.feitos)} de ${num(progresso.total)}` : `Importar ${num(linhas.length)} leads`}
              </Button>
              <Button size="sm" variant="outline" disabled={gravandoApelidos || resumo.corretores.length === 0} onClick={() => void gravarApelidos()}>
                {gravandoApelidos ? "Gravando apelidos…" : "Gravar nomes da Leadfy como apelido"}
              </Button>
            </div>
          </div>
        )}

        {apelidos && <ResultadoApelidos apelidos={apelidos} />}

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

function ResultadoApelidos({ apelidos }: { apelidos: Apelido[] }) {
  const gravados = apelidos.filter((a) => a.situacao === "gravado");
  const jaEram = apelidos.filter((a) => a.situacao === "ja_era");
  const mantidos = apelidos.filter((a) => a.situacao.startsWith("mantido"));
  const sem = apelidos.filter((a) => a.situacao === "sem_corretor");
  return (
    <div role="status" className="space-y-1 rounded-xl border border-success/40 bg-success/10 p-3">
      <p>
        {num(gravados.length)} apelido(s) gravado(s) · {num(jaEram.length)} já estava(m) certo(s) ·{" "}
        {num(mantidos.length)} com outro apelido (mantido) · {num(sem.length)} sem corretor no CRM.
      </p>
      {gravados.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold">Gravados ({gravados.length})</summary>
          <ul className="mt-1 max-h-48 overflow-y-auto text-xs">
            {gravados.map((a) => <li key={a.nome}>{a.perfil} → <strong>{a.nome}</strong></li>)}
          </ul>
        </details>
      )}
      {mantidos.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold">Já tinham outro apelido ({mantidos.length})</summary>
          <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-muted-foreground">
            {mantidos.map((a) => <li key={a.nome}>{a.perfil}: fica "{a.situacao.replace(/^mantido: /, "")}" (Leadfy: {a.nome})</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
