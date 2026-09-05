/**
 * Encadeamento de agentes: quem pode receber o handoff de quem.
 *
 * A delegação por `@NomeDoAgente` saiu do `_shared/sdrAgent.ts` (dependia de o
 * modelo escrever um texto exato e falhava em silêncio), então
 * `handoff_to_agent_id` virou o ÚNICO caminho — e um ciclo A→B→A prende o lead
 * girando entre dois agentes sem nunca voltar para a roleta.
 *
 * O guard que vale é o trigger `sdr_agents_no_handoff_cycle` (migration 0064):
 * é por ele que passam tela, seed e script. Aqui a mesma regra só tira a opção
 * do seletor, para o operador não escolher o que o banco vai recusar.
 */
import type { Agent } from "./types";

type ChainAgent = Pick<Agent, "id" | "handoff_to_agent_id">;

/** A cadeia que começa em `fromId` passa por `targetId`? */
export function chainReaches(agents: ChainAgent[], fromId: string, targetId: string): boolean {
  const visitados = new Set<string>();
  let atual: string | null = fromId;
  while (atual && !visitados.has(atual)) {
    if (atual === targetId) return true;
    visitados.add(atual);
    atual = agents.find((a) => a.id === atual)?.handoff_to_agent_id ?? null;
  }
  return false;
}

/**
 * Agentes que podem receber o handoff de `selfId`: ativos, diferentes dele e
 * cuja própria cadeia não volta para ele. `selfId` vazio (agente ainda não
 * gravado) devolve todos os ativos.
 */
export function handoffOptions<T extends ChainAgent & { active: boolean }>(
  agents: T[],
  selfId: string | undefined,
): T[] {
  return agents.filter((a) =>
    a.active && a.id !== selfId && (!selfId || !chainReaches(agents, a.id, selfId)));
}
