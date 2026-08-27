/**
 * Consultas da tela de Leads.
 *
 * Toda carga passa por `useQuery` com chave estável. O padrão antigo era um
 * `useEffect` com `Promise.allSettled` escrevendo cinco `useState`: qualquer
 * remontagem (troca de aba, volta do modal) refazia as cinco consultas, e o
 * realtime da roleta chamava o mesmo `reload()` para todo mundo. Aqui o cache é
 * do QueryClient — `staleTime: 60_000` vem do `App.tsx` — e o realtime só
 * invalida as chaves de registro de lead.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getAutomationSettings,
  listAssignableBrokers,
  listDeveloperProjects,
  listDevelopers,
  listLeadAttachments,
  listLeadComments,
  listLeadEvents,
  listLeadSources,
  listLeads,
  listTimeoutReleasesToday,
  listWhatsappTemplates,
  OPEN_LEAD_STATUSES,
} from "@/integrations/supabase/leads";

/**
 * `records` é o prefixo de tudo que é lead vindo do banco — a lista completa e
 * o recorte aberto do funil. Uma invalidação só alcança as duas telas, que é o
 * que a roleta exige: quem move um lead no funil muda a lista, e vice-versa.
 */
export const leadKeys = {
  root: ["leads"] as const,
  records: ["leads", "records"] as const,
  list: ["leads", "records", "all"] as const,
  open: ["leads", "records", "open"] as const,
  timeoutReleases: ["leads", "timeout-releases"] as const,
  sources: ["leads", "sources"] as const,
  brokers: ["leads", "brokers"] as const,
  automation: ["leads", "automation"] as const,
  whatsappTemplates: ["leads", "whatsapp-templates"] as const,
  developers: ["leads", "developers"] as const,
  projects: (developerId: string) => ["leads", "projects", developerId] as const,
};

export const useLeads = () =>
  useQuery({ queryKey: leadKeys.list, queryFn: () => listLeads() });

/** Só o que ainda está em operação: convertido/perdido/descartado sai do funil. */
export const useOpenLeads = () =>
  useQuery({
    queryKey: leadKeys.open,
    queryFn: () => listLeads({ statuses: OPEN_LEAD_STATUSES, limit: 500 }),
  });

/** Quantos leads a roleta devolveu por estouro de prazo hoje, por corretor. */
export const useTimeoutReleasesToday = () =>
  useQuery({ queryKey: leadKeys.timeoutReleases, queryFn: listTimeoutReleasesToday });

export const useLeadSources = () =>
  useQuery({ queryKey: leadKeys.sources, queryFn: listLeadSources });

/** Só gestor realoca lead: sem permissão a consulta nem sai. */
export const useAssignableBrokers = (enabled: boolean) =>
  useQuery({ queryKey: leadKeys.brokers, queryFn: listAssignableBrokers, enabled });

export const useAutomationSettings = () =>
  useQuery({ queryKey: leadKeys.automation, queryFn: getAutomationSettings });

export const useWhatsappTemplates = () =>
  useQuery({ queryKey: leadKeys.whatsappTemplates, queryFn: listWhatsappTemplates });

export const useDevelopers = (enabled: boolean) =>
  useQuery({ queryKey: leadKeys.developers, queryFn: listDevelopers, enabled });

/** Empreendimentos da construtora escolhida. Sem construtora, não consulta. */
export const useDeveloperProjects = (developerId: string) =>
  useQuery({
    queryKey: leadKeys.projects(developerId),
    queryFn: () => listDeveloperProjects(developerId),
    enabled: Boolean(developerId),
  });

/** Chave do detalhe de um lead — fora de `records`, para não ser invalidada junto. */
export const leadDetailKey = (leadId: string) => ["leads", "detail", leadId] as const;

/**
 * Histórico, comentários e anexos de um lead, para o `LeadDetailModal`.
 *
 * As três consultas só saem com o modal aberto: o `LeadDetailModal` é montado
 * pela tela inteira, e sem `enabled` toda lista de leads pagaria três
 * requisições por lead que ninguém abriu.
 */
export function useLeadDetail(leadId: string | undefined, open: boolean) {
  const queryClient = useQueryClient();
  const enabled = Boolean(leadId) && open;
  const key = leadDetailKey(leadId ?? "");

  const events = useQuery({
    queryKey: [...key, "events"],
    queryFn: () => listLeadEvents(leadId as string),
    enabled,
  });
  const comments = useQuery({
    queryKey: [...key, "comments"],
    queryFn: () => listLeadComments(leadId as string),
    enabled,
  });
  const attachments = useQuery({
    queryKey: [...key, "attachments"],
    queryFn: () => listLeadAttachments(leadId as string),
    enabled,
  });

  // Comentário e anexo de outra pessoa entram no histórico enquanto o modal
  // está aberto; sem isso, quem está olhando o lead não vê a movimentação.
  useEffect(() => {
    if (!enabled || !leadId) return;
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) }); };
    const channel = supabase.channel(`lead-${leadId}`);
    for (const table of ["lead_events", "lead_comments", "lead_attachments"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `lead_id=eq.${leadId}` }, invalidate);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, leadId, queryClient]);

  return {
    events: events.data ?? [],
    comments: comments.data ?? [],
    attachments: attachments.data ?? [],
    isPending: enabled && (events.isPending || comments.isPending || attachments.isPending),
    reload: () => queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId ?? "") }),
  };
}

/**
 * Recarrega a lista depois de uma escrita.
 *
 * Explícito mesmo com o realtime ligado: o canal pode estar fora do ar (rede,
 * publicação da tabela) e a tela não pode ficar mentindo sobre o que acabou de
 * ser gravado por causa disso.
 */
export function useInvalidateLeads() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: leadKeys.records });
}

/**
 * A roleta mexe no lead pelo banco (atribuição, expiração, redistribuição): sem
 * ouvir `leads`, a tela do corretor mostra um estado que já não existe.
 * Invalida só os registros — origens, corretores e automação não mudam com isso.
 */
export function useLeadsRealtime(channelName = "leads-page") {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        void queryClient.invalidateQueries({ queryKey: leadKeys.records });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, channelName]);
}

/**
 * Relógio para os cronômetros da trava de atendimento.
 *
 * Esta tela fica aberta o dia inteiro. O tique de 1s só vale quando há trava
 * correndo; fora disso um passo lento basta para "atrasado" e "inativo".
 */
export function useNowTicker(fast: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), fast ? 1_000 : 30_000);
    return () => clearInterval(ticker);
  }, [fast]);
  return now;
}
