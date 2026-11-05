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

/**
 * Texto da variável {{1}} do modelo aprovado na Meta (`aviso_do_crm`, 05/11/2026).
 * O modelo já diz "Um novo lead foi atribuído a você no CRM Faceimob" e pede o
 * atendimento no prazo; a variável leva só o miolo do aviso. A Meta aprovou o
 * modelo como Utilidade por ser específico de lead novo — mandar outro tipo de
 * aviso por ele trocaria o sentido da mensagem. Por isso devolve null para o
 * resto, e o worker tira da fila sem enviar.
 */
export function parametroDoModelo(aviso: { kind?: string | null; body?: string | null }): string | null {
  if (aviso.kind !== "lead_assigned") return null;
  const corpo = (aviso.body ?? "").trim();
  return corpo || null;
}

const comecaComEmoji =(texto: string) => /^\p{Extended_Pictographic}/u.test(texto);

export function montarMensagemWhatsApp(aviso: { kind?: string | null; title: string; body?: string | null }): string {
  const titulo = aviso.title.trim();
  const corpo = (aviso.body ?? "").trim();
  const emoji = EMOJI_POR_TIPO.find(([padrao]) => padrao.test(aviso.kind ?? ""))?.[1] ?? "🔔";
  const cabecalho = comecaComEmoji(titulo) ? `*${titulo}*` : `${emoji} *${titulo}*`;
  return [cabecalho, corpo, ASSINATURA].filter(Boolean).join("\n\n");
}
