import { useCallback, useSyncExternalStore } from "react";
import { audioLiberado, isSoundOn, playSound, subscribeSound, type SoundName } from "@/lib/engagement/audio";

/**
 * Som de premiação — a faixa que o cliente entregou, tocada quando alguém
 * atinge um marco (venda fechada, subida no ranking, meta batida).
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
 *
 * Exportado porque o card de venda dura o trecho inteiro — ver `EngagementLayer`.
 */
export const TRECHO_MS = 7000;
const ESMAECER_MS = 600;
const VOLUME = 0.5;

let elemento: HTMLAudioElement | null = null;
let corte: ReturnType<typeof setTimeout> | undefined;
let fade: ReturnType<typeof setInterval> | undefined;
/** `Date.now()` do começo da última comemoração — a trava de não empilhar. */
let comecouEm = -Infinity;
/** Número do toque atual: a rejeição de um toque já substituído não pode calar o novo. */
let geracao = 0;

function menosEstimulo(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function parar(): void {
  // Todo `pause` rejeita o `play` ainda pendente com AbortError — no recomeço e
  // também no fim do esmaecimento, com a rede lenta. Encerrar a geração aqui é o
  // que faz o `catch` reconhecer essa rejeição como pausa do próprio app, e não
  // tocar o som curto atrasado como se o navegador tivesse recusado a faixa.
  geracao++;
  clearTimeout(corte);
  clearInterval(fade);
  corte = undefined;
  fade = undefined;
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
 * disparo automático, que é o que respeita a trava e o `prefers-reduced-motion`.
 *
 * `sintetizado` é o som do catálogo que entra no lugar da faixa quando ela não
 * cabe (menos movimento) ou não sai (navegador recusou, arquivo falhou). Quem
 * chama passa o som do próprio marco (`CELEBRATION[kind].sound`).
 */
export function tocarPremiacao({ manual = false, sintetizado = "sale" }: { manual?: boolean; sintetizado?: SoundName } = {}): void {
  if (!isSoundOn()) return;
  if (typeof Audio === "undefined") return;

  // Dois marcos dentro do mesmo trecho são UMA comemoração: a venda e a subida
  // no ranking de quem vendeu chegam juntas. A trava é pelo relógio, e não por
  // "a faixa ainda está tocando": o esmaecimento corre em `setInterval`, que
  // aba em segundo plano estica, e a venda seguinte achava a faixa ocupada e
  // ficava muda. Clique na prévia fura a trava — ali a pessoa pediu para ouvir.
  const agora = Date.now();
  if (!manual && agora - comecouEm < TRECHO_MS) return;
  comecouEm = agora;

  // Menos movimento é menos estímulo, não silêncio: o marco automático troca os
  // 7 s da faixa pelo som curto do catálogo. Clique explícito toca a faixa.
  if (!manual && menosEstimulo()) {
    playSound(sintetizado);
    return;
  }

  if (!elemento) {
    elemento = new Audio(FAIXA);
    // `none` é o que garante que os 5 MB não entram na rede em toda sessão que
    // não comemora nada.
    elemento.preload = "none";
  }

  // Nunca duas faixas: é sempre o mesmo elemento, que recomeça do zero, e o
  // esmaecimento do toque anterior (se ainda corria) é cancelado.
  parar();
  const toque = ++geracao;
  corte = setTimeout(esmaecer, Math.max(0, TRECHO_MS - ESMAECER_MS));

  void elemento.play().catch(() => {
    // Rejeição depois de um `parar()` — recomeço ou fim do trecho — é pausa do
    // próprio app (AbortError): parar aqui calaria a faixa nova, e o som curto
    // sairia atrasado sobre o card que já está saindo.
    if (toque !== geracao) return;
    parar();
    // Navegador recusou (sem gesto, ou Safari que exige gesto por elemento),
    // formato não suportado ou arquivo fora do ar: cai no sintetizado, que usa
    // o contexto de áudio. Só se esse contexto já foi liberado por um gesto
    // nesta aba — é o que mantém o carregamento da página mudo. A rejeição em
    // si é esperada, e engoli-la evita `Uncaught (in promise)` no console.
    if (audioLiberado()) playSound(sintetizado);
  });
}

/**
 * `ligado` reflete o mesmo interruptor do `<SoundToggle />` — serve para a tela
 * dizer que o som está mudo antes de a pessoa clicar em "ouvir" e não entender
 * o silêncio.
 */
export function useSomDePremiacao() {
  const ligado = useSyncExternalStore(subscribeSound, isSoundOn, () => true);
  const tocar = useCallback((opcoes?: Parameters<typeof tocarPremiacao>[0]) => tocarPremiacao(opcoes), []);
  return { ligado, tocar };
}
