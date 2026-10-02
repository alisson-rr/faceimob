import { useId, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { SectionCard } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { describeError, dbError } from "@/lib/supabaseError";

// RPCs da 0186, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type LinhaDaPrevia = { origem: string; total: number };

const lerPrevia = (data: unknown): LinhaDaPrevia[] =>
  (Array.isArray(data) ? data : []).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return { origem: typeof r.origem === "string" ? r.origem : "Sem origem", total: Number(r.total) || 0 };
  });

/**
 * Limpeza dos leads de teste (0186, pedido de 02/10/2026): apaga os leads que
 * não viraram negócio, com cópia no banco. Mostra a prévia e só apaga com o
 * total digitado — o banco confere de novo e recusa se ele mudou.
 */
export function LimpezaDeLeadsCard() {
  const id = useId();
  const [previa, setPrevia] = useState<LinhaDaPrevia[] | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const total = previa?.reduce((soma, linha) => soma + linha.total, 0) ?? 0;

  const verPrevia = async () => {
    setOcupado(true);
    try {
      const { data, error } = await untyped.rpc("previa_limpeza_de_leads");
      if (error) throw dbError("previa_limpeza_de_leads", error);
      setPrevia(lerPrevia(data));
      setConfirmacao("");
    } catch (err) {
      toast.error("Não foi possível montar a prévia", { description: describeError(err, "Tente de novo.") });
    } finally {
      setOcupado(false);
    }
  };

  const apagar = async () => {
    setOcupado(true);
    try {
      const { data, error } = await untyped.rpc("apagar_leads_sem_negocio", { p_total_confirmado: total });
      if (error) throw dbError("apagar_leads_sem_negocio", error);
      toast.success("Leads apagados", { description: `${Number(data) || 0} lead(s). A roleta recomeça do zero.` });
      setPrevia(null);
      setConfirmacao("");
    } catch (err) {
      toast.error("Nada foi apagado", { description: describeError(err, "Tente de novo.") });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <SectionCard title="Limpar leads de teste">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Apaga todos os leads que não viraram negócio, para recomeçar a distribuição. Os que viraram negócio ficam.
          Uma cópia de cada lead apagado fica guardada no banco.
        </p>
        {previa === null ? (
          <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void verPrevia()}>
            Ver quantos serão apagados
          </Button>
        ) : total === 0 ? (
          <p>Nenhum lead sem negócio. Nada a apagar.</p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1">
              {previa.map((linha) => (
                <li key={linha.origem} className="flex justify-between gap-4 border-b border-border/50 pb-1">
                  <span>{linha.origem}</span><span className="tabular-nums">{linha.total}</span>
                </li>
              ))}
              <li className="flex justify-between gap-4 font-bold"><span>Total</span><span className="tabular-nums">{total}</span></li>
            </ul>
            <div className="space-y-1">
              <Label htmlFor={`${id}-confirma`}>Para confirmar, digite {total}</Label>
              <Input
                id={`${id}-confirma`} inputMode="numeric" className="max-w-[10rem]"
                value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
              />
            </div>
            <Button
              variant="destructive" size="sm"
              disabled={ocupado || confirmacao.trim() !== String(total)}
              onClick={() => void apagar()}
            >
              <Trash2 className="h-4 w-4" /> Apagar {total} lead(s)
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
