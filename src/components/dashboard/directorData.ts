/**
 * Dados do painel da diretoria: escopo (equipes, gerentes, corretores), diario
 * declarado e pipeline medido. Mesmo padrao do `data.ts` do Dashboard — uma
 * consulta por assunto, chave estavel comecando em "dashboard".
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import type { FunnelCounts } from "@/lib/metrics";
import { listLegacyDeals, listLegacyLeads, listPeople } from "@/integrations/supabase/newSchema";

export const ALL_TEAMS = "all";

export const monthBaseNow = () => {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
};

export const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

export const EMPTY_DAILY = { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 };
export type DirectorDaily = typeof EMPTY_DAILY;

/**
 * Equipes da diretoria e quem esta nelas.
 *
 * O gerente sai de `teams.manager_id`, nao de `team_members` (achado P06):
 * gerente costuma liderar a equipe sem ser membro dela, e derivar a diretoria
 * pela tabela de membros fazia o gerente sumir do escopo do proprio diretor —
 * so o seed criava esses vinculos, a UI nunca. Corretor continua vindo de
 * `team_members`, onde ele e membro de verdade.
 */
export function useDirectorScope(directorId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "director", "scope", directorId],
    enabled: !!directorId,
    queryFn: async () => {
      const [people, teamsRes] = await Promise.all([
        listPeople(),
        supabase
          .from("teams")
          .select("id,name,manager_id,director_id")
          .eq("director_id", directorId as string)
          .eq("active", true)
          .order("name"),
      ]);
      // Engolir o erro aqui virava painel com tudo zerado, que parece operacao
      // parada em vez de consulta falhada.
      if (teamsRes.error) throw dbError("teams", teamsRes.error);

      const teams = teamsRes.data ?? [];
      const teamIds = new Set(teams.map((team) => team.id));
      const managerIds = new Set(teams.map((team) => team.manager_id).filter(Boolean));
      return {
        teams,
        managers: people.filter((person) => managerIds.has(person.id)),
        brokers: people.filter(
          (person) => person.roles.includes("broker") && person.team_id && teamIds.has(person.team_id),
        ),
      };
    },
  });
}

/** Diario declarado: soma das entradas do mes nas equipes filtradas. */
export function useDirectorDaily(teamIds: string[]) {
  return useQuery({
    queryKey: ["dashboard", "director", "daily", teamIds],
    enabled: teamIds.length > 0,
    queryFn: async (): Promise<DirectorDaily> => {
      const reportsRes = await supabase
        .from("daily_reports")
        .select("id")
        .in("team_id", teamIds)
        .gte("report_date", startOfMonth());
      if (reportsRes.error) throw dbError("daily_reports", reportsRes.error);

      const reportIds = (reportsRes.data ?? []).map((report) => report.id);
      if (!reportIds.length) return { ...EMPTY_DAILY };

      const entriesRes = await supabase
        .from("daily_entries")
        .select("leads,doc_collections,analyses_sent,analyses_approved,sales")
        .in("report_id", reportIds);
      if (entriesRes.error) throw dbError("daily_entries", entriesRes.error);

      return (entriesRes.data ?? []).reduce<DirectorDaily>(
        (total, entry) => ({
          leads: total.leads + (entry.leads || 0),
          coleta_docs: total.coleta_docs + (entry.doc_collections || 0),
          analises: total.analises + (entry.analyses_sent || 0),
          aprovados: total.aprovados + (entry.analyses_approved || 0),
          vendas: total.vendas + (entry.sales || 0),
        }),
        { ...EMPTY_DAILY },
      );
    },
  });
}

/** Pipeline medido: o que o CRM registrou para os mesmos corretores, no mes. */
export function useDirectorPipeline(brokerIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "director", "pipeline", brokerIds],
    enabled,
    queryFn: async (): Promise<FunnelCounts> => {
      if (!brokerIds.length) return { leads: 0, analises: 0, aprovados: 0, vendas: 0 };
      const owners = new Set(brokerIds);
      const mes = monthBaseNow();
      const desde = startOfMonth();
      const [deals, leads] = await Promise.all([listLegacyDeals(), listLegacyLeads()]);
      const rows = deals.filter(
        (deal) => deal.broker1_id && owners.has(deal.broker1_id) && deal.month_base === mes,
      );
      return {
        leads: leads.filter((lead) => owners.has(lead.broker_id) && lead.created_at >= desde).length,
        analises: rows.filter((deal) => ["under_analysis", "analysis"].includes(deal.stage)).length,
        aprovados: rows.filter((deal) => ["approved", "contract"].includes(deal.stage)).length,
        vendas: rows.filter((deal) => deal.outcome === "won").length,
      };
    },
  });
}
