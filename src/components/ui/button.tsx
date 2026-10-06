import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Botao com o raio de campo (`rounded-xl`, 6 px), o mesmo do input e da barra de
 * abas. Deixou de ser pilula a pedido do cliente (18/09/2026: "nenhum item com
 * o arredondamento grande") — o "Ultimos 30 dias" em pilula foi o exemplo dele.
 * A trava esta em `radius-scale.test.ts`.
 *
 * `default` e `highlight` sao os CTAs: ganham sombra da propria cor e sobem 2px
 * no hover; os demais ficam quietos porque aparecem em tabela e barra de
 * filtro, onde o pulo vira ruido.
 *
 * `highlight` e O botao da tela (um por tela: "Atender agora", "Fazer check-in",
 * "Entrar"): ambar com luz de cima, texto escuro e o brilho parado de
 * `.glow-highlight`, que so existe no tema escuro. O foco e o anel padrao — ele
 * vem depois do brilho no CSS e o substitui enquanto o botao esta focado.
 *
 * `tintInfo`, `tintSuccess` e `tintGold` sao os botoes de acao do sistema
 * anterior (prints de 26/09/2026): fundo escuro com um veu da cor e a borda
 * dela — azul para filtrar, verde para adicionar, ambar para extrair. Texto
 * `foreground`, entao o contraste e o do fundo da tela nos dois temas.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
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
        tintInfo: "border border-primary/60 bg-primary/10 text-foreground hover:bg-primary/20",
        tintSuccess: "border border-success bg-success/10 text-foreground hover:bg-success/20",
        tintGold: "border border-gold/60 bg-gold/10 text-foreground hover:bg-gold/20",
        // Cores por intenção (pedido de 06/10/2026: "está tudo muito azul"):
        // vermelho perde/encerra, verde evolui, amarelo é check-in, laranja
        // devolve. O azul (`default`) fica para ação neutra.
        success: "bg-success text-success-foreground shadow-[0_6px_20px_-8px_hsl(var(--success)/0.7)] hover:bg-success/90 hover:-translate-y-0.5",
        checkin: "bg-gold text-gold-foreground shadow-[0_6px_20px_-8px_hsl(var(--gold)/0.7)] hover:bg-gold/90 hover:-translate-y-0.5",
        devolver: "bg-warning text-warning-foreground shadow-[0_6px_20px_-8px_hsl(var(--warning)/0.7)] hover:bg-warning/90 hover:-translate-y-0.5",
        tintDanger: "border border-destructive/60 bg-destructive/10 text-foreground hover:bg-destructive/20",
        tintWarning: "border border-warning/60 bg-warning/10 text-foreground hover:bg-warning/20",
        // Verde da marca com texto escuro: branco sobre #25D366 não passa contraste.
        whatsapp: "bg-[#25D366] text-[#052e16] shadow-[0_6px_20px_-8px_rgba(37,211,102,0.7)] hover:bg-[#1ebe5a] hover:-translate-y-0.5",
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
