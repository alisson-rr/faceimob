import { replaceEqualDeep } from "@tanstack/react-query";
import type { LeadRecord } from "@/integrations/supabase/leads";

/**
 * Igualdade do `memo` da linha e do cartão do funil: `lead` por conteúdo, o
 * resto por referência.
 *
 * O TanStack Query só mantém a referência do lead que ficou na MESMA posição da
 * lista (`replaceEqualDeep` compara array por índice). Lead novo entra no topo
 * (`created_at desc`) e desloca todos: comparando por referência, cada lead que
 * chegava refazia as 1.000 linhas e os 500 cartões. `replaceEqualDeep` devolve o
 * próprio `a` quando o conteúdo é igual — a linha que pula o render guarda um
 * lead idêntico ao novo, então os cliques continuam levando o lead certo.
 *
 * Mora fora de `LeadsTable.tsx` porque arquivo de componente que exporta função
 * perde o fast refresh (`react-refresh/only-export-components`).
 */
export function sameLeadProps<P extends { lead: LeadRecord }>(a: Readonly<P>, b: Readonly<P>) {
  const keys = Object.keys(b) as (keyof P)[];
  return keys.length === Object.keys(a).length
    && keys.every((key) => (key === "lead"
      ? replaceEqualDeep(a.lead, b.lead) === a.lead
      : Object.is(a[key], b[key])));
}
