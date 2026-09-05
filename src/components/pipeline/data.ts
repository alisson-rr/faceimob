/**
 * Consultas do Pipeline.
 *
 * Antes eram sete `useState` alimentados por `useEffect` com `catch` que só
 * toastava: quando `listLegacyDeals()` falhava, `deals` ficava `[]` e a tela
 * dizia "Nenhum negócio encontrado" — erro de rede e filtro sem resultado davam
 * exatamente a mesma tela (achado A01). Aqui cada carga é um `useQuery` com
 * chave estável, e quem renderiza decide entre `LoadingState`, `EmptyState` e
 * erro com "Tentar de novo". `staleTime: 60_000` vem do `App.tsx`.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { listDevelopers } from "@/integrations/supabase/leads";
import { listPipelineStages, listStagePermissions } from "@/integrations/supabase/permissions";
import { exitableStages } from "./guards";
import { dealMonth } from "./filters";
import { canWriteDeals } from "./writeAccess";
import { listSeasons } from "@/integrations/supabase/game";
import {
  displayMonthToIso,
  listLegacyDeals,
  listSelectableBrokers,
  listOpenCheckins,
  listPeople,
  toDisplayMonth,
  type LegacyDealRecord,
} from "@/integrations/supabase/newSchema";

/**
 * Escrita em `deals` que não mente sobre o resultado.
 *
 * UPDATE recusado pela RLS não é erro: a linha some do `USING` e o PostgREST
 * devolve 204 com `error: null`. As três telas que gravam etapa/status por aqui
 * toastavam sucesso, o refetch trazia o valor antigo de volta e ninguém sabia
 * por quê — o sócio (`partner`, fora de `can_edit_deal`) batia nisso em toda
 * troca de Status 2. Com `.select("id")` a linha zero vira erro explicado.
 *
 * `P0001` porque a mensagem é nossa e já está em pt-BR: é o mesmo contrato que
 * `describeError` usa para os `raise exception` das migrations.
 */
export async function updateDeal(
  id: string,
  patch: Database["public"]["Tables"]["deals"]["Update"],
): Promise<void> {
  const { data, error } = await supabase.from("deals").update(patch).eq("id", id).select("id");
  if (error) throw dbError("deals", error);
  if (!data?.length) {
    throw dbError("deals", {
      code: "P0001",
      message: "Seu perfil não pode alterar este negócio.",
    });
  }
}

export const pipelineKeys = {
  root: ["pipeline"] as const,
  /** A lista de negócios é compartilhada com o Dashboard: chave curta e estável. */
  deals: ["deals"] as const,
  stages: ["pipeline", "stages"] as const,
  people: ["pipeline", "people"] as const,
  developers: ["pipeline", "developers"] as const,
  selectableBrokers: ["pipeline", "selectable-brokers"] as const,
  closedMonths: ["closed_months"] as const,
  stagePermissions: ["pipeline", "stage-permissions"] as const,
  queue: ["pipeline", "checkins"] as const,
  openSeason: ["pipeline", "open-season"] as const,
};

export const useDeals = () =>
  useQuery({ queryKey: pipelineKeys.deals, queryFn: listLegacyDeals });

/** Catálogo de etapas — fonte única do rótulo e dono do `id` que o RLS autoriza. */
export const usePipelineStages = () =>
  useQuery({ queryKey: pipelineKeys.stages, queryFn: listPipelineStages, staleTime: 5 * 60_000 });

export const usePeople = () =>
  useQuery({ queryKey: pipelineKeys.people, queryFn: listPeople, staleTime: 5 * 60_000 });

export const useDevelopers = () =>
  useQuery({ queryKey: pipelineKeys.developers, queryFn: listDevelopers, staleTime: 5 * 60_000 });

/**
 * Corretores selecionáveis para o rateio, por RPC `security definer`.
 *
 * `usePeople()` passa pela RLS de `profiles` e o corretor só se enxerga: os
 * campos "Corretor 2" e "Corretor 3" abriam com uma opção só — ele mesmo. Sem
 * `retry`: quando a migration ainda não subiu a função não existe, e insistir
 * três vezes só atrasa o formulário. `null` = função ausente, e quem chama
 * segue com a lista visível de sempre.
 */
