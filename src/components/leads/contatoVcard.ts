import type { LeadRecord } from "@/integrations/supabase/leads";
import { waNumber } from "./model";

/**
 * Cartão de contato (.vcf) do lead para salvar no celular num toque (pedido de
 * 04/10/2026): o navegador não grava na agenda sozinho, mas o arquivo abre a
 * tela "Adicionar contato" já preenchida. Nome no formato
 * "Nome | Campanha | Faceimob"; sem campanha, a origem do lead no lugar.
 */
export const IMOBILIARIA = "Faceimob";

type LeadDoContato = Pick<LeadRecord, "name" | "phone" | "campaign_name" | "utm_campaign" | "source">;

/** Texto de vCard 3.0: barra, vírgula, ponto e vírgula e quebra de linha escapados. */
const escapar = (texto: string) =>
  texto.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function nomeDoContato(lead: LeadDoContato): string {
  const campanha = (lead.campaign_name || lead.utm_campaign || lead.source || "").trim();
  return [lead.name.trim() || "Lead", campanha, IMOBILIARIA].filter(Boolean).join(" | ");
}

/** O .vcf do lead, ou `null` sem telefone. */
export function vcardDoLead(lead: LeadDoContato): string | null {
  const numero = waNumber(lead.phone);
  if (!numero) return null;
  const nome = escapar(nomeDoContato(lead));
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:;${nome};;;`,
    `FN:${nome}`,
    `TEL;TYPE=CELL:+${numero}`,
    `ORG:${IMOBILIARIA}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}

/** Baixa o .vcf; o celular oferece "Adicionar contato". Sem telefone, não faz nada. */
export function baixarContato(lead: LeadDoContato): boolean {
  const vcard = vcardDoLead(lead);
  if (!vcard) return false;
  const url = URL.createObjectURL(new Blob([vcard], { type: "text/vcard;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${lead.name.trim().replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 60) || "contato"}.vcf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
