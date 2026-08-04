/**
 * Slots de credencial que o sistema conhece.
 *
 * Espelha `SECRET_SLOTS` em `supabase/functions/_shared/secrets.ts` — mudou lá,
 * muda aqui. São cinco pares e cada um é lido por uma function específica, então
 * a lista vive junto do código que a usa; tabela no banco para isso seria
 * cerimônia sem ganho.
 *
 * `envName` é o nome do secret da function usado como fallback enquanto o cofre
 * não está preenchido — aparece na tela para o admin saber o que está
 * substituindo.
 */
export type IntegrationSlot = {
  provider: string;
  label: string;
  title: string;
  envName: string;
  usedBy: string;
  help: string;
};

export const INTEGRATION_SLOTS: IntegrationSlot[] = [
  {
    provider: "openai",
    label: "api_key",
    title: "OpenAI — chave de API",
    envName: "OPENAI_API_KEY",
    usedBy: "sdr-agent-chat",
    help: "Agente de SDR que qualifica o lead antes da distribuição.",
  },
  {
    provider: "meta",
    label: "page_access_token",
    title: "Meta — token da página",
    envName: "META_PAGE_ACCESS_TOKEN",
    usedBy: "meta-ads-webhook",
    help: "Lê o formulário de Lead Ads para completar os dados do lead.",
  },
  {
    provider: "meta",
    label: "webhook_verify_token",
    title: "Meta — token de verificação do webhook",
    envName: "META_WEBHOOK_VERIFY_TOKEN",
    usedBy: "meta-ads-webhook",
    help: "Valor combinado com a Meta na configuração do webhook.",
  },
  {
    provider: "meta",
    label: "whatsapp_access_token",
    title: "WhatsApp Cloud API — token",
    envName: "META_WHATSAPP_ACCESS_TOKEN",
    usedBy: "sdr-whatsapp-broadcast",
    help: "Disparo de templates de remarketing pela API oficial.",
  },
  {
    provider: "meta",
    label: "whatsapp_phone_number_id",
    title: "WhatsApp Cloud API — phone number id",
    envName: "META_WHATSAPP_PHONE_NUMBER_ID",
    usedBy: "sdr-whatsapp-broadcast",
    help: "Identificador do número emissor na Cloud API.",
  },
  {
    provider: "voice_ai",
    label: "webhook_secret",
    title: "IA de voz — segredo do webhook",
    envName: "VOICE_AI_WEBHOOK_SECRET",
    usedBy: "voice-ai-webhook",
    help: "Combinado com a plataforma de voz; autentica cada evento recebido.",
  },
  {
    provider: "brevo",
    label: "api_key",
    title: "Brevo — chave de API",
    envName: "BREVO_API_KEY",
    usedBy: "_shared/brevo.ts",
    help: "E-mails transacionais, incluindo o envio do dossiê à construtora.",
  },
  {
    provider: "supabase",
    label: "functions_url",
    title: "Supabase — URL das edge functions",
    envName: "—",
    usedBy: "dispatch_pending_notifications (cron)",
    help: "Ex.: https://<projeto>.supabase.co/functions/v1 — o cron usa para chamar o worker da fila de WhatsApp.",
  },
  {
    provider: "supabase",
    label: "service_role_key",
    title: "Supabase — service role key",
    envName: "—",
    usedBy: "dispatch_pending_notifications (cron)",
    help: "Só o banco lê. Nunca sai para o navegador — a tela grava e nunca devolve.",
  },
  {
    provider: "brevo",
    label: "sender_email",
    title: "Brevo — remetente",
    envName: "BREVO_SENDER_EMAIL",
    usedBy: "_shared/brevo.ts",
    help: "E-mail verificado no Brevo que assina os disparos.",
  },
];

export const slotKey = (provider: string, label: string) => `${provider}::${label}`;
