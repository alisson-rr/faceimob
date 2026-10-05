import { BellRing } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { SeloDoAviso } from "@/components/ui/selo-do-aviso";
import { fireConfetti } from "@/components/engagement/Confetti";
import { playSound } from "@/lib/engagement/audio";
import { fraseDeSucesso } from "@/lib/engagement/celebrations";

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
const sucessoNativo = sonnerToast.success;
const erroNativo = sonnerToast.error;
/**
 * Sucesso também comemora (05/10/2026, "alegria e motivação"): um confete
 * curto saindo do aviso, no meio da tela, e uma frase de ânimo quando quem
 * chamou não mandou descrição. O confete respeita "reduzir movimento".
 */
sonnerToast.success = (mensagem, opcoes) => {
  playSound("success");
  fireConfetti("burst", { x: 0.5, y: 0.45 });
  return sucessoNativo(mensagem, opcoes?.description ? opcoes : { ...opcoes, description: fraseDeSucesso() });
};
sonnerToast.error = (mensagem, opcoes) => {
  playSound("error");
  return erroNativo(mensagem, opcoes);
};

/**
 * O aviso neutro também ganha selo (sino), que o sonner só dá aos tipados. O
 * `icon` de quem chamou vence. Os métodos (`success`, `error`, `dismiss`…) são
 * os do sonner, já com o som e o confete acima.
 */
const toast = Object.assign(
  (mensagem: Parameters<typeof sonnerToast>[0], opcoes?: Parameters<typeof sonnerToast>[1]) =>
    sonnerToast(mensagem, { icon: <SeloDoAviso tom="primary"><BellRing /></SeloDoAviso>, ...opcoes }),
  sonnerToast,
);

export { toast };
