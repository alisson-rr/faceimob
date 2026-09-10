import { getSecret } from "./secrets.ts";

/**
 * Envio transacional pelo Brevo (ata 14/07).
 *
 * Escopo mínimo de propósito: um `sendEmail` que a fila de envio à construtora
 * consome. Sem template engine, sem fila própria — `developer_submissions` já é
 * a fila, com status e contador de tentativas.
 */

export type BrevoAttachment = {
  name: string;
  /** URL acessível pelo Brevo — usamos URL assinada de curta duração. */
  url: string;
};

export type SendEmailInput = {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  attachments?: BrevoAttachment[];
  senderName?: string;
  senderEmail: string;
};

export type SendEmailResult = { ok: true; messageId: string } | { ok: false; error: string };

/**
 * Devolve o problema do remetente em uma frase, ou `null` se ele serve.
 *
 * Existe porque "está no cofre" não é o mesmo que "dá para usar": em 02/09/2026
 * `brevo/sender_email` guardava a chave de API da própria Brevo — 89 caracteres
 * começando com `xkeysib`, sem `@`. A tela dizia "no cofre", o worker mandava
 * assim mesmo e a Brevo devolvia um erro genérico de remetente inválido que
 * ninguém lia.
 *
 * A regra é a MESMA de `validarCredencial("email", …)` em
 * `src/lib/integrationCatalog.ts` — deliberadamente frouxa: o objetivo é
 * separar e-mail de chave de API, não recusar endereço exótico que a Brevo
 * aceita. Mudou lá, muda aqui: a tela guarda a gravação nova, esta função
 * guarda o valor que já está gravado.
 */
export function senderEmailProblem(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return "remetente do Brevo ausente no cofre (brevo/sender_email)";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return "brevo/sender_email não é um e-mail. Grave o endereço verificado no painel do Brevo " +
      "(ex.: dossie@suaempresa.com.br), não a chave de API.";
  }
  return null;
}

/** Remetente cadastrado na conta da Brevo. `ativo` = a Brevo aceita enviar por ele. */
export type BrevoSender = { email: string; ativo: boolean };

export type ListSendersResult =
  | { ok: true; senders: BrevoSender[] }
  | { ok: false; status: number; error: string };

/**
 * Lista os remetentes cadastrados na conta (`GET /v3/senders`).
 *
 * Leitura pura: nenhum e-mail sai. É o único caminho que o admin tem para
 * descobrir QUAL endereço serve — a Brevo só aceita remetente verificado na
 * conta dela, e até aqui a recusa chegava na tela como "remetente inválido"
 * sem nenhuma pista do que gravar no lugar.
 *
 * `status` volta junto do erro porque 401 é veredito sobre a chave (a sonda
 * para aí) e qualquer outro código é indisponibilidade do provedor, que não
 * pode mudar o que a sonda responderia sem esta consulta. `status: 0` = a
 * chamada nem saiu (rede).
 */
export async function listSenders(apiKey: string): Promise<ListSendersResult> {
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/senders", {
      headers: { "api-key": apiKey, accept: "application/json" },
    });
  } catch {
    // Sem `catch` a sonda inteira virava 500 quando a rede da function falhava.
    return { ok: false, status: 0, error: "Não foi possível falar com a Brevo para listar os remetentes." };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: res.status === 401
        ? "A Brevo recusou a chave de API. Gere outra e substitua em brevo/api_key."
        : `A Brevo respondeu ${res.status} ao listar remetentes.`,
    };
  }

  const data = await res.json().catch(() => ({})) as { senders?: unknown };
  const bruto = Array.isArray(data.senders) ? data.senders : [];
  const senders = bruto.flatMap((item) => {
    const email = typeof (item as { email?: unknown })?.email === "string"
      ? (item as { email: string }).email.trim().toLowerCase()
      : "";
    // Descarta o que não tem cara de e-mail: a lista vai para a tela e não pode
    // virar um lugar onde um valor de outra natureza apareça como endereço.
    if (senderEmailProblem(email)) return [];
    // A Brevo omite `active` em conta antiga; ausência não é "verificado".
    return [{ email, ativo: (item as { active?: unknown })?.active === true }];
  });
  return { ok: true, senders };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // `getSecret`, não `requireSecret`. A função DECLARA um Result e mesmo assim
  // lançava na primeira linha: no `submission-dispatch` a chamada vive dentro
  // do `try` por dossiê, e o `catch` de lá conta a exceção como TENTATIVA —
  // uma credencial ausente queimava as 5 tentativas de toda a fila em ~50 min
  // e matava dossiê que nunca chegou a ser enviado. Quem falha por falta de
  // configuração devolve o motivo; quem decide o que fazer com ele é o
  // chamador, que é quem sabe se aquilo conta como tentativa.
  const apiKey = await getSecret("BREVO_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      error: "chave da Brevo ausente no cofre (brevo/api_key). Cadastre em Admin → Integrações.",
    };
  }

  // Última fronteira antes da rede. O chamador já checa (e escreve o motivo na
  // linha da fila), mas um remetente inválido que chegue por outro caminho não
  // pode virar uma requisição que a Brevo recusa com erro genérico.
  const problema = senderEmailProblem(input.senderEmail);
  if (problema) return { ok: false, error: problema };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: input.senderName || "FACEIMOB", email: input.senderEmail },
      to: [{ email: input.to }],
      ...(input.cc && input.cc.length > 0 ? { cc: input.cc.map((email) => ({ email })) } : {}),
      subject: input.subject,
      htmlContent: input.html,
      ...(input.attachments && input.attachments.length > 0
        ? { attachment: input.attachments.map((a) => ({ name: a.name, url: a.url })) }
        : {}),
    }),
  });

  if (!res.ok) {
    // A resposta do provedor pode trazer o destinatário; guarda só o status e o
    // código de erro da Brevo, que é o que diz o que consertar.
    const data = await res.json().catch(() => ({})) as { code?: string };
    const codigo = typeof data.code === "string" ? data.code : null;
    if (res.status === 401) {
      return { ok: false, error: "A Brevo recusou a chave de API (brevo/api_key). Gere outra e substitua no cofre." };
    }
    return {
      ok: false,
      error: `Brevo respondeu ${res.status}${codigo ? ` (${codigo})` : ""}`,
    };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, messageId: String((data as { messageId?: string }).messageId ?? "") };
}
