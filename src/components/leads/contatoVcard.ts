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

/** O .vcf de um contato qualquer, ou `null` sem telefone. */
export function vcardDe(nomeCompleto: string, telefone: string | null | undefined): string | null {
  const numero = waNumber(telefone);
  if (!numero) return null;
  const nome = escapar(nomeCompleto);
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

/** O .vcf do lead, ou `null` sem telefone. */
export const vcardDoLead = (lead: LeadDoContato) => vcardDe(nomeDoContato(lead), lead.phone);

const nomeDoVcf = (nomeDoArquivo: string) =>
  `${nomeDoArquivo.trim().replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 60) || "contato"}.vcf`;

/** Baixa o .vcf; o celular oferece "Adicionar contato". Sem telefone, não faz nada. */
export function baixarVcard(vcard: string | null, nomeDoArquivo: string): boolean {
  if (!vcard) return false;
  const url = URL.createObjectURL(new Blob([vcard], { type: "text/vcard;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoVcf(nomeDoArquivo);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/**
 * Safari do iPhone: navegar para um `data:text/vcard` abre a tela nativa
 * "Adicionar contato" já preenchida (um toque em Criar grava na agenda). É o máximo
 * que um site alcança: o iOS não deixa página nenhuma gravar contato sozinha. O
 * link temporário (blob) cai em Arquivos; o data URI não. `navegar` existe para o
 * teste, porque o jsdom não navega.
 */
export function abrirCartaoNoSafari(
  vcard: string | null,
  navegar: (url: string) => void = (url) => { window.location.assign(url); },
): "aberto" | "sem-telefone" {
  if (!vcard) return "sem-telefone";
  navegar(`data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`);
  return "aberto";
}

export const abrirCartaoDoLead = (lead: LeadDoContato) => abrirCartaoNoSafari(vcardDoLead(lead));

/**
 * iPhone: o Safari não abre "Adicionar contato" para um .vcf baixado por link
 * temporário, mas a folha de compartilhar abre o cartão com a ação de salvar.
 * Precisa de um toque do usuário; sem suporte a compartilhar arquivo, volta ao
 * download. Devolve o que aconteceu para a tela avisar.
 */
export async function compartilharVcard(
  vcard: string | null, nomeDoArquivo: string,
): Promise<"compartilhado" | "cancelado" | "baixado" | "sem-telefone"> {
  if (!vcard) return "sem-telefone";
  const arquivo = new File([vcard], nomeDoVcf(nomeDoArquivo), { type: "text/vcard" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo] });
      return "compartilhado";
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === "AbortError") return "cancelado";
    }
  }
  baixarVcard(vcard, nomeDoArquivo);
  return "baixado";
}

export const compartilharContato = (lead: LeadDoContato) => compartilharVcard(vcardDoLead(lead), lead.name);

export const baixarContato = (lead: LeadDoContato) => baixarVcard(vcardDoLead(lead), lead.name);
