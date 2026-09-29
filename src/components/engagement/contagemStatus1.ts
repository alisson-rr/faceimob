import type { DealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";

/** Os quatro Status 1 que o placar mostra por pessoa (pedido de 28/09/2026). */
export const GRUPOS_DO_PLACAR = [
  { code: "VENDA", rotulo: "Venda" },
  { code: "PROPOSTA", rotulo: "Proposta" },
  { code: "LEGADO", rotulo: "Legado" },
  { code: "OFF", rotulo: "Off" },
] as const;

export type CodigoDoPlacar = (typeof GRUPOS_DO_PLACAR)[number]["code"];
export type ContagemStatus1 = Record<CodigoDoPlacar, number>;

type NegocioContado = Pick<LegacyDealRecord, "status_group_id" | "broker1_id" | "broker2_id" | "broker3_id">;

/**
 * Quantos negócios de cada Status 1 cada pessoa tem, entre os negócios que a
 * tela já carregou (o período do Painel/Pipeline, dentro da RLS de quem olha).
 *
 * Conta só como CORRETOR do negócio, uma vez por negócio (pedido de
 * 29/09/2026): o placar é de corretores, e o gestor que aparece nele aparece
 * com o que vendeu como corretor — o slot de gerente/diretor inflava a linha
 * dele com a equipe inteira. O grupo sai do
 * `code` do catálogo (imutável, 0149), não do rótulo editável. DISTRATO e
 * negócio sem Status 1 não entram em nenhuma das quatro.
 */
export function contarStatus1PorPessoa(
  deals: NegocioContado[],
  catalog: Pick<DealStatusCatalog, "groupById">,
): Map<string, ContagemStatus1> {
  const porPessoa = new Map<string, ContagemStatus1>();
  for (const deal of deals) {
    const code = deal.status_group_id ? catalog.groupById.get(deal.status_group_id)?.code : undefined;
    if (!GRUPOS_DO_PLACAR.some((grupo) => grupo.code === code)) continue;
    const pessoas = new Set([deal.broker1_id, deal.broker2_id, deal.broker3_id].filter((id): id is string => Boolean(id)));
    for (const id of pessoas) {
      const contagem = porPessoa.get(id) ?? { VENDA: 0, PROPOSTA: 0, LEGADO: 0, OFF: 0 };
      contagem[code as CodigoDoPlacar] += 1;
      porPessoa.set(id, contagem);
    }
  }
  return porPessoa;
}

/** "Venda 2 · Proposta 5 · Legado 1 · Off 0" — zerado quando a pessoa não tem negócio no período. */
export const textoDaContagem = (contagem: ContagemStatus1 | undefined): string =>
  GRUPOS_DO_PLACAR.map(({ code, rotulo }) => `${rotulo} ${contagem?.[code] ?? 0}`).join(" · ");
