import { supabase } from "./client";
import { listIntegrations, setIntegrationSecret, type IntegrationRecord } from "./integrations";
import { dbError } from "@/lib/supabaseError";

export type ThreeCConfig = {
  enabled: boolean;
  integration_user_id: string | null;
  allowed_group_ids: string[];
  default_group_id: string | null;
  agenda_ids: string[];
  outcomes: string[];
};

export const emptyThreeCConfig = (): ThreeCConfig => ({
  enabled: false, integration_user_id: null, allowed_group_ids: [], default_group_id: null,
  agenda_ids: [], outcomes: ["agendado", "nao_qualificado", "sem_interesse"],
});

export const threeCConfig = (record?: Pick<IntegrationRecord, "config">): ThreeCConfig => {
  const config = record?.config ?? {};
  const defaults = emptyThreeCConfig();
  return {
    enabled: config.enabled === true,
    integration_user_id: typeof config.integration_user_id === "string" ? config.integration_user_id : null,
    allowed_group_ids: Array.isArray(config.allowed_group_ids) ? config.allowed_group_ids.filter((value): value is string => typeof value === "string") : [],
    default_group_id: typeof config.default_group_id === "string" ? config.default_group_id : null,
    agenda_ids: Array.isArray(config.agenda_ids) ? config.agenda_ids.filter((value): value is string => typeof value === "string") : [],
    outcomes: Array.isArray(config.outcomes) ? config.outcomes.filter((value): value is string => typeof value === "string") : defaults.outcomes,
  };
};

export async function loadThreeCIntegration(): Promise<IntegrationRecord | undefined> {
  return (await listIntegrations()).find((row) => row.provider === "3c" && row.label === "api_token");
}

export type ThreeCOptions = { groups: { id: string; name: string }[]; brokers: { id: string; name: string }[] };

export async function listThreeCOptions(): Promise<ThreeCOptions> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: "integracao_3c_options",
  ) => Promise<{ data: ThreeCOptions | null; error: { code?: string; message: string } | null }>)("integracao_3c_options");
  if (error) throw dbError("listar grupos e agendas da 3C", error);
  return data ?? { groups: [], brokers: [] };
}

export function threeCConfigProblem(config: ThreeCConfig): string | null {
  if (!config.allowed_group_ids.length) return "Selecione os grupos de leads autorizados.";
  if (!config.default_group_id || !config.allowed_group_ids.includes(config.default_group_id)) {
    return "Selecione o grupo de entrada entre os grupos autorizados.";
  }
  if (!config.agenda_ids.length) return "Selecione pelo menos uma agenda de corretor.";
  if (!config.outcomes.length || config.outcomes.some((outcome) => !/^[a-z][a-z0-9_]*$/.test(outcome))) {
    return "Informe os desfechos com letras minúsculas e sublinhado, sem espaços.";
  }
  return null;
}

export async function configureThreeC(config: ThreeCConfig): Promise<ThreeCConfig> {
  // A identidade pertence ao servidor; o formulário nunca a troca.
  const { integration_user_id: _identity, ...settings } = config;
  const { data, error } = await (supabase.rpc as unknown as (
    name: "configure_integracao_3c", args: { p_config: typeof settings },
  ) => Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }>)(
    "configure_integracao_3c", { p_config: settings },
  );
  if (error) throw dbError("configurar integração 3C", error);
  return threeCConfig({ config: data });
}

export async function rotateThreeCToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  // A RPC mantém a configuração da 3C; a chave só permanece na memória desta tela.
  await setIntegrationSecret("3c", "api_token", token);
  return token;
}
