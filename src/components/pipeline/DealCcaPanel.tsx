import { useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { ccaKeys, loadCcaCase, type CcaAnalysis } from "./ccaData";

const CCA_FIELDS: { key: string; label: string; options?: string[] }[] = [
  { key: "tabela", label: "Tabela", options: ["Escolher", "Tabela 1", "Tabela 2"] },
  { key: "fator", label: "Fator", options: ["Escolher", "Sim", "Não"] },
  { key: "cotista", label: "Cotista", options: ["Escolher", "Sim", "Não"] },
  { key: "fgts_futuro", label: "FGTS futuro", options: ["Escolher", "Sim", "Não"] },
  { key: "fgts", label: "FGTS", options: ["Escolher", "Sim", "Não"] },
  { key: "valor_fgts", label: "Valor do FGTS" },
  { key: "valor_fgts_futuro", label: "Valor do FGTS futuro" },
  { key: "valor_avaliacao", label: "Valor de avaliação" },
  { key: "valor_compra_venda", label: "Valor de compra e venda" },
  { key: "financiamento_aprovado", label: "Financiamento aprovado" },
  { key: "subsidio_federal", label: "Subsídio federal" },
  { key: "subsidio_estadual", label: "Subsídio estadual" },
  { key: "referencia_cch", label: "Referência CCH da análise" },
  { key: "renda_aprovada", label: "Renda aprovada" },
  { key: "parcela_aprovada", label: "Parcela aprovada" },
  { key: "prazo", label: "Prazo" },
];

/**
 * Aba CCA do negócio — a análise de crédito guardada em `cca_cases.analysis`.
 *
 * `canEdit` sai de `can("cca.review")`, que é a MESMA expressão da policy
 * `cca_cases_write` (`has_permission('cca.review')`) — e não de
 * `roles.includes('cca')`. Papel e permissão são coisas diferentes: bastava o
 * admin desmarcar `cca.review` na tela de Permissões para o analista continuar
 * com o painel habilitado e a gravação ser descartada pela RLS.
 */
export function DealCcaPanel({ dealId, value, onChange }: {
  dealId: string;
  value: CcaAnalysis;
  /** O mesmo `setState` do pai — a semeadura precisa do updater funcional. */
  onChange: React.Dispatch<React.SetStateAction<CcaAnalysis>>;
}) {
  const { can } = useAuth();
  const id = useId();

  // `useQuery` no lugar do `useState` + `useEffect` com `if (!error && data)`:
  // aquele `if` engolia a falha do SELECT e a aba afirmava "ainda não entrou na
  // esteira" — uma frase sobre o sistema que podia ser simplesmente falsa. E,
  // sem estado de carregamento, a mesma frase piscava na abertura de TODO
  // negócio, inclusive dos que têm caso.
  const query = useQuery({
    queryKey: ccaKeys.case(dealId),
    queryFn: () => loadCcaCase(dealId),
  });
  const caseId = query.data?.id ?? null;

  const canEdit = can("cca.review");
  const disabled = !canEdit || !caseId;

  useEffect(() => {
    const analysis = query.data?.analysis;
    if (!analysis) return;
    // Só semeia com o banco quando o pai ainda não tem nada digitado. A aba é
    // desmontada ao trocar para "Detalhes" e remontada na volta; a semeadura
    // incondicional jogava fora a análise inteira que o analista tinha acabado
    // de preencher — e o "Confirmar alterações" gravava o vazio.
    onChange((current) => (Object.keys(current).length ? current : analysis));
    // `onChange` fica fora das dependências de propósito: é a função de estado
    // do pai e mudaria a cada render, resemeando a cada volta do React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const set = (key: string, next: string) => canEdit && onChange({ ...value, [key]: next });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-primary">Aprovação CCA</h3>
        {!canEdit && (
          <Badge variant="outline" className="border-warning/50 text-xs text-warning">
            Somente leitura — falta a permissão de análise do CCA
          </Badge>
        )}
      </div>

      {query.isPending && <LoadingState variant="kpi" rows={2} label="Carregando a análise…" />}

      {query.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
        >
          <p>{describeError(query.error, "Não consegui carregar a análise do CCA.")}</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Tentar de novo</Button>
        </div>
      )}

      {query.isSuccess && !caseId && (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          Este negócio ainda não entrou na esteira do CCA. Os campos abrem quando ele for enviado
          para análise.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CCA_FIELDS.map((item) => (
          <div key={item.key}>
            <Label htmlFor={`${id}-${item.key}`} className="text-eyebrow">{item.label}</Label>
            {item.options ? (
              <Select value={value[item.key] || ""} onValueChange={(next) => set(item.key, next)} disabled={disabled}>
                <SelectTrigger id={`${id}-${item.key}`} className="mt-1 text-xs">
                  <SelectValue placeholder="Escolher" />
                </SelectTrigger>
                <SelectContent>
                  {item.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${id}-${item.key}`} className="mt-1 text-xs" disabled={disabled}
                value={value[item.key] || ""} onChange={(event) => set(item.key, event.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
