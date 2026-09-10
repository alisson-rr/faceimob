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
  listDistributionGroups,
  listLeadSources,
  listGroupQueues,
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
  groupQueues: ["leads", "group-queues"] as const,
  sources: ["leads", "sources"] as const,
  groups: ["leads", "distribution-groups"] as const,
  brokers: ["leads", "brokers"] as const,
  automation: ["leads", "automation"] as const,
  whatsappTemplates: ["leads", "whatsapp-templates"] as const,
  developers: ["leads", "developers"] as const,
  projects: (developerId: string) => ["leads", "projects", developerId] as const,
};

/**
 * Atraso do termo antes de consultar o banco.
 *
 * A busca deixou de ser só do cliente: sem espera, cada tecla viraria uma
 * consulta. 350 ms é o intervalo em que a pessoa termina de digitar um nome.
 */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * A lista de leads, com a busca resolvida NO BANCO.
 *
 * A tela trunca em `LEADS_PAGE_SIZE` e o rodapé mandava "usar a busca do
 * sistema pelo telefone" — busca que não existia: o filtro rodava sobre as
 * linhas que já tinham vindo, então um lead antigo era inalcançável por
 * qualquer termo. Com o termo na consulta, procurar por nome, telefone ou
 * e-mail passa a olhar a base inteira; o filtro do cliente continua por cima,
 * para campanha e para os recortes de status, origem, corretor e grupo.
 *
 * `placeholderData` mantém a lista anterior enquanto a nova chega: sem isso a
 * tabela pisca em branco a cada pausa na digitação.
 */
export const useLeads = (search = "") =>
  useQuery({
    queryKey: [...leadKeys.list, search],
    queryFn: () => listLeads({ search }),
    placeholderData: (previous) => previous,
  });

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

/** Grupos de distribuição ativos — filtro da lista e destino da importação. */
export const useDistributionGroups = () =>
  useQuery({ queryKey: leadKeys.groups, queryFn: listDistributionGroups });

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
    // Sem isto, falha de rede ou recusa da RLS mostrava "Sem histórico" — o
    // mesmo texto de um lead que acabou de nascer. O primeiro erro basta: as
    // três consultas caem juntas quando o motivo é sessão ou rede.
    error: events.error ?? comments.error ?? attachments.error ?? null,
    reload: () => queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId ?? "") }),
  };
}

/**
 * Fila de cada grupo ativo — o card de saúde da roleta.
 *
 * Recarrega sozinho a cada minuto: a fila abre no horário de distribuição do
 * turno sem que nenhuma linha mude, e um gestor com a tela aberta veria "roleta
 * parada" depois de ela ter voltado a girar.
 */
export const useGroupQueues = (enabled: boolean) =>
  useQuery({
    queryKey: leadKeys.groupQueues,
    queryFn: listGroupQueues,
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

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
    const invalidar = () => { void queryClient.invalidateQueries({ queryKey: leadKeys.records }); };
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, invalidar)
      /**
       * O lead que SAI da mão do corretor não chega por `leads`.
       *
       * `leads_select` exige `assigned_to` visível, e o Realtime não entrega
       * linha que a RLS esconde: quando `release_expired_leads` zera
       * `assigned_to`, o UPDATE que interessa a quem acabou de perder o lead é
       * exatamente o que ele deixa de poder ler — a tela ficava com a linha
       * velha até alguém recarregar, e o aviso "Lead fora da sua mão" nunca
       * disparava.
       *
       * `lead_assignments` continua visível (o `profile_id` é dele) e é onde a
       * mesma transação grava `released_at`/`release_reason` ANTES de mexer no
       * lead. É por ela que a tela fica sabendo.
       */
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, invalidar)
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
