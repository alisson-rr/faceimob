import { useCallback, useSyncExternalStore } from "react";
import { isSoundOn, playSound, subscribeSound } from "@/lib/engagement/audio";

/**
 * Som de premiação — a faixa que o cliente entregou, tocada quando alguém
 * atinge um marco (meta batida, primeira posição).
 *
 * NÃO é um sistema de conquistas: é só o disparo. Quem decide que houve marco
 * é quem chama.
 *
 * O liga/desliga e a persistência são os que o app já tem
 * (`lib/engagement/audio.ts` + `<SoundToggle />` no header): a preferência mora
 * em `localStorage` com try/catch e vale para TODO som do sistema. Um segundo
 * interruptor só para esta faixa seria uma segunda fonte de verdade para a
 * mesma pergunta — "esta pessoa quer som?".
 *
 * O que este módulo acrescenta ao que já existia é o arquivo: os sons do
 * catálogo são osciladores, e a premiação o cliente quis com a faixa dele.
 */

/** Fica em `public/`: nunca entra no bundle e só é baixado no primeiro toque. */
const FAIXA = "/senna.weba";

/**
 * A faixa inteira tem 4min53s. Premiação é um toque curto, não uma música: o
 * trecho toca e sai sozinho. Corte seco no meio soa como falha, então os
 * últimos 600 ms são de esmaecimento.
 */
const TRECHO_MS = 7000;
const ESMAECER_MS = 600;
const VOLUME = 0.5;

let elemento: HTMLAudioElement | null = null;
let corte: ReturnType<typeof setTimeout> | undefined;
let fade: ReturnType<typeof setInterval> | undefined;
let tocando = false;

function menosEstimulo(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function parar(): void {
  clearTimeout(corte);
  clearInterval(fade);
  corte = undefined;
  fade = undefined;
  tocando = false;
  if (!elemento) return;
  elemento.pause();
  elemento.currentTime = 0;
  elemento.volume = VOLUME;
}

function esmaecer(): void {
  const passo = VOLUME / (ESMAECER_MS / 50);
  fade = setInterval(() => {
    if (!elemento || elemento.volume <= passo) {
      parar();
      return;
    }
    elemento.volume = Math.max(0, elemento.volume - passo);
  }, 50);
}

/**
 * Toca o som de premiação. Fora de componente também vale — o `EngagementLayer`
 * chama daqui.
 *
 * `manual` marca o toque que a PESSOA pediu (botão de prévia). O padrão é o
 * disparo automático, que é o que precisa respeitar `prefers-reduced-motion`.
 */
export function tocarPremiacao({ manual = false }: { manual?: boolean } = {}): void {
  if (!isSoundOn()) return;
  // Quem pede menos movimento está pedindo menos estímulo: marco automático não
  // toca. Clique explícito continua tocando — ali o estímulo foi solicitado.
  if (!manual && menosEstimulo()) return;
  // Dois marcos no mesmo instante são UMA comemoração. Sem isto, o rateio de um
  // negócio com três corretores empilhava três faixas.
  if (tocando) return;
  if (typeof Audio === "undefined") return;

  if (!elemento) {
    elemento = new Audio(FAIXA);
    // `none` é o que garante que os 5 MB não entram na rede em toda sessão que
    // não bate meta nenhuma.
    elemento.preload = "none";
    // Formato não suportado (Opus em WebM ainda falha em Safari antigo) ou
    // arquivo fora do ar: cai na fanfarra sintetizada, que não depende de
    // download. Som é sempre reforço — o card e o toast avisam sozinhos.
    elemento.addEventListener("error", () => {
      parar();
      playSound("goal");
    });
  }

  elemento.volume = VOLUME;
  tocando = true;
  corte = setTimeout(esmaecer, Math.max(0, TRECHO_MS - ESMAECER_MS));

  // Sem gesto do usuário na aba o navegador REJEITA o play. Isso é o esperado,
  // não um erro: engolir a rejeição é o que evita `Uncaught (in promise)` no
  // console e o que garante que nada toca sozinho no carregamento da página.
  void elemento.play().catch(() => parar());
}

/**
 * `ligado` reflete o mesmo interruptor do `<SoundToggle />` — serve para a tela
 * dizer que o som está mudo antes de a pessoa clicar em "ouvir" e não entender
 * o silêncio.
 */
export function useSomDePremiacao() {
  const ligado = useSyncExternalStore(subscribeSound, isSoundOn, () => true);
  const tocar = useCallback((opcoes?: { manual?: boolean }) => tocarPremiacao(opcoes), []);
  return { ligado, tocar };
}
