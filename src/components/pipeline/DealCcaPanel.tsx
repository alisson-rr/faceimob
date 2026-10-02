import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { addDealComment } from "./DealCommentsPanel";
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
export function DealCcaPanel({ dealId, value, onChange, onCommentAdded }: {
  dealId: string;
  value: CcaAnalysis;
  /** O mesmo `setState` do pai — a semeadura precisa do updater funcional. */
  onChange: React.Dispatch<React.SetStateAction<CcaAnalysis>>;
  onCommentAdded?: () => void;
}) {
  const { can } = useAuth();
  const id = useId();
  const [comment, setComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

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

  const sendComment = async () => {
    const body = comment.trim();
    if (!body || !canEdit) return;
    setSendingComment(true);
    try {
      await addDealComment(dealId, `CCA — ${body}`);
      setComment("");
      onCommentAdded?.();
      toast({ variant: "success", title: "Comentário do CCA adicionado", description: "Ele já está na aba Comentários." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível adicionar o comentário",
        description: describeError(error, "Tente de novo."),
      });
    } finally {
      setSendingComment(false);
    }
  };

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

      <div className="rounded-xl border border-blue-800/40 bg-blue-950/35 p-3">
        <Label htmlFor={`${id}-comentario`} className="text-eyebrow">Comentário do CCA</Label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          O texto entra no histórico auditado e aparece para todos na aba Comentários.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            id={`${id}-comentario`}
            rows={3}
            maxLength={4000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={!canEdit}
            placeholder="Escreva a orientação, pendência ou decisão do CCA…"
            className="min-h-24 flex-1 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500"
          />
          <Button
            type="button"
            className="self-end"
            disabled={!canEdit || !comment.trim() || sendingComment}
            onClick={() => void sendComment()}
          >
            <Send className="h-4 w-4" /> {sendingComment ? "Enviando…" : "Adicionar aos comentários"}
          </Button>
        </div>
      </div>
    </div>
  );
}
