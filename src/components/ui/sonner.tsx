import type { ComponentProps } from "react";
import { CheckCircle2 } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Sucesso no meio da tela; erro e aviso continuam no canto.
 *
 * O sonner 1.7 só aceita posição POR CHAMADA — o `toastOptions` do Toaster não
 * tem `position` —, e as chamadas de sucesso do app importam `toast` direto de
 * "sonner". Trocar a propriedade aqui, no módulo que o App carrega para montar
 * o Toaster, alcança todas elas sem editar tela por tela. O que o chamador
 * passa continua vencendo, então reaplicar a troca (HMR) não muda nada.
 *
 * Erro fica onde estava de propósito: um erro no meio da tela cobre o
 * formulário que a pessoa está corrigindo.
 */
const sucessoNativo = toast.success;
toast.success = (mensagem, opcoes) =>
  // 5 s contra os 4 s padrão do sonner: destaque central que some antes de ser
  // lido é pior que o canto.
  sucessoNativo(mensagem, { position: "top-center", duration: 5000, ...opcoes });

/**
 * O `className` do Toaster vai em CADA lista (o sonner monta uma por posição).
 * As variantes de data-position descem só a lista do sucesso até o meio
 * vertical da tela: "top-center" do sonner é o topo, e o pedido é o meio.
 */
const classeDaLista =
  "toaster group data-[x-position=center]:data-[y-position=top]:top-1/2 data-[x-position=center]:data-[y-position=top]:-translate-y-1/2";

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className={classeDaLista}
    icons={{ success: <CheckCircle2 className="size-5 text-success" aria-hidden /> }}
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
        actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        // Destaque do sucesso: anel e sombra no token `success` (par com
        // contraste garantido nos dois temas), mais respiro e título com peso.
        // Só propriedades que a linha `toast` acima NÃO define — trocar fundo
        // ou borda ali dependeria da ordem em que o Tailwind gera as regras.
        success:
          "group-[.toaster]:rounded-xl group-[.toaster]:px-5 group-[.toaster]:py-4 group-[.toaster]:gap-3 group-[.toaster]:ring-2 group-[.toaster]:ring-success/50 group-[.toaster]:shadow-success/30 [&_[data-icon]]:size-5 [&_[data-title]]:text-base [&_[data-title]]:font-semibold",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
