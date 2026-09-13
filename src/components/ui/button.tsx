import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Botao em pilula (`rounded-full`) — e a forma da linguagem visual, junto com o
 * card de raio grande. `default` e `highlight` sao os CTAs: ganham sombra da
 * propria cor e sobem 2px no hover; os demais ficam quietos porque aparecem em
 * tabela e barra de filtro, onde o pulo vira ruido.
 *
 * `highlight` e O botao da tela (um por tela: "Atender agora", "Fazer check-in",
 * "Entrar"): ambar com luz de cima, texto escuro e o brilho parado de
 * `.glow-highlight`, que so existe no tema escuro. O foco e o anel padrao — ele
 * vem depois do brilho no CSS e o substitui enquanto o botao esta focado.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_6px_20px_-8px_hsl(var(--primary)/0.7)] hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.75)]",
        highlight:
          "bg-highlight bg-gradient-to-b from-white/25 text-highlight-foreground glow-highlight hover:-translate-y-0.5 hover:from-white/40",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-4",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
