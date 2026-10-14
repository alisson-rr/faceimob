/**
 * Qual WhatsApp do celular abre a conversa (pedido de 06/10/2026): o corretor
 * que tem o normal e o Business no mesmo aparelho escolhe um, e a escolha fica
 * neste aparelho.
 *
 * No Android o `intent://` com o pacote abre exatamente o app escolhido. No
 * iPhone e no computador não há como apontar o app: vale o `wa.me`, que abre o
 * WhatsApp padrão do aparelho.
 * ponytail: só o Android respeita a escolha; evoluir se o iOS ganhar um esquema
 * próprio para o Business.
 */
export type AppWhatsapp = "normal" | "business";

const CHAVE = "faceimob:whatsapp-app";

const PACOTE: Record<AppWhatsapp, string> = {
  normal: "com.whatsapp",
  business: "com.whatsapp.w4b",
};

export const APP_WHATSAPP_ROTULO: Record<AppWhatsapp, string> = {
  normal: "WhatsApp",
  business: "WhatsApp Business",
};

export function lerAppWhatsapp(): AppWhatsapp {
  try {
    return localStorage.getItem(CHAVE) === "business" ? "business" : "normal";
  } catch {
    return "normal";
  }
}

export function gravarAppWhatsapp(app: AppWhatsapp): void {
  try {
    localStorage.setItem(CHAVE, app);
  } catch {
    // Sem armazenamento (aba anônima): a escolha vale só agora.
  }
}

export const ehAndroid = (userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent) =>
  /android/i.test(userAgent);

/** Celular ou tablet: só aí o .vcf abre "Adicionar contato"; no computador vira download à toa. */
export const ehCelular = (userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent) =>
  /android|iphone|ipad|ipod/i.test(userAgent);

/**
 * iPhone e iPad (o iPadOS novo se apresenta como Mac, mas tem toque). No Safari
 * deles o .vcf baixado por link temporário cai em "Arquivos" em vez de abrir
 * "Adicionar contato": lá o contato sai pela folha de compartilhar.
 */
export const ehIphone = (
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
  toques: number = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
) => /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && toques > 1);

/** Nome da aba do WhatsApp: todo clique reaproveita ela em vez de abrir uma nova. */
export const JANELA_WHATSAPP = "faceimob-whatsapp";

/**
 * Abre a conversa sempre na MESMA aba (nomeada). Com `_blank` cada clique criava
 * uma aba. `noopener` não serve aqui — ele ignora o nome e abre outra —, então
 * o vínculo com esta página é cortado depois de aberta.
 */
export function abrirWhatsapp(link: string): void {
  const janela = window.open(link, JANELA_WHATSAPP);
  if (!janela) return;
  try {
    janela.opener = null;
  } catch {
    // Navegador que não deixa soltar o vínculo: a aba abre igual.
  }
}

/** Link que abre a conversa com o texto pronto. `numero` só com dígitos e DDI. */
export function linkWhatsapp(numero: string, texto: string, app: AppWhatsapp, android = ehAndroid()): string {
  const msg = encodeURIComponent(texto);
  if (android) {
    return `intent://send/?phone=${numero}&text=${msg}#Intent;scheme=whatsapp;package=${PACOTE[app]};end`;
  }
  return `https://wa.me/${numero}?text=${msg}`;
}
