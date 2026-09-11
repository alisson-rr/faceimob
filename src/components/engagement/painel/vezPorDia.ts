import { format } from "date-fns";

/**
 * "Abre sozinho uma vez por dia" — a conta, fora do React, porque ela decide
 * se a tela do corretor ganha um modal em cima ao entrar no Pipeline.
 *
 * É conveniência POR PESSOA e POR NAVEGADOR, não estado compartilhado: mora no
 * `localStorage` e ninguém precisa saber disso no banco.
 */

const CHAVE = "faceimob-painel-visto";

/** Só `getItem`/`setItem`: é o que o teste precisa dublar. */
type Armazem = Pick<Storage, "getItem" | "setItem">;

/** O dia do RELÓGIO de quem trabalha — o corte do turno não é em UTC. */
export const hojeLocal = (agora: Date = new Date()): string => format(agora, "yyyy-MM-dd");

/**
 * Registra a abertura de hoje e devolve `true` só na PRIMEIRA do dia.
 *
 * Ler e gravar na mesma função é de propósito: com duas chamadas separadas,
 * qualquer caminho que perguntasse sem marcar reabriria o modal na navegação
 * seguinte — o "estorvo no segundo dia" que o cliente pediu para não existir.
 *
 * Armazenamento bloqueado (aba anônima, cookies de terceiros barrados, cota
 * estourada) devolve `false`: sem poder LEMBRAR que já abriu, abrir mesmo assim
 * significaria abrir a cada navegação. Falha para o lado silencioso — o botão
 * "Painel" continua na tela e nada no Pipeline quebra.
 */
export function primeiraAberturaDoDia(
  profileId: string,
  hoje: string,
  armazem?: Armazem,
): boolean {
  const chave = `${CHAVE}:${profileId}`;
  try {
    const store = armazem ?? window.localStorage;
    if (store.getItem(chave) === hoje) return false;
    store.setItem(chave, hoje);
    return true;
  } catch {
    return false;
  }
}

/**
 * Quem ganha o modal sem pedir: só o CORRETOR (decisão do cliente, 10/09/2026).
 *
 * `role` é o papel EFETIVO do `AuthContext` (`primaryRole`), nunca
 * `roles.includes('broker')` — `handle_new_auth_user` dá `broker` a todo perfil
 * novo e nunca retira, então o `includes` responde "sim" para admin, gerente e
 * diretor, e o modal abriria na cara de todo mundo.
 */
export const abreSozinho = (
  role: string,
  profileId: string | null,
  hoje: string = hojeLocal(),
  armazem?: Armazem,
): boolean =>
  role === "broker" && !!profileId && primeiraAberturaDoDia(profileId, hoje, armazem);