export const useSelectableBrokers = () =>
  useQuery({
    queryKey: pipelineKeys.selectableBrokers,
    queryFn: listSelectableBrokers,
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * Meses congelados (`closed_months`).
 *
 * Quem lê esta consulta decide se o mês está travado — e por isso ela **não
 * pode falhar aberta**. Enquanto o erro era descartado (só `data` era lido),
 * uma queda de rede transformava mês congelado em mês editável na tela inteira:
 * sumia o cadeado da linha e do cartão, `blockedMoveReason` deixava arrastar e
 * o formulário do modal reabria — tudo para morrer em
 * `deals_guard_closed_month` na hora de gravar. É o mesmo tratamento que a
 * matriz de etapas já tem: sem a resposta carregada, a trava fecha.
 */
export const useClosedMonths = () =>
  useQuery({
    queryKey: pipelineKeys.closedMonths,
    queryFn: async () => {
      const result = await supabase.from("closed_months").select("period");
      if (result.error) throw dbError("closed_months", result.error);
      return (result.data ?? [])
        .map((row) => toDisplayMonth(row.period))
        .filter((month): month is string => Boolean(month));
    },
  });

/**
 * Reabre um mês congelado — apaga a linha de `closed_months`.
 *
 * Três lugares da tela prometiam esta reabertura ("Fale com o administrador
 * para reabrir", no `blockedMoveReason` e no modal) e ela não existia em botão,
 * tela nem RPC: o único caminho era SQL na mão. A policy `closed_months_write`
 * já é `is_admin()`, então o banco sempre soube fazer isso — faltava a tela.
 *
 * **O que ela NÃO faz:** devolver o `month_base` das propostas que a RPC já
 * migrou para o mês seguinte. Não existe registro de quais linhas foram
 * movidas, então reverter seria adivinhação — e devolveria negócio para um mês
 * que a diretoria já leu como fechado. O diálogo diz isso antes de confirmar.
 *
 * `.select("period")` porque DELETE recusado pela RLS não é erro: a linha some
 * do `USING` e o PostgREST devolve 204 com `error: null` — sem conferir o
 * retorno, o não-admin veria "mês reaberto" e nada teria mudado.
 */
export async function reopenMonth(month: string): Promise<void> {
  const { data, error } = await supabase
    .from("closed_months")
    .delete()
    .eq("period", displayMonthToIso(month))
    .select("period");
  if (error) throw dbError("closed_months", error);
  if (!data?.length) {
    throw dbError("closed_months", {
      code: "P0001",
      message: `O mês ${month} não foi reaberto: ou ele já estava aberto, ou seu perfil não pode reabrir períodos.`,
    });
  }
}

/**
 * `can_exit_stage()` espelhado na tela.
 *
 * O `AuthContext` já carrega `stage_permissions` para resolver `canEnterStage`,
 * mas só expõe a metade "entrar". `can_exit` é gravado pela tela de Permissões,
 * cobrado pelo `deals_guard_stage` no banco e nunca era lido aqui: o resultado
 * era seta e alça de arraste em etapa da qual o perfil não pode sair, com 42501
 * garantido na volta. Enquanto a outra metade não subir para o `AuthContext`,
 * esta consulta resolve o espelho — a matriz inteira tem dezenas de linhas e o
 * RLS já a libera para todo autenticado.
 *
 * Falha fechada de propósito: sem a matriz carregada ninguém move nada. Gesto
 * que não aparece é recuperável; gesto que aparece e o banco recusa, não.
 */
export const useStagePermissions = () =>
  useQuery({
    queryKey: pipelineKeys.stagePermissions,
    queryFn: listStagePermissions,
    staleTime: 5 * 60_000,
  });

export function useCanExitStage() {
  const { roles, previewRole, isAdmin } = useAuth();
  const { data } = useStagePermissions();

  const exitable = useMemo(
    () => exitableStages(data ?? [], previewRole ? [previewRole] : roles),
    [data, previewRole, roles],
  );

  return useCallback(
    (stageId: string) => isAdmin || exitable.has(stageId),
    [isAdmin, exitable],
  );
}

/**
 * A trava de escrita do EDITOR de negócio — uma resposta só para o formulário e
 * para o botão que o salva.
 *
 * Enquanto o `canWrite` era calculado DENTRO do `DealForm`, o rodapé do modal
 * não o enxergava: sócio, SDR e marketing abriam o negócio, viam todos os
 * campos cinzas e um "Confirmar alterações" habilitado, que ia ao banco só para
 * voltar recusado. E o mês fechado (`deals_guard_closed_month`, 0010) nem
 * chegava ao formulário — a trava existia na linha da tabela e no cartão, mas
 * não no editor, que é onde a gravação de verdade acontece.
 *
 * Hook, e não três cópias da regra: quem desabilita o campo e quem desabilita o
 * botão precisam responder a mesma coisa, sempre.
 *
 * `active`/`outcome` NÃO entram: `can_edit_deal` (0044) não olha o desfecho e o
 * banco aceita corrigir dado de negócio encerrado. Travar aqui seria a tela
 * negando o que o banco permite.
 */
export function useDealWriteLock(
  deal: Pick<LegacyDealRecord, "month_base" | "created_at">,
): { readOnly: boolean; reason: "role" | "month" | "unknown" | null; month: string } {
  const { isAdmin, roles } = useAuth();
  const { data: closedMonths, isPending, error } = useClosedMonths();

  const month = dealMonth(deal);
  if (!(isAdmin || canWriteDeals(roles))) return { readOnly: true, reason: "role", month };
  // Sem saber se o mês está congelado, a trava fecha (`reason: "unknown"`).
  // Só o `data` era lido aqui: consulta falhando devolvia `[]`, o mês fechado
  // virava mês aberto, o `fieldset` reabria e o salvamento morria no gatilho do
  // banco depois de ~40 campos preenchidos. O admin passa por cima do gatilho
  // (`is_admin()` curto-circuita), então para ele a espera não trava nada.
  if (!isAdmin && (isPending || error)) return { readOnly: true, reason: "unknown", month };
  if (!isAdmin && (closedMonths ?? []).includes(month)) {
    return { readOnly: true, reason: "month", month };
  }
  return { readOnly: false, reason: null, month };
}

/**
 * Temporada aberta do game. Desde a migration `0032` o mês-base do negócio segue
 * o ciclo do jogo, então é ELE que o "Fechar Mês" congela — não o mês do
 * relógio nem o que estiver digitado no filtro.
 */
export const useOpenSeason = () =>
  useQuery({
    queryKey: pipelineKeys.openSeason,
    queryFn: async () => (await listSeasons()).find((season) => !season.closed_at) ?? null,
  });

/**
 * Fila de atendimento do dia. O realtime de `checkins` invalida a chave: a
 * roleta muda a fila pelo banco e a barra não pode mostrar quem já saiu.
 */
export function useCheckinQueue() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: pipelineKeys.queue, queryFn: listOpenCheckins });

  useEffect(() => {
    const channel = supabase
      .channel("pipeline-checkins")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.queue });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

/**
 * O que muda POR FORA desta aba e a tela precisa saber na hora.
 *
 * Três tabelas, um canal só:
 *
 * - `deals` — o CCA aprova por outra tela, o fechamento de mês move proposta em
 *   massa e dois operadores mexem no mesmo funil. (Ela só entrou na publication
 *   `supabase_realtime` na migration 0076: até lá este `subscribe` abria e
 *   nunca recebia evento — código morto que parecia funcionar.)
 * - `stage_permissions` — a matriz é a trava de mover negócio. Enquanto ela só
 *   era relida no F5, um admin que revogava uma etapa durante o expediente
 *   continuava vendo o corretor mover o negócio, e o corretor continuava
 *   movendo até recarregar a página.
 * - `closed_months` — fechar (ou reabrir) um mês muda a trava de escrita de
 *   quem estiver com o Pipeline aberto.
 *
 * Invalidar a chave, e não escrever no cache: quem recarrega é a própria
 * consulta, com a RLS de quem está olhando.
 */
export function usePipelineRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("pipeline-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.deals });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stage_permissions" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.stagePermissions });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "closed_months" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.closedMonths });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);
}

export function useInvalidateDeals() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: pipelineKeys.deals });
}
