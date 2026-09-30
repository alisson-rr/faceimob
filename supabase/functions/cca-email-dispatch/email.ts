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
  detalhes?: DetalhesDoNegocio | null;
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

/** Dados do negócio para o e-mail (0177: `email_detalhes_do_negocio`). Tudo texto, tudo opcional. */
export type DetalhesDoNegocio = Partial<Record<
  | "codigo" | "cliente" | "cpf" | "empreendimento" | "construtora" | "status1" | "status2" | "status2_tom"
  | "status2_antes" | "corretor1" | "corretor2" | "gerente1" | "gerente2" | "observacao" | "quando",
  string
>>;

/** Cor do selo do Status 2: a mesma paleta do cadastro de status (`tone`). */
const COR_DO_TOM: Record<string, string> = {
  success: "#16a34a",
  warning: "#d97706",
  info: "#2563eb",
  danger: "#dc2626",
  neutral: "#475569",
  highlight: "#7c3aed",
};

/** CPF com pontuação quando vierem os 11 dígitos; do contrário, como veio. */
export function formatarCpf(cpf: string | null | undefined): string {
  const bruto = umaLinha(cpf);
  const digitos = bruto.replace(/\D/g, "");
  return digitos.length === 11
    ? `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`
    : bruto;
}

/** Origem do app (`https://…`) para os logos; `null` sem endereço válido. */
const origemDoApp = (appUrl: string | null | undefined): string | null => {
  try {
    const url = new URL(umaLinha(appUrl));
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

const celula = (rotulo: string, valor: string, borda: boolean) =>
  `<td width="50%" style="padding:12px 14px;border-bottom:1px solid #eef0f3;${borda ? "border-left:1px solid #eef0f3;" : ""}">` +
  `<div style="color:#6b7280;font-size:11px;">${escapeHtml(rotulo)}</div>` +
  `<div style="color:#111827;font-weight:bold;margin-top:2px;">${escapeHtml(valor)}</div></td>`;

/**
 * E-mail de movimentação (modelo aprovado pelo cliente em 30/09/2026): Status 2
 * em evidência, dados do negócio em grade, observação destacada e o logo.
 *
 * Assunto: STATUS 2 | CLIENTE | CPF | EMPREENDIMENTO | CORRETOR 1 | GERENTE 1 |
 * CORRETOR 2 | GERENTE 2 — o que estiver vazio sai, para não sobrar "| |".
 * O CPF vai completo, como no modelo anterior (decisão do cliente).
 */
export function montarEmailDeMovimento(
  email: CcaMoveEmail,
  appUrl?: string | null,
): { subject: string; html: string } {
  const d = email.detalhes ?? {};
  const pipeline = email.source === "pipeline";
  const codigo = umaLinha(d.codigo ?? email.deal_code) || "negócio sem código";
  const status2 = umaLinha(d.status2) || umaLinha(email.stage_name) || "Sem Status 2";
  const cliente = umaLinha(d.cliente ?? email.client_name) || "Cliente não informado";
  const cpf = formatarCpf(d.cpf);
  const quem = umaLinha(email.actor_name) || "Alguém";
  // Pipeline: a observação escrita na troca. CCA: a mensagem da análise.
  const observacao = (pipeline ? d.observacao ?? "" : email.message ?? "").trim();
  const cor = COR_DO_TOM[umaLinha(d.status2_tom)] ?? COR_DO_TOM.info;
  const link = linkDoPipeline(appUrl);
  const origem = origemDoApp(appUrl);

  const subject = [status2, cliente === "Cliente não informado" ? "" : cliente, cpf, d.empreendimento,
    d.corretor1, d.gerente1, d.corretor2, d.gerente2]
    .map(umaLinha).filter(Boolean).join(" | ");

  const campos: [string, string][] = [
    ["CPF", cpf],
    ["Empreendimento", umaLinha(d.empreendimento)],
    ["Corretor 1", umaLinha(d.corretor1)],
    ["Gerente 1", umaLinha(d.gerente1)],
    ["Corretor 2", umaLinha(d.corretor2)],
    ["Gerente 2", umaLinha(d.gerente2)],
    ["Movido por", quem],
    ["Quando", umaLinha(d.quando)],
  ].filter(([, valor]) => valor) as [string, string][];
  const linhas: string[] = [];
  for (let i = 0; i < campos.length; i += 2) {
    const [a, b] = [campos[i], campos[i + 1]];
    linhas.push(`<tr>${celula(a[0], a[1], false)}${b ? celula(b[0], b[1], true) : '<td style="border-bottom:1px solid #eef0f3;border-left:1px solid #eef0f3;"></td>'}</tr>`);
  }

  const marca = origem
    ? `<img src="${escapeHtml(origem)}/email/logo-faceimob-branco.png" width="170" height="40" alt="Faceimob" style="display:block;border:0;outline:none;">`
    : '<span style="font-size:22px;font-weight:bold;color:#ffffff;">Faceimob</span>';
  const subtitulo = [umaLinha(d.empreendimento), umaLinha(d.construtora)].filter(Boolean).join(" · ");
  const antes = umaLinha(d.status2_antes);
  const status1 = umaLinha(d.status1);

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#e9edf3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9edf3;padding:24px 0;"><tr><td align="center" style="padding:0 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:#1b2a4a;padding:18px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td>${marca}</td>
<td align="right" style="color:#aebbd6;font-size:12px;">${pipeline ? "Pipeline" : "Crédito"} · ${escapeHtml(codigo)}</td>
</tr></table></td></tr>
<tr><td style="padding:28px 28px 8px;">
<div style="font-size:11px;letter-spacing:1.6px;color:#6b7280;font-weight:bold;">STATUS 2</div>
<div style="margin-top:8px;"><span style="display:inline-block;background:${cor};color:#ffffff;font-size:22px;font-weight:bold;padding:10px 18px;border-radius:10px;letter-spacing:.4px;">${escapeHtml(status2)}</span></div>
${antes || status1 ? `<div style="margin-top:10px;font-size:13px;color:#475569;">${antes ? `Antes: <span style="text-decoration:line-through;color:#94a3b8;">${escapeHtml(antes)}</span>` : ""}${antes && status1 ? " &nbsp;·&nbsp; " : ""}${status1 ? `Status 1: <b style="color:#1b2a4a;">${escapeHtml(status1)}</b>` : ""}</div>` : ""}
</td></tr>
<tr><td style="padding:18px 28px 4px;">
<div style="font-size:20px;font-weight:bold;color:#111827;">${escapeHtml(cliente)}</div>
${subtitulo ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">${escapeHtml(subtitulo)}</div>` : ""}
</td></tr>
<tr><td style="padding:14px 28px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;font-size:13px;">${linhas.join("")}</table></td></tr>
${observacao ? `<tr><td style="padding:14px 28px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e6;border-left:4px solid #f5b400;border-radius:8px;"><tr><td style="padding:12px 14px;">
<div style="font-size:11px;letter-spacing:1px;color:#8a6d00;font-weight:bold;">OBSERVAÇÃO</div>
<div style="font-size:14px;color:#3f3a2a;margin-top:4px;">${escapeHtml(observacao).replace(/\r?\n/g, "<br>")}</div>
</td></tr></table></td></tr>` : ""}
<tr><td align="center" style="padding:24px 28px 8px;">${link
    ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#1b2a4a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 26px;border-radius:10px;">Abrir o negócio no FACEIMOB</a>
<div style="font-size:12px;color:#94a3b8;margin-top:8px;">No Pipeline, procure o negócio ${escapeHtml(codigo)}.</div>`
    : `<div style="font-size:13px;color:#475569;">Abra o Pipeline no FACEIMOB e procure o negócio ${escapeHtml(codigo)}.</div>`}</td></tr>
<tr><td style="padding:18px 28px 24px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #f1f5f9;">
${origem ? `<img src="${escapeHtml(origem)}/email/simbolo-faceimob.png" width="28" height="26" alt="" style="display:inline-block;border:0;margin-bottom:6px;"><br>` : ""}
Faceimob Gestão Imobiliária · E-mail automático, não responda.<br>Você recebeu porque participa deste negócio.
</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: subject || `${status2} | ${codigo}`, html };
}
