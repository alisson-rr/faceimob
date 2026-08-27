import { useCallback, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CcaAnalysis } from "./ccaData";

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
 * `canEdit` sai de `isAdmin || roles.includes('cca')`: papel é N:N em
 * `user_roles`, e o `role === "cca"` que existia aqui negava a edição a quem é
 * CCA **e** gerente — exatamente o caso que o schema foi feito para permitir.
 */
export function DealCcaPanel({ dealId, value, onChange }: {
  dealId: string;
  value: CcaAnalysis;
  onChange: (next: CcaAnalysis) => void;
}) {
  const { isAdmin, roles } = useAuth();
  const id = useId();
  const [caseId, setCaseId] = useState<string | null>(null);

  const canEdit = isAdmin || roles.includes("cca");
  const disabled = !canEdit || !caseId;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("cca_cases").select("id,analysis").eq("deal_id", dealId).maybeSingle();
    if (!error && data) {
      setCaseId(data.id);
      onChange((data.analysis as CcaAnalysis) || {});
    }
    // `onChange` fica fora das dependências de propósito: é a função de estado
    // do pai e mudaria a cada render, refazendo a consulta em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const set = (key: string, next: string) => canEdit && onChange({ ...value, [key]: next });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-primary">Aprovação CCA</h3>
        {!canEdit && (
          <Badge variant="outline" className="border-warning/50 text-xs text-warning">Somente o CCA edita</Badge>
        )}
      </div>

      {!caseId && (
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
