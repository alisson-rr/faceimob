import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Leitura de credencial de integração, com o cofre na frente e `Deno.env` atrás.
 *
 * O cofre (`private.integration_credentials`) existia desde a 0011 e ninguém
 * escrevia nem lia dele: as functions liam `Deno.env` e não havia tela para
 * gravar. Construir só a tela não entregaria o requisito — o admin trocaria a
 * chave e a function continuaria usando a variável de ambiente antiga.
 *
 * O fallback para `Deno.env` é deliberado e temporário: enquanto o admin não
 * cadastrar a chave pela tela, a function segue funcionando com o secret já
 * configurado. Quando o cofre estiver preenchido, o `Deno.env` pode sair.
 *
 * `private` não é exposto pelo PostgREST, então `get_integration_secret` só é
 * alcançável com a service role — o browser não chega nela nem por engano.
 */

/** Pares (provider, label) que o sistema conhece. O mesmo catálogo aparece em
 *  `src/lib/integrationCatalog.ts` para a tela de administração; mudou aqui,
 *  muda lá. Cada par é lido por uma function específica, então a lista vive
 *  junto do código que a usa — tabela no banco para isso seria cerimônia. */
export const SECRET_SLOTS = {
  OPENAI_API_KEY: { provider: "openai", label: "api_key" },
  META_PAGE_ACCESS_TOKEN: { provider: "meta", label: "page_access_token" },
  META_WEBHOOK_VERIFY_TOKEN: { provider: "meta", label: "webhook_verify_token" },
  META_WHATSAPP_ACCESS_TOKEN: { provider: "meta", label: "whatsapp_access_token" },
  META_WHATSAPP_PHONE_NUMBER_ID: { provider: "meta", label: "whatsapp_phone_number_id" },
  VOICE_AI_WEBHOOK_SECRET: { provider: "voice_ai", label: "webhook_secret" },
  BREVO_API_KEY: { provider: "brevo", label: "api_key" },
  BREVO_SENDER_EMAIL: { provider: "brevo", label: "sender_email" },
} as const;

export type SecretName = keyof typeof SECRET_SLOTS;

/** Cliente com service role. A leitura passa por `public.get_integration_secret`
 *  (migration 0016), que só responde a service_role: o schema `private` não é
 *  exposto pelo PostgREST, então nem esta function o alcançaria diretamente. */
function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const cache = new Map<SecretName, string | null>();

/**
 * Devolve o segredo, ou `null` se não houver nem no cofre nem no ambiente.
 *
 * Cache por instância da function: uma invocação típica lê a mesma chave mais
 * de uma vez e o cofre não muda no meio de uma requisição. Instância nova (ou
 * redeploy) relê — trocar a chave pela tela não exige redeploy, mas pode levar
 * alguns minutos para todas as instâncias quentes pegarem o valor novo.
 */
export async function getSecret(name: SecretName): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null;

  const slot = SECRET_SLOTS[name];
  let value: string | null = null;

  try {
    const { data, error } = await adminClient().rpc("get_integration_secret", {
      p_provider: slot.provider,
      p_label: slot.label,
    });
    if (error) throw error;
    if (typeof data === "string" && data.length > 0) value = data;
  } catch (error) {
    // Cofre indisponível não pode derrubar a function: cai para o ambiente.
    // Nunca logar o valor — só o nome do slot.
    console.error(`getSecret(${name}): cofre indisponível, usando Deno.env`, error);
  }

  if (!value) value = Deno.env.get(name) || null;

  cache.set(name, value);
  return value;
}

/** Igual a `getSecret`, mas falha alto quando a credencial não existe em lugar
 *  nenhum — melhor um 500 explícito do que uma chamada à API externa sem token,
 *  que volta como erro genérico de terceiro. */
export async function requireSecret(name: SecretName): Promise<string> {
  const value = await getSecret(name);
  if (!value) {
    throw new Error(
      `Credencial ausente: ${name}. Cadastre em Integrações ou defina o secret da function.`,
    );
  }
  return value;
}
