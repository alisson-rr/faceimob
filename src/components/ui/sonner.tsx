import type { ComponentProps, CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { playSound } from "@/lib/engagement/audio";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Som nos avisos de sucesso e de erro (decisão de 12/09/2026).
 *
 * O sonner não tem gancho de "aviso exibido", e várias telas importam `toast`
 * direto de "sonner". Trocar a propriedade aqui, no módulo que o App carrega
 * para montar o Toaster (e que o `use-toast` usa), alcança todas as chamadas
 * sem editar tela por tela. Aviso, info e neutro ficam mudos: som em todo aviso
 * vira ruído, e os neutros do `EngagementLayer` já tocam o som da comemoração.
 *
 * Se o som sai quem decide é o `audio.ts` (mudo global, rajada de avisos,
 * comemoração soando no mesmo instante). Por isso reaplicar a troca (HMR) só
 * empilha um segundo pedido no mesmo instante, que ele descarta.
 */
const sucessoNativo = toast.success;
const erroNativo = toast.error;
toast.success = (mensagem, opcoes) => {
  playSound("success");
  return sucessoNativo(mensagem, opcoes);
};
toast.error = (mensagem, opcoes) => {
  playSound("error");
  return erroNativo(mensagem, opcoes);
};

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
      success: <CheckCircle2 className="size-5 text-success" aria-hidden />,
      error: <XCircle className="size-5 text-destructive" aria-hidden />,
      warning: <AlertTriangle className="size-5 text-warning" aria-hidden />,
      info: <Info className="size-5 text-info" aria-hidden />,
    }}
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:px-5 group-[.toaster]:py-4 group-[.toaster]:gap-3 [&_[data-icon]]:size-5 [&_[data-title]]:text-base [&_[data-title]]:font-semibold",
        description: "group-[.toast]:text-sm group-[.toast]:text-muted-foreground",
        actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        // 24 px contra os 20 px do sonner: fechar tem de ser fácil. Cores dos
        // tokens porque o padrão do sonner segue o tema "light" dele, não o do app.
        closeButton:
          "group-[.toast]:size-6 group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border group-[.toast]:hover:bg-muted",
        // Realce por tipo: anel, sombra e degradê saindo da esquerda, no token do
        // tipo (par com contraste garantido nos dois temas). Só propriedades que
        // a linha `toast` acima NÃO define — trocar a cor de fundo ou da borda
        // dependeria da ordem em que o Tailwind gera as regras; o degradê é
        // `background-image` e soma com a cor de fundo.
        success:
          "group-[.toaster]:ring-2 group-[.toaster]:ring-success/50 group-[.toaster]:shadow-success/30 bg-gradient-to-r from-success/15 to-transparent to-60%",
        error:
          "group-[.toaster]:ring-2 group-[.toaster]:ring-destructive/60 group-[.toaster]:shadow-destructive/30 bg-gradient-to-r from-destructive/15 to-transparent to-60%",
        warning:
          "group-[.toaster]:ring-2 group-[.toaster]:ring-warning/50 group-[.toaster]:shadow-warning/30 bg-gradient-to-r from-warning/15 to-transparent to-60%",
        // Informação não é alarme: só o anel fino.
        info: "group-[.toaster]:ring-1 group-[.toaster]:ring-info/30",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
