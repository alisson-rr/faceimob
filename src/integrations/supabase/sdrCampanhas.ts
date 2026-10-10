import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/** Campanha de WhatsApp da Meta e o agente que atende quem vem dela (0257). */
export type CampanhaWhatsapp = {
  external_id: string;
  name: string;
  status: string | null;
  source_id: string | null;
  sdr_agent_id: string | null;
  synced_at: string | null;
};

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `campanhas_whatsapp` e `lead_sources.campaign_external_id` nasceram na 0257,
 * depois do último `supabase gen types`: a forma vem declarada aqui até a
 * próxima geração do `types.ts`, que não se edita à mão.
 */
const db = supabase as unknown as {
  rpc(nome: "campanhas_whatsapp"): Resultado<CampanhaWhatsapp[]>;
  from(tabela: "lead_sources"): {
    upsert(linha: Record<string, unknown>, opcoes: { onConflict: string }): Resultado<null>;
  };
};

export async function listCampanhasWhatsapp(): Promise<CampanhaWhatsapp[]> {
  const { data, error } = await db.rpc("campanhas_whatsapp");
  if (error) throw dbError("campanhas_whatsapp", error);
  return data ?? [];
}

/** Código da origem de uma campanha: um por campanha, estável entre edições. */
export const codigoDaCampanha = (externalId: string) => `wa_campanha_${externalId}`;

/**
 * Liga a campanha ao agente (ou a nenhum: `null` manda direto para a roleta,
 * e a origem continua marcando de onde o lead veio nos relatórios).
 */
export async function ligarCampanhaAoAgente(
  campanha: Pick<CampanhaWhatsapp, "external_id" | "name">,
  agentId: string | null,
): Promise<void> {
  const { error } = await db.from("lead_sources").upsert({
    code: codigoDaCampanha(campanha.external_id),
    label: `WhatsApp · ${campanha.name}`.slice(0, 120),
    channel: "whatsapp",
    active: true,
    sdr_agent_id: agentId,
    campaign_external_id: campanha.external_id,
  }, { onConflict: "code" });
  if (error) throw dbError("lead_sources", error);
}
