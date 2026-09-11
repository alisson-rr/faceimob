import type { ReactNode } from "react";
// O `toast` vem de `@/components/ui/sonner` e NÃO do pacote: é lá que o sucesso
// ganha o meio da tela. Importando do pacote, este adaptador dependia de o
// módulo do Toaster já ter sido avaliado para o `variant: "success"` cair no
// mesmo lugar que um `toast.success(...)` direto — a ordem de carga decidia.
import { toast as sonner } from "@/components/ui/sonner";

type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * `success` é confirmação de cadastro/gravação: sai no meio da tela, com
   * destaque (ver `src/components/ui/sonner.tsx`). `default` é aviso neutro e
   * fica no canto — "Lead em atendimento" ou "Nada a revogar" não são
   * confirmação de nada, e o meio da tela cobre a tela que a pessoa usa.
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
