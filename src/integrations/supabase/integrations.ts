import { supabase } from "./client";

/**
 * Cofre de credenciais e saúde dos jobs de cron.
 *
 * `list_integrations()` nunca devolve o segredo — só `has_secret`. É a garantia
 * de que o valor não trafega para o browser nem aparece no network tab, e por
 * isso a tela mostra "configurado / não configurado" em vez do valor.
 */

export type IntegrationRecord = {
  id: string;
  provider: string;
  label: string;
  active: boolean;
  has_secret: boolean;
  config: Record<string, unknown> | null;
  updated_at: string | null;
};

export type CronJobHealth = {
  job_name: string;
  schedule: string;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_return: string | null;
  failures_24h: number;
  runs_24h: number;
};

export async function listIntegrations(): Promise<IntegrationRecord[]> {
  const { data, error } = await supabase.rpc("list_integrations");
  if (error) throw new Error(error.message);
  return (data ?? []) as IntegrationRecord[];
}

export async function setIntegrationSecret(
  provider: string,
  label: string,
  secret: string,
  config: Record<string, string | number | boolean | null> = {},
): Promise<string> {
  const { data, error } = await supabase.rpc("set_integration_secret", {
    p_provider: provider,
    p_label: label,
    p_secret: secret,
    p_config: config,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Restrita a admin pelo próprio `WHERE` da função: não-admin recebe lista
 * vazia, não erro — para poder ser consumida por um `select` do frontend sem
 * tratamento especial.
 */
export async function listCronJobsHealth(): Promise<CronJobHealth[]> {
  const { data, error } = await supabase.rpc("cron_jobs_health");
  if (error) throw new Error(error.message);
  return (data ?? []) as CronJobHealth[];
}
