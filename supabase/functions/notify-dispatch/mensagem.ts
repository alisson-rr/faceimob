/**
 * Texto do aviso no WhatsApp (pedido de 02/10/2026): emoji pelo tipo, título em
 * negrito e a assinatura da casa embaixo. Puro, para o vitest cobrir.
 *
 * Negrito e itálico são os do próprio WhatsApp (`*…*`, `_…_`). Título que já
 * começa com emoji (o resumo diário da Meta monta o dele) não ganha outro.
 */
export const ASSINATURA = "_Inteligência Faceimob_";

const EMOJI_POR_TIPO: [RegExp, string][] = [
  [/^lead_(assigned|new)/, "🔔"],
  [/^lead_(lost_)?timeout|^unattended/, "⏰"],
  [/^lead_comment/, "💬"],
  [/^document_review|^esteira/, "📄"],
  [/^cca/, "🏦"],
  [/^deal/, "🏠"],
  [/^task/, "📌"],
  [/^visit/, "📅"],
  [/^game/, "🏆"],
  [/^meta|^cpl/, "📊"],
];

const comecaComEmoji = (texto: string) => /^\p{Extended_Pictographic}/u.test(texto);

export function montarMensagemWhatsApp(aviso: { kind?: string | null; title: string; body?: string | null }): string {
  const titulo = aviso.title.trim();
  const corpo = (aviso.body ?? "").trim();
  const emoji = EMOJI_POR_TIPO.find(([padrao]) => padrao.test(aviso.kind ?? ""))?.[1] ?? "🔔";
  const cabecalho = comecaComEmoji(titulo) ? `*${titulo}*` : `${emoji} *${titulo}*`;
  return [cabecalho, corpo, ASSINATURA].filter(Boolean).join("\n\n");
}
