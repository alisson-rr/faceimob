/**
 * Assunto e corpo do e-mail de movimento da CCA — o ÚNICO lugar do texto.
 *
 * O formato do Bubble ainda não chegou (18/09/2026): quando chegar, muda só
 * este arquivo e a edge é republicada. A fila (`cca_move_emails`, 0155) guarda
 * os campos, não o HTML, então o texto novo vale também para o que já está nela.
 *
 * Arquivo puro (sem `Deno`, sem rede) para o vitest alcançar: tudo que vem do
 * usuário — mensagem, nome da coluna, do cliente, de quem moveu — passa por
 * `escapeHtml` antes de entrar no HTML.
 */

export type CcaMoveEmail = {
  source?: "cca" | "pipeline";
  deal_code: string | null;
  client_name: string | null;
  stage_name: string;
  actor_name: string | null;
  message: string;
};

/** Escapa também as aspas: o link vai dentro de `href="…"`. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Assunto é uma linha só: quebra de linha no nome da coluna não vira cabeçalho. */
const umaLinha = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Link para o Pipeline, o mesmo destino do aviso no sino (`/pipeline`). O app
 * não abre negócio por URL, então o link leva à tela e o código diz qual é.
 * Só `https://`: com qualquer outro esquema (`javascript:`) o link some.
 */
export function linkDoPipeline(appUrl: string | null | undefined): string | null {
  try {
    const url = new URL(umaLinha(appUrl));
    if (url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}/pipeline`;
  } catch {
    return null;
  }
}

export function montarEmailDeMovimento(
  email: CcaMoveEmail,
  appUrl?: string | null,
): { subject: string; html: string } {
  const codigo = umaLinha(email.deal_code) || "negócio sem código";
  const coluna = umaLinha(email.stage_name);
  const quem = umaLinha(email.actor_name) || "Alguém";
  const cliente = umaLinha(email.client_name) || "cliente não informado";
  const link = linkDoPipeline(appUrl);
  const pipeline = email.source === "pipeline";

  return {
    // Mesmo título do aviso no sino (`move_cca_case`).
    subject: `${pipeline ? "Pipeline" : "Crédito"} ${codigo}: ${coluna}`,
    html: [
      `<p>${escapeHtml(quem)} moveu o negócio <b>${escapeHtml(codigo)}</b> (${escapeHtml(cliente)}) ` +
        `para <b>${escapeHtml(coluna)}</b> ${pipeline ? "no Pipeline" : "na análise de crédito"}.</p>`,
      `<p><b>Mensagem:</b><br>${escapeHtml(email.message.trim()).replace(/\r?\n/g, "<br>")}</p>`,
      link
        ? `<p><a href="${escapeHtml(link)}">Abrir o Pipeline no FACEIMOB</a> e procurar o negócio ${escapeHtml(codigo)}.</p>`
        : `<p>Abra o Pipeline no FACEIMOB e procure o negócio ${escapeHtml(codigo)}.</p>`,
    ].join("\n"),
  };
}
