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
  /**
   * Onde conseguir o valor (pedido de 28/09/2026): o caminho em uma frase e,
   * quando ele mora no painel de um provedor, o link direto para lá. Valor que
   * não vem de fora (combinado, gerado pelo sistema, arquivo da VPS) fica sem
   * link — um link genérico ali mandaria procurar o que não existe.
   */
  ondePegar: { passos: string; link?: { url: string; rotulo: string } };
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
    ondePegar: { passos: "Painel da OpenAI › API keys › “Create new secret key”. A chave aparece uma vez só: copie antes de fechar.", link: { url: "https://platform.openai.com/api-keys", rotulo: "Abrir API keys da OpenAI" } },
  },
  {
    provider: "meta",
    label: "page_access_token",
    title: "Meta — token da página principal",
    envName: "META_PAGE_ACCESS_TOKEN",
    usedBy: "meta-ads-webhook",
    help: "Lê o formulário de Lead Ads da página principal. Continua aceito para compatibilidade.",
    ondePegar: { passos: "Configurações do negócio › Usuários do sistema › gerar token com a página e o app, permissões leads_retrieval, pages_show_list, pages_read_engagement e pages_manage_metadata. Token de usuário do sistema não expira.", link: { url: "https://business.facebook.com/settings/system-users", rotulo: "Abrir usuários do sistema da Meta" } },
  },
  {
    provider: "meta",
    label: "page_access_tokens",
    title: "Meta — tokens das páginas de Lead Ads",
    envName: "META_PAGE_ACCESS_TOKENS_JSON",
    usedBy: "meta-ads-webhook, meta-ads-connect",
    help: "Recebe leads de várias Páginas no mesmo webhook. Cole um JSON com page_id, name e access_token de cada página.",
    ondePegar: { passos: "Use tokens de Página permanentes, um por página, no formato [{\"page_id\":\"123\",\"name\":\"Faceimob\",\"access_token\":\"...\"}]. Cada página precisa das permissões leads_retrieval, pages_read_engagement e pages_manage_metadata." },
  },
  {
    provider: "meta",
    label: "webhook_verify_token",
    title: "Meta — token de verificação do webhook",
    envName: "META_WEBHOOK_VERIFY_TOKEN",
    usedBy: "meta-ads-webhook",
    help: "Valor combinado com a Meta na configuração do webhook.",
    ondePegar: { passos: "Não vem da Meta: crie uma senha longa, cole aqui e cole a MESMA em Meta for Developers › seu app › Webhooks › “Verificar token”.", link: { url: "https://developers.facebook.com/apps/", rotulo: "Abrir apps na Meta for Developers" } },
  },
  {
    provider: "meta",
    label: "app_secret",
    title: "Meta — app secret (assinatura do webhook)",
    envName: "META_APP_SECRET",
    usedBy: "meta-ads-webhook, whatsapp-inbound-webhook",
    help: "Valida a assinatura X-Hub-Signature-256 de cada evento. Sem ele cadastrado, o webhook aceita POST sem prova de origem.",
    ondePegar: { passos: "Meta for Developers › seu app › Configurações do app › Básico › “Chave secreta do app” (clique em Mostrar).", link: { url: "https://developers.facebook.com/apps/", rotulo: "Abrir apps na Meta for Developers" } },
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
    ondePegar: { passos: "Configurações do negócio › Usuários do sistema › gerar token com o app do WhatsApp e as permissões whatsapp_business_messaging e whatsapp_business_management.", link: { url: "https://business.facebook.com/settings/system-users", rotulo: "Abrir usuários do sistema da Meta" } },
  },
  {
    provider: "meta",
    label: "whatsapp_phone_number_id",
    formato: "digits",
    title: "WhatsApp Cloud API — phone number id",
    envName: "META_WHATSAPP_PHONE_NUMBER_ID",
    usedBy: "sdr-whatsapp-broadcast, notify-dispatch",
    help: "Identificador do número emissor na Cloud API.",
    ondePegar: { passos: "Gerenciador do WhatsApp › Números de telefone › clique no número emissor: o “ID do número de telefone” só tem dígitos (não é o número em si).", link: { url: "https://business.facebook.com/wa/manage/phone-numbers/", rotulo: "Abrir números do WhatsApp" } },
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
    ondePegar: { passos: "Gerenciador do WhatsApp › Modelos de mensagem: copie o NOME de um modelo aprovado, categoria Utilidade, com uma variável no corpo.", link: { url: "https://business.facebook.com/wa/manage/message-templates/", rotulo: "Abrir modelos do WhatsApp" } },
  },
  {
    provider: "meta",
    label: "marketing_access_token",
    title: "Meta — token da Marketing API",
    envName: "META_MARKETING_ACCESS_TOKEN",
    usedBy: "meta-sync, meta-campaign-action, meta-ads-connect, meta-ad-scores, meta-traffic-manager, meta-campaign-planner",
    help: "Token de usuário de sistema com ads_read e ads_management. Lê gasto, resultados e o estado das contas de anúncios e executa pausar, ativar e mudar verba aprovados no CRM.",
    ondePegar: { passos: "Configurações do negócio › Usuários do sistema › dar ao usuário acesso às contas de anúncios e gerar token com ads_read e ads_management.", link: { url: "https://business.facebook.com/settings/system-users", rotulo: "Abrir usuários do sistema da Meta" } },
  },
  {
    provider: "voice_ai",
    label: "webhook_secret",
    title: "IA de voz — segredo do webhook",
    envName: "VOICE_AI_WEBHOOK_SECRET",
    usedBy: "voice-ai-webhook",
    help: "Combinado com a plataforma de voz; autentica cada evento recebido.",
    ondePegar: { passos: "Não vem de um site: crie uma senha longa, cole aqui e entregue a MESMA ao fornecedor da IA de voz, junto do contrato em docs/integracoes/voice-ai-webhook.md." },
  },
  {
    provider: "brevo",
    label: "api_key",
    title: "Brevo — chave de API",
    envName: "BREVO_API_KEY",
    usedBy: "_shared/brevo.ts",
    help: "E-mails transacionais: o envio do dossiê à construtora e o e-mail das movimentações da CCA.",
    ondePegar: { passos: "Brevo › Configurações › SMTP e API › aba “Chaves de API” › “Gerar nova chave” (começa com xkeysib-).", link: { url: "https://app.brevo.com/settings/keys/api", rotulo: "Abrir chaves de API da Brevo" } },
  },
  {
    provider: "supabase",
    label: "functions_url",
    formato: "url",
    title: "Supabase — URL das edge functions",
    envName: "—",
    usedBy: "dispatch_pending_notifications (cron)",
    help: "Ex.: https://<projeto>.supabase.co/functions/v1 — o cron usa para chamar o worker da fila de WhatsApp.",
    ondePegar: { passos: "Neste servidor é https://app.faceimob.com.br/functions/v1 — o endereço do CRM seguido de /functions/v1." },
  },
  {
    provider: "supabase",
    label: "service_role_key",
    title: "Supabase — service role key",
    envName: "—",
    usedBy: "dispatch_pending_notifications (cron)",
    help: "Só o banco lê. Nunca sai para o navegador — a tela grava e nunca devolve.",
    ondePegar: { passos: "Não fica em painel web: é o SERVICE_ROLE_KEY do arquivo /opt/faceimob/supabase/.env na VPS. Peça a quem tem acesso SSH." },
  },
  {
    provider: "brevo",
    label: "sender_email",
    formato: "email",
    title: "Brevo — remetente",
    envName: "BREVO_SENDER_EMAIL",
    usedBy: "_shared/brevo.ts",
    help: "E-mail verificado no Brevo que assina os disparos.",
    ondePegar: { passos: "Brevo › Remetentes, domínios e IPs › Remetentes: use um e-mail com status verificado.", link: { url: "https://app.brevo.com/senders/list", rotulo: "Abrir remetentes da Brevo" } },
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
    ondePegar: { passos: "Não vem de fora: o par VAPID é gerado pelo próprio servidor (push-dispatch) e gravado aqui. Só preencha para trocar o par." },
  },
  {
    provider: "webpush",
    label: "vapid_private_key",
    title: "Push — chave privada VAPID",
    envName: "WEBPUSH_VAPID_PRIVATE_KEY",
    usedBy: "push-dispatch",
    help: "Escalar d (32 bytes) em base64url sem padding, par da chave pública acima. Só a edge function lê; nunca vai ao navegador.",
    ondePegar: { passos: "Não vem de fora: nasce junto da chave pública, gerada pelo servidor. Só preencha para trocar o par, e sempre junto da pública." },
  },
  {
    provider: "webpush",
    label: "vapid_subject",
    title: "Push — contato VAPID",
    envName: "WEBPUSH_VAPID_SUBJECT",
    usedBy: "push-dispatch",
    help: "mailto:ti@suaempresa.com.br — contato que Google, Mozilla e Apple usam se precisarem falar com quem envia os avisos.",
    ondePegar: { passos: "Não vem de um site: é só um e-mail de contato da empresa escrito como mailto:ti@suaempresa.com.br." },
  },
  // Migração do site para a VPS (docs/migracao-site.md). Os dois somem depois
  // da virada do domínio.
  {
    provider: "site",
    label: "migracao_url",
    formato: "url",
    title: "Site — endereço da exportação",
    envName: "SITE_MIGRACAO_URL",
    usedBy: "site-import",
    help: "https://faceimob.com.br/api/migracao/exportar — a rota do site que entrega os dados para a cópia.",
    ondePegar: { passos: "É o endereço do site publicado seguido de /api/migracao/exportar." },
  },
  {
    provider: "site",
    label: "migracao_token",
    title: "Site — token da exportação",
    envName: "SITE_MIGRACAO_TOKEN",
    usedBy: "site-import",
    help: "O mesmo valor gravado no secret MIGRACAO_TOKEN do Lovable. Sem ele a rota do site não responde.",
    ondePegar: { passos: "Gere um valor longo e aleatório, grave aqui e em Lovable › Cloud › Secrets como MIGRACAO_TOKEN." },
  },
];

export const slotKey = (provider: string, label: string) => `${provider}::${label}`;
