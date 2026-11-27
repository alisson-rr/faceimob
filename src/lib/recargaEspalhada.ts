/**
 * Recarga que junta uma rajada de eventos do Realtime e espalha os clientes no
 * tempo (27/11/2026).
 *
 * Na abertura da roleta saem ~25 entregas e dezenas de "Pegar lead" em poucos
 * segundos. Cada tela aberta (aviso de fila, posição na fila, fila em formação,
 * check-in) recarregava a CADA evento e no mesmo instante que as outras: com ~50
 * pessoas logadas, mais de mil consultas pesadas por minuto esgotavam as
 * conexões do banco — o "Pegar lead" travava e o agendador falhava ("job
 * startup timeout"). Aqui o primeiro evento agenda UMA recarga depois de
 * `esperaMs` mais um sorteio de até `espalharMs`; os eventos da janela entram
 * nela.
 */
export function recargaEspalhada(
  recarregar: () => void,
  esperaMs = 2_000,
  espalharMs = 4_000,
): (() => void) & { cancelar: () => void } {
  let agendada: ReturnType<typeof setTimeout> | undefined;
  const pedir = () => {
    if (agendada) return;
    agendada = setTimeout(() => {
      agendada = undefined;
      recarregar();
    }, esperaMs + Math.random() * espalharMs);
  };
  return Object.assign(pedir, {
    cancelar: () => {
      if (agendada) clearTimeout(agendada);
      agendada = undefined;
    },
  });
}
