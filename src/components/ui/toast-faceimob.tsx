import { BellRing } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { SeloDoAviso } from "@/components/ui/selo-do-aviso";
import { fireConfetti } from "@/components/engagement/Confetti";
import { playSound } from "@/lib/engagement/audio";
import { fraseDeSucesso } from "@/lib/engagement/celebrations";

/**
 * Preferência de avisos de sucesso guardada no aparelho.
 *
 * Padrão ligado (`true`). Quando desligado, sucesso não mostra bolha, som nem
 * confete — exceto os críticos de pipeline (movimentação do negócio e envio ao
 * gerente/CCA), que ficam sempre ativos porque confirmam ação irreversível ou
 * mudança de responsabilidade. Erro nunca é silenciado.
 */
const CHAVE_PREFERENCIA = "faceimob:avisos-sucesso";
const lerPreferenciaSucesso = (): boolean => {
  try {
    const valor = localStorage.getItem(CHAVE_PREFERENCIA);
    return valor !== "desligado";
  } catch {
    return true;
  }
};
export const setPreferenciaAvisosSucesso = (ligado: boolean): void => {
  try {
    localStorage.setItem(CHAVE_PREFERENCIA, ligado ? "ligado" : "desligado");
  } catch {
    // Storage indisponível (SSR/teste): preferência cai no padrão.
  }
};

/**
 * Mensagens de sucesso que NUNCA são silenciadas, mesmo com a preferência
 * desligada. São confirmações de ações críticas do pipeline: mover negócio,
 * enviar para análise/gerente/CCA, devolver, reativar, reabrir. Sem elas o
 * corretor perde a certeza de que a ação aconteceu.
 */
const EXCECOES_SUCESSO: RegExp[] = [
  /^Negócio movido para /i,
  /^Negócio em /i,
  /^Negócio reaberto$/i,
  /^Negócio reativado$/i,
  /^Enviado para análise$/i,
  /^Caso movido para /i,
  /^Devolvido ao comercial$/i,
  /^Proposta reativada$/i,
  /^Construtora trocada$/i,
  /^Negócio assinado$/i,
  /^Documentos enviados ao gerente$/i,
  /^Documentos aprovados$/i,
  /^Documentos devolvidos ao corretor$/i,
  / registrada$/i, // Queda/Distrato/OFF registrada
];
const ehExcecaoSucesso = (mensagem: string): boolean =>
  EXCECOES_SUCESSO.some((regex) => regex.test(mensagem));

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
 *
 * Com a preferência desligada (14/10/2026), sucesso comum fica mudo e sem
 * bolha — só as exceções do pipeline mantêm som, confete e bolha.
 */
sonnerToast.success = (mensagem, opcoes) => {
  const preferenciaLigada = lerPreferenciaSucesso();
  const textoMensagem = typeof mensagem === "string" ? mensagem : "";
  const ehExcecao = textoMensagem.length > 0 && ehExcecaoSucesso(textoMensagem);
  if (!preferenciaLigada && !ehExcecao) return undefined;
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
