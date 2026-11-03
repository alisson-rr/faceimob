/**
 * Origem de WhatsApp que pode ir para um grupo (0315 `lead_sources.distribution_group_id`):
 * a campanha cadastrada, "todas as não cadastradas" (`whatsapp_ads`) e a
 * conversa sem anúncio (`whatsapp_direto`).
 */
export type OrigemWa = { id: string; label: string; code: string; distribution_group_id: string | null };

export const ehOrigemWa = (o: { code: string; channel: string | null }) =>
  o.channel === "whatsapp" || o.code === "whatsapp_ads" || o.code.startsWith("wa_campanha_");

/** Nome que diz o que a origem pega, e não o código técnico. */
export function rotuloOrigemWa(o: Pick<OrigemWa, "code" | "label">): { titulo: string; detalhe: string } {
  if (o.code === "whatsapp_ads") {
    return { titulo: "Todas as campanhas de WhatsApp não cadastradas", detalhe: "qualquer anúncio de WhatsApp sem cadastro próprio" };
  }
  if (o.code === "whatsapp_direto") {
    return { titulo: "Conversas sem anúncio", detalhe: "quem chama no WhatsApp direto, sem clicar em anúncio" };
  }
  if (o.code.startsWith("wa_campanha_")) {
    return { titulo: o.label.replace(/^WhatsApp\s*·\s*/, ""), detalhe: "campanha de WhatsApp" };
  }
  return { titulo: o.label, detalhe: "origem de WhatsApp" };
}
