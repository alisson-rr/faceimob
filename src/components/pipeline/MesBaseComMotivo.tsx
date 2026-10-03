import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { displayMonthToIso } from "@/integrations/supabase/newSchema";
import { describeError } from "@/lib/supabaseError";

// RPC da 0201, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

/**
 * Troca do mês-base pelo gerente e pelo diretor (pedido de 03/10/2026), com
 * motivo obrigatório. Vai pela RPC `alterar_mes_base`, que confere quem pode e
 * grava o motivo nos comentários do negócio — o seletor do formulário continua
 * só do admin, que troca sem motivo ao salvar.
 */
export function MesBaseComMotivo({ dealId, atual, opcoes, onTrocado }: {
  dealId: string;
  /** "MM/AAAA" */
  atual: string | undefined;
  opcoes: { value: string; label: string }[];
  onTrocado: (mes: string) => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState<string | undefined>(undefined);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const valido = !!mes && mes !== atual && motivo.trim().length >= 3;

  const confirmar = async () => {
    if (!mes || !valido) return;
    setEnviando(true);
    try {
      const { error } = await untyped.rpc("alterar_mes_base", {
        p_deal_id: dealId,
        p_mes: displayMonthToIso(mes),
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      onTrocado(mes);
      toast.success("Mês-base alterado", { description: "O motivo ficou registrado nos comentários do negócio." });
      setAberto(false);
      await queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (err) {
      toast.error("Não foi possível alterar o mês-base", { description: describeError(err, "Tente de novo em instantes.") });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button
        type="button" variant="outline" size="sm" className="mt-1 h-7 gap-1 text-xs"
        onClick={() => { setMes(undefined); setMotivo(""); setAberto(true); }}
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Alterar com motivo
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => { if (!enviando) setAberto(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar o mês-base</DialogTitle>
            <DialogDescription>
              O mês-base define em qual ciclo o negócio conta. O motivo fica registrado nos comentários.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`${id}-mes`}>Novo mês-base</Label>
              <Select value={mes} onValueChange={setMes}>
                <SelectTrigger id={`${id}-mes`} className="mt-1"><SelectValue placeholder="Escolher o mês" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {opcoes.filter((o) => o.value !== atual).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-motivo`}>Motivo</Label>
              <Textarea
                id={`${id}-motivo`} className="mt-1" rows={3} maxLength={1000}
                placeholder="Ex.: a assinatura do contrato ficou para o mês seguinte"
                value={motivo} onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={enviando} onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" disabled={!valido || enviando} onClick={() => void confirmar()}>
              {enviando ? "Salvando…" : "Alterar mês-base"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
