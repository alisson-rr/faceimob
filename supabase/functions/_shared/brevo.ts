import { requireSecret } from "./secrets.ts";

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

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = await requireSecret("BREVO_API_KEY");

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
    // A resposta do provedor pode trazer o destinatário; guarda só o status.
    return { ok: false, error: `Brevo respondeu ${res.status}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, messageId: String((data as { messageId?: string }).messageId ?? "") };
}
