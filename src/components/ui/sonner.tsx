import type { ComponentProps, CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Toaster as Sonner } from "sonner";
import { SeloDoAviso } from "@/components/ui/selo-do-aviso";
import { toast } from "@/components/ui/toast-faceimob";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Todo aviso no meio da tela: sucesso, erro, aviso, info e neutro.
 *
 * O `position` do Toaster é a posição de toda chamada que não pede outra, e o
 * que o chamador passa continua vencendo. "top-center" do sonner é o topo: a
 * classe da lista (vai em CADA lista, uma por posição) desce a do centro até o
 * meio vertical, descontando metade de `--front-toast-height`, a altura do
 * aviso da frente que o próprio sonner escreve na lista.
 *
 * Por `top`, e não pelo `-translate-y-1/2` de antes: o translate do Tailwind
 * reescreve o `transform` inteiro e apagava o `translateX(-50%)` com que o
 * sonner centraliza na horizontal — no desktop o aviso saía com a borda
 * esquerda no meio da tela. Até 600 px o sonner troca o centro por
 * `left`/`right` com largura cheia, e isso segue valendo.
 *
 * Erro no meio da tela pode cobrir o campo que a pessoa está corrigindo — era o
 * motivo de o erro ficar no canto até 11/09. A contrapartida é o botão de
 * fechar e a duração de 5 s.
 *
 * `pointer-events-auto`: com diálogo modal aberto o Radix põe
 * `pointer-events: none` no body e a lista herdava. O X não respondia e o clique
 * caía no overlay, que fecha o diálogo e perde o formulário. Com o clique no
 * aviso, quem impede o fechamento é o `DialogContent` (`ui/dialog.tsx`).
 */
const classeDaLista =
  "toaster group pointer-events-auto data-[x-position=center]:data-[y-position=top]:top-[calc(50%-var(--front-toast-height)/2)]";

/**
 * 440 px contra os 356 px do sonner. `--width` é escrita inline pelo sonner na
 * lista, e a lista e cada aviso a usam como largura; o `style` do Toaster entra
 * depois dela. Cast porque `CSSProperties` não tipa variável CSS.
 */
const larguraDaLista = { "--width": "440px" } as CSSProperties;

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    position="top-center"
    // 5 s contra os 4 s padrão: aviso no meio da tela que some antes de ser
    // lido é pior que o canto.
    duration={5000}
    closeButton
    className={classeDaLista}
    style={larguraDaLista}
    icons={{
      success: <SeloDoAviso tom="success"><CheckCircle2 /></SeloDoAviso>,
      error: <SeloDoAviso tom="destructive"><XCircle /></SeloDoAviso>,
      warning: <SeloDoAviso tom="warning"><AlertTriangle /></SeloDoAviso>,
      info: <SeloDoAviso tom="info"><Info /></SeloDoAviso>,
    }}
    toastOptions={{
      classNames: {
        // Cartão com faixa de cor à esquerda, brilho da mesma cor saindo dela e
        // anel fino (05/10/2026: "deixe bonitão os popups do CRM"). A cor é a
        // variável `--toast-accent`: o tipo define a dele (abaixo) e um aviso
        // especial (lead, queda) troca pelo `style`, que vence a classe — sem
        // duas classes de cor brigando pela ordem do Tailwind.
        toast:
          "group toast relative overflow-hidden group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-2xl group-[.toaster]:rounded-2xl group-[.toaster]:pl-6 group-[.toaster]:pr-10 group-[.toaster]:py-4 group-[.toaster]:gap-4 " +
          "ring-1 ring-[hsl(var(--toast-accent)/0.45)] bg-gradient-to-r from-[hsl(var(--toast-accent)/0.18)] via-[hsl(var(--toast-accent)/0.05)] to-transparent " +
          "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-[hsl(var(--toast-accent))] " +
          "[&_[data-icon]]:size-10 [&_[data-icon]]:m-0 [&_[data-title]]:font-display [&_[data-title]]:text-base [&_[data-title]]:font-bold",
        description: "group-[.toast]:text-sm group-[.toast]:text-muted-foreground",
        // `!` porque o sonner pinta o botão por estilo próprio (`[data-button]`),
        // que saía preto por cima do tema.
        actionButton:
          "!bg-primary !text-primary-foreground !font-semibold !rounded-lg !h-8 !px-3 hover:!bg-primary/90",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        // 24 px contra os 20 px do sonner: fechar tem de ser fácil. Cores dos
        // tokens porque o padrão do sonner segue o tema "light" dele, não o do app.
        // No canto direito: no esquerdo (padrão do sonner) ele cobria a faixa de cor.
        closeButton:
          "group-[.toast]:size-6 group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border group-[.toast]:hover:bg-muted !left-auto !right-1.5 !top-1.5 !transform-none",
        success: "[--toast-accent:var(--success)]",
        error: "[--toast-accent:var(--destructive)]",
        warning: "[--toast-accent:var(--warning)]",
        info: "[--toast-accent:var(--info)]",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
