import { useId, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { corrigirNomeProponente } from "@/integrations/supabase/cca";
import { describeError } from "@/lib/supabaseError";

type Props = {
  dealId: string;
  nome1: string;
  nome2?: string | null;
  temSegundo: boolean;
  /** Nome gravado: o modal atualiza o formulário para não sobrescrever no próximo salvar. */
  onCorrigido: (ordinal: 1 | 2, nome: string) => void;
};

/**
 * Pedido de 12/11/2026: o CCA corrige o nome que o corretor digitou errado.
 * Fica na aba CCA porque o Cadastro trava em mês fechado, onde o CCA trabalha.
 */
export function CorrigirNomeProponentes({ dealId, nome1, nome2, temSegundo, onCorrigido }: Props) {
  const id = useId();
  const [nomes, setNomes] = useState<Record<1 | 2, string>>({ 1: nome1, 2: nome2 ?? "" });
  const [salvando, setSalvando] = useState<1 | 2 | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const originais: Record<1 | 2, string> = { 1: nome1, 2: nome2 ?? "" };
  const ordinais: (1 | 2)[] = temSegundo ? [1, 2] : [1];

  const salvar = async (ordinal: 1 | 2) => {
    setSalvando(ordinal);
    setErro(null);
    try {
      const nome = nomes[ordinal].trim().replace(/\s+/g, " ");
      await corrigirNomeProponente(dealId, ordinal, nome);
      onCorrigido(ordinal, nome);
      toast.success("Nome corrigido", { description: "A correção ficou no histórico do negócio." });
    } catch (err) {
      setErro(describeError(err, "O nome não foi corrigido."));
    } finally {
      setSalvando(null);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-labelledby={`${id}-titulo`}>
      <h3 id={`${id}-titulo`} className="text-sm font-semibold">Nome dos proponentes</h3>
      {ordinais.map((ordinal) => {
        const mudou = nomes[ordinal].trim() !== originais[ordinal].trim() && nomes[ordinal].trim().length >= 2;
        return (
          <div key={ordinal} className="space-y-1">
            <Label htmlFor={`${id}-${ordinal}`} className="text-xs">{ordinal}º proponente</Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-${ordinal}`} value={nomes[ordinal]} maxLength={160} autoComplete="off"
                onChange={(e) => setNomes((atual) => ({ ...atual, [ordinal]: e.target.value }))}
              />
              <Button type="button" variant="outline" disabled={!mudou || salvando !== null} onClick={() => void salvar(ordinal)}>
                {salvando === ordinal && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Corrigir
              </Button>
            </div>
          </div>
        );
      })}
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
    </section>
  );
}
