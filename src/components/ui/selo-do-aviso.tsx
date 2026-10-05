import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TomDoAviso = "primary" | "success" | "destructive" | "warning" | "info" | "gold";

const TONS: Record<TomDoAviso, string> = {
  primary: "bg-primary/15 text-primary ring-primary/35",
  success: "bg-success/15 text-success ring-success/35",
  destructive: "bg-destructive/15 text-destructive ring-destructive/40",
  warning: "bg-warning/15 text-warning ring-warning/35",
  info: "bg-info/15 text-info ring-info/35",
  gold: "bg-gold/20 text-gold ring-gold/40",
};

/**
 * Ícone do aviso dentro de um círculo da cor do tipo, entrando com um giro
 * curto (05/10/2026: "deixe bonitão os popups do CRM"). Sem animação para quem
 * pediu "reduzir movimento".
 */
export function SeloDoAviso({ tom, children }: { tom: TomDoAviso; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full ring-1 [&_svg]:size-5",
        "animate-in zoom-in-50 spin-in-12 duration-500 motion-reduce:animate-none",
        TONS[tom],
      )}
    >
      {children}
    </span>
  );
}
