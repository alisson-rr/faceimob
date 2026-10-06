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

/** Link que abre a conversa com o texto pronto. `numero` só com dígitos e DDI. */
export function linkWhatsapp(numero: string, texto: string, app: AppWhatsapp, android = ehAndroid()): string {
  const msg = encodeURIComponent(texto);
  if (android) {
    return `intent://send/?phone=${numero}&text=${msg}#Intent;scheme=whatsapp;package=${PACOTE[app]};end`;
  }
  return `https://wa.me/${numero}?text=${msg}`;
}
