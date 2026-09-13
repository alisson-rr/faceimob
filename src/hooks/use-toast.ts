import type { ReactNode } from "react";
// O `toast` vem de `@/components/ui/sonner` e NÃO do pacote: é lá que sucesso e
// erro ganham som. Importando do pacote, este adaptador dependia de o módulo do
// Toaster já ter sido avaliado para `variant: "success"`/`"destructive"` soarem
// como um `toast.success(...)`/`toast.error(...)` direto — a ordem de carga decidia.
import { toast as sonner } from "@/components/ui/sonner";

type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Todo aviso sai no meio da tela (ver `src/components/ui/sonner.tsx`). O
   * variant decide cor e som: `success` é confirmação de cadastro/gravação e
   * `destructive` é falha — os dois tocam som. `default` é aviso neutro e fica
   * mudo: "Lead em atendimento" ou "Nada a revogar" não confirmam nem recusam
   * nada, e som em todo aviso vira ruído.
   */
  variant?: "default" | "destructive" | "success";
  /**
   * Um botão dentro do aviso. Existe para o caso em que a informação vem com
   * um destino óbvio ("novo lead na fila" → abrir a fila): sem ele, avisos
   * assim viravam diálogo modal só para caber o botão — e diálogo tira a
   * página inteira da árvore de acessibilidade enquanto está aberto.
   */
  action?: { label: string; onClick: () => void };
};

function toast({ title, description, variant, action }: ToastOptions) {
  const message = title || description || "";
  const options = { ...(title && description ? { description } : {}), ...(action ? { action } : {}) };
  const opcoes = Object.keys(options).length > 0 ? options : undefined;
  if (variant === "destructive") return sonner.error(message, opcoes);
  if (variant === "success") return sonner.success(message, opcoes);
  return sonner(message, opcoes);
}

function useToast() {
  return { toast };
}

export { useToast, toast };
