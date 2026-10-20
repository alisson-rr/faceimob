import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { baixarPendenciaContrato } from "./ccaData";

/**
 * Baixa do selo "Pendência no contrato" (0286). Desde 20/10/2026 fica na aba
 * Negócio como um interruptor amarelo "Pendência sanada", só para CCA, admin e
 * sócio (`isAdmin` cobre os dois), e o comentário do que foi sanado é
 * obrigatório — o banco cobra o mesmo (0296). O negócio continua em contrato;
 * só o selo sai, e a equipe do negócio é avisada.
 */
export function BaixaPendenciaContrato({ dealId, onDone }: { dealId: string; onDone?: () => void | Promise<void> }) {
  const { isAdmin, roles } = useAuth();
  const campo = useId();
  const [aberto, setAberto] = useState(false);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [baixada, setBaixada] = useState(false);

  if (!(isAdmin || roles.includes("cca"))) return null;

  if (baixada) {
    return (
      <p className="flex items-center gap-1 rounded-md border border-success/40 bg-success/10 p-2 text-xs text-success">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Pendência sanada: o selo saiu do negócio.
      </p>
    );
  }

  const texto = comentario.trim();
  const darBaixa = async () => {
    if (!texto) return;
    setEnviando(true);
    try {
      await baixarPendenciaContrato(dealId, texto);
      setBaixada(true);
      toast({ variant: "success", title: "Pendência sanada", description: "O selo saiu e a equipe do negócio foi avisada." });
      await onDone?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Não foi possível dar baixa na pendência",
        description: describeError(e, "O selo continua no negócio."),
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-warning/60 bg-warning/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${campo}-sanada`} className="flex items-center gap-1 text-xs font-semibold text-warning">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Pendência no contrato — marcar como sanada
        </Label>
        <Switch
          id={`${campo}-sanada`}
          checked={aberto}
          onCheckedChange={setAberto}
          disabled={enviando}
          className="data-[state=checked]:bg-warning data-[state=checked]:from-warning/70 data-[state=checked]:to-warning data-[state=unchecked]:bg-warning/30 data-[state=unchecked]:from-warning/20 data-[state=unchecked]:to-warning/40"
        />
      </div>
      {aberto && (
        <>
          <div className="space-y-1">
            <Label htmlFor={campo} className="text-xs">O que foi sanado *</Label>
            <Textarea
              id={campo}
              value={comentario}
              onChange={(event) => setComentario(event.target.value)}
              rows={2}
              maxLength={500}
              required
              className="text-xs"
              placeholder="Ex.: assinatura do cônjuge recolhida"
            />
          </div>
          <Button
            size="sm"
            className="h-8 gap-1 bg-warning text-xs text-warning-foreground hover:bg-warning/90"
            disabled={enviando || !texto}
            onClick={() => void darBaixa()}
          >
            {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Confirmar e tirar o selo
          </Button>
        </>
      )}
    </div>
  );
}
