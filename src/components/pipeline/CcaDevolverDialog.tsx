import { useId, useState } from "react";
import { Undo2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { describeError } from "@/lib/supabaseError";
import type { CcaDeal } from "./ccaData";

/** `devolver_ao_comercial` (0229) ainda não está no types.ts gerado. */
const semTipos = supabase as unknown as SupabaseClient;

/**
 * "Devolver ao comercial" (pedido da CCA em 05/10/2026): o negócio sai da
 * esteira, mantém o Status 2 e volta ao corretor com a mensagem do que falta,
 * para ele completar e reenviar. Abre do card da CCA e da aba Documentos do
 * negócio — o caso parado de meses atrás não aparece no quadro do mês.
 */
export function CcaDevolverDialog({ deal, onClose, onDone }: {
  deal: Pick<CcaDeal, "dealId" | "client">;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const campo = useId();
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const limpa = mensagem.trim();

  const devolver = async () => {
    if (!limpa || enviando) return;
    setEnviando(true);
    try {
      const { error } = await semTipos.rpc("devolver_ao_comercial", { p_deal_id: deal.dealId, p_mensagem: limpa });
      if (error) throw error;
      toast.success("Devolvido ao comercial", { description: `${deal.client} saiu da esteira e o corretor foi avisado.` });
      await onDone();
      onClose();
    } catch (err) {
      toast.error("Não foi possível devolver", { description: describeError(err, "O negócio continua na esteira.") });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-primary" aria-hidden /> Devolver ao comercial
          </DialogTitle>
          <DialogDescription>
            {deal.client} sai da esteira da CCA e volta ao corretor no mesmo status, para completar e reenviar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={campo}>O que falta</Label>
          <Textarea
            id={campo} rows={4} maxLength={2000} value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Ex.: falta o comprovante de residência atualizado."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => void devolver()} disabled={!limpa || enviando}>
            {enviando ? "Devolvendo…" : "Devolver ao comercial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
