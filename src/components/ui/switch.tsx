import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/*
 * Pilula com bolinha branca, verde quando ligado e vermelha quando desligado —
 * o interruptor do sistema anterior (27/09/2026). O desligado era cinza e
 * passava por "sem estado"; o vermelho voltou a pedido de 10/10/2026. E a
 * excecao ao "sem pilula" de 18/09, cobrada em `radius-scale.test.ts`.
 * Sombra interna na pilula e externa na bolinha dao o relevo 3D (10/10/2026).
 */

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors bg-gradient-to-b shadow-[inset_0_3px_6px_rgba(0,0,0,0.55),inset_0_-1px_2px_rgba(255,255,255,0.25)] data-[state=checked]:bg-success data-[state=checked]:from-success/70 data-[state=checked]:to-success data-[state=unchecked]:bg-destructive data-[state=unchecked]:from-destructive/60 data-[state=unchecked]:to-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white bg-gradient-to-b from-white to-zinc-200 shadow-[0_2px_4px_rgba(0,0,0,0.45)] ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
