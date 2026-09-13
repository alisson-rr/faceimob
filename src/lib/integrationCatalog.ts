/**
 * Slots de credencial que o sistema conhece.
 *
 * Espelha `SECRET_SLOTS` em `supabase/functions/_shared/secrets.ts` — mudou lá,
 * muda aqui — `e2e/admin/integracoes.spec.ts` reprova se um par lido por function
 * ficar sem campo. Cada par é lido por uma function específica, então a lista
 * vive junto do código que a usa; tabela no banco para isso seria cerimônia sem
 * ganho.
 *
 * `envName` é o nome do secret da function usado como fallback enquanto o cofre
 * não está preenchido — aparece na tela para o admin saber o que está
 * substituindo.
 */
/**
 * Formato esperado do valor. Existe porque o cofre aceitava qualquer coisa em
 * qualquer campo — e aceitou: medido em 02/09/2026, `brevo/sender_email`
 * guardava a MESMA chave de 89 caracteres de `brevo/api_key`, colada duas
 * vezes. O envio falhava na Brevo com "remetente inválido", o erro morria no
 * log da edge function e a tela continuava dizendo "configurado".
 *
 * `token` é o padrão: não dá para validar o formato de uma chave de terceiro
 * sem inventar regra que envelhece. Só valida o que tem forma conhecida.
 */
export type IntegrationFormat = "email" | "url" | "digits" | "token";

export type IntegrationSlot = {
  provider: string;
  label: string;
  title: string;
  envName: string;
  usedBy: string;
  help: string;
  formato?: IntegrationFormat;
};

/** Devolve a mensagem do que está errado, ou `null` quando o valor serve. */
export function validarCredencial(formato: IntegrationFormat | undefined, valor: string): string | null {
  const v = valor.trim();
  if (!v) return "Informe um valor.";
  switch (formato) {
    case "email":
      // Deliberadamente frouxo: o que importa é separar e-mail de chave de API,
      // não recusar endereço exótico que a Brevo aceita.
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
        ? null
        : "Isso não parece um e-mail. Use o endereço verificado no Brevo (ex.: dossie@suaempresa.com.br), não a chave de API.";
    case "url":
      try {
        const u = new URL(v);
        return u.protocol === "https:" ? null : "A URL precisa começar com https://.";
      } catch {
        return "Isso não parece uma URL (ex.: https://seu-projeto.supabase.co/functions/v1).";
      }
    case "digits":
      return /^\d{5,}$/.test(v) ? null : "Esperado só números (o ID do número emissor da Meta).";
    default:
      return null;
  }
}

/** Remetente que a conta da Brevo aceita. `ativo` = pronto para enviar. */
export type RemetenteBrevo = { email: string; ativo: boolean };

/**
 * Lê a lista de remetentes que a sonda do Brevo devolveu.
 *
 * Existe porque "remetente inválido" sem alternativa não é um caminho: a Brevo
 * só aceita endereço verificado na conta e essa lista mora só lá. A sonda
 * (`submission-dispatch`, `action: 'probe'`) traz `/v3/senders` junto do
 * veredito, e é isto que transforma a recusa em algo acionável.
 *
 * O payload vem da rede, então nada é presumido — e o filtro por
 * `validarCredencial("email", …)` é a mesma regra que guarda a gravação: se um
 * valor que não é e-mail chegar aqui (foi assim que a chave de API entrou no
 * cofre), ele não vira "endereço aceito" na tela.
 */
export function lerRemetentesDaSonda(payload: unknown): RemetenteBrevo[] {
  const lista = (payload as { remetentes?: unknown } | null | undefined)?.remetentes;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((item) => {
    const bruto = (item as { email?: unknown; ativo?: unknown } | null | undefined);
    const email = typeof bruto?.email === "string" ? bruto.email.trim() : "";
    if (validarCredencial("email", email)) return [];
    return [{ email, ativo: bruto?.ativo === true }];
  });
}

