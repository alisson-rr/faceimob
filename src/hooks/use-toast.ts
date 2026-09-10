import type { ReactNode } from "react";
import { toast as sonner } from "sonner";

type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
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
  const temOpcoes = Object.keys(options).length > 0;
  return variant === "destructive"
    ? sonner.error(message, temOpcoes ? options : undefined)
    : sonner(message, temOpcoes ? options : undefined);
}

function useToast() {
  return { toast };
}

export { useToast, toast };
