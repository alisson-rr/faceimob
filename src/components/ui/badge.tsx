import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        highlight: "border-transparent bg-highlight text-highlight-foreground hover:bg-highlight/80",
        outline: "border-border text-foreground",
      },
      /*
       * `sm` existe porque 14 telas escreviam 9 px, altura 4 e padding 1 na mao
       * para caber um selo dentro de uma linha de lista. O tamanho e o mesmo do
       * `default` (12 px, o piso do X07) — o que encolhe e a caixa, nao a
       * letra. Selo nao entra na excecao de 11 px: ele nao e caixa alta.
       */
      size: {
        default: "px-2.5 py-0.5",
        sm: "px-2 py-0 leading-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