export const INTEGRATION_SLOTS: IntegrationSlot[] = [
  {
    provider: "openai",
    label: "api_key",
    title: "OpenAI — chave de API",
    envName: "OPENAI_API_KEY",
    // A mesma chave serve ao robô, à transcrição dos áudios e às análises de IA
    // do marketing: quem a revoga precisa ler que para tudo isso junto.
    usedBy: "sdr-agent-chat, whatsapp-inbound-webhook, meta-ad-scores, meta-traffic-manager, meta-campaign-planner",
    help: "Agente de SDR, transcrição dos áudios do WhatsApp e as análises de IA do marketing (nota por anúncio, gestor de tráfego e planejador).",
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
    label: "app_secret",
    title: "Meta — app secret (assinatura do webhook)",
    envName: "META_APP_SECRET",
    usedBy: "meta-ads-webhook, whatsapp-inbound-webhook",
    help: "Valida a assinatura X-Hub-Signature-256 de cada evento. Sem ele cadastrado, o webhook aceita POST sem prova de origem.",
  },
  {
    provider: "meta",
    label: "whatsapp_access_token",
    title: "WhatsApp Cloud API — token",
    envName: "META_WHATSAPP_ACCESS_TOKEN",
    // O `notify-dispatch` lê o MESMO par: quem cadastra a chave só para o
    // remarketing precisa saber que está destravando também o aviso de lead
    // perdido por prazo — e quem a revoga, que está parando os dois.
    usedBy: "sdr-whatsapp-broadcast, notify-dispatch",
    help: "Disparo de templates de remarketing pela API oficial e dos avisos de lead perdido por prazo.",
  },
  {
    provider: "meta",
    label: "whatsapp_phone_number_id",
    formato: "digits",
    title: "WhatsApp Cloud API — phone number id",
    envName: "META_WHATSAPP_PHONE_NUMBER_ID",
    usedBy: "sdr-whatsapp-broadcast, notify-dispatch",
    help: "Identificador do número emissor na Cloud API.",
  },
  {
    provider: "meta",
    label: "whatsapp_notify_template",
    title: "WhatsApp Cloud API — nome do template de aviso",
    envName: "META_WHATSAPP_NOTIFY_TEMPLATE",
    usedBy: "notify-dispatch",
    // Sem `formato`: é o NOME de um template aprovado na Meta, e nenhuma regra
    // de forma separa um nome válido de um inválido — quem confere é o envio.
    help: "Template aprovado (categoria Utility) com UMA variável no corpo. Sem ele o aviso sai como texto livre, que a Meta recusa fora da janela de 24 h (código 131047).",
  },
  {
    provider: "meta",
    label: "marketing_access_token",
    title: "Meta — token da Marketing API",
    envName: "META_MARKETING_ACCESS_TOKEN",
    usedBy: "meta-sync, meta-campaign-action, meta-ads-connect, meta-ad-scores, meta-traffic-manager, meta-campaign-planner",
    help: "Token de usuário de sistema com ads_read e ads_management. Lê gasto, resultados e o estado das contas de anúncios e executa pausar, ativar e mudar verba aprovados no CRM.",
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
    formato: "url",
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
    formato: "email",
    title: "Brevo — remetente",
    envName: "BREVO_SENDER_EMAIL",
    usedBy: "_shared/brevo.ts",
    help: "E-mail verificado no Brevo que assina os disparos.",
  },
  // Push do navegador (migration 0143). Os três valores formam UM par: trocar a
  // chave pública invalida toda assinatura já feita, e cada aparelho precisa
  // ativar as notificações de novo.
  {
    provider: "webpush",
    label: "vapid_public_key",
    title: "Push — chave pública VAPID",
    envName: "WEBPUSH_VAPID_PUBLIC_KEY",
    usedBy: "push-dispatch, get_push_public_key (navegador)",
    help: "Ponto P-256 não comprimido (65 bytes) em base64url sem padding. O navegador assina o push com ela, então precisa estar aqui no cofre. Trocar exige que cada aparelho ative as notificações de novo.",
  },
  {
    provider: "webpush",
    label: "vapid_private_key",
    title: "Push — chave privada VAPID",
    envName: "WEBPUSH_VAPID_PRIVATE_KEY",
    usedBy: "push-dispatch",
    help: "Escalar d (32 bytes) em base64url sem padding, par da chave pública acima. Só a edge function lê; nunca vai ao navegador.",
  },
  {
    provider: "webpush",
    label: "vapid_subject",
    title: "Push — contato VAPID",
    envName: "WEBPUSH_VAPID_SUBJECT",
    usedBy: "push-dispatch",
    help: "mailto:ti@suaempresa.com.br — contato que Google, Mozilla e Apple usam se precisarem falar com quem envia os avisos.",
  },
];

export const slotKey = (provider: string, label: string) => `${provider}::${label}`;
