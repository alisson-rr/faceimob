import medalhaBronze from "@/assets/medalha-bronze.png";
import medalhaOuro from "@/assets/medalha-ouro.png";
import medalhaPrata from "@/assets/medalha-prata.png";

/**
 * O visual dos três primeiros do Game — degradê, medalha e texto —, num lugar
 * só para o pódio (`PodiumCards`) e a tira do cabeçalho (`AppLayout`).
 *
 * Cores FIXAS, não os tokens `gold`/`silver`/`bronze` (prints de 26/09/2026):
 * o topo preto é o mesmo nos dois temas, e os tokens escurecem no claro (ouro
 * vira mostarda). Como o fundo não muda com o tema, o texto também não — nome
 * âmbar e número branco, com sombra onde o degradê clareia.
 *
 * Índice base 0: 0 = ouro, 1 = prata, 2 = bronze. Fora disso não há metal, e
 * quem chama volta ao neutro do tema.
 */
export const DEGRADE_DO_PODIO = [
  "border-[#d4a73a] from-black to-[#e2b43c] shadow-[0_0_14px_rgba(226,180,60,0.45)]",
  "border-[#e5e5e5] from-black to-[#c4c4c4] shadow-[0_0_12px_rgba(255,255,255,0.4)]",
  "border-[#e8793a] from-black to-[#e56f28] shadow-[0_0_12px_rgba(229,111,40,0.45)]",
];

/** Imagens mandadas pelo cliente, com o número já desenhado. */
export const MEDALHA_DO_PODIO = [medalhaOuro, medalhaPrata, medalhaBronze];

export const NOME_NO_PODIO = "text-[#f5b335]";

export const SOMBRA_DO_TEXTO = "[text-shadow:0_1px_3px_rgba(0,0,0,0.75)]";
