/**
 * Quem cadastra negócio na tela.
 *
 * Espelha o `with check` de `deals_insert` (migration 0053) — e o espelho
 * precisa ser do PAPEL EFETIVO, não de `roles.includes('broker')`:
 * `handle_new_auth_user` (0002) concede `broker` a todo perfil novo e nunca o
 * retira, então o `includes` respondia "sim" para SDR, marketing e sócio. Eles
 * ganhavam o botão "Adicionar negócio" e, no banco, entravam como Corretor 1
 * com 100% do rateio de VGV.
 *
 * Sócio, SDR e marketing enxergam o pipeline (`menu.pipeline`) e ficam com o
 * selo "Somente leitura": o negócio deles nasce de `convert_lead_to_deal`, que
 * atribui o corretor de verdade.
 */
import { primaryRole, type NewAppRole } from "@/integrations/supabase/newSchema";

const DEAL_WRITERS: NewAppRole[] = ["admin", "director", "manager", "broker", "cca"];

// Lista vazia é "ainda carregando" (o `roles` do AuthContext começa em `[]`) ou
// perfil sem papel nenhum — e `primaryRole` cai em 'broker' por padrão, o que
// mostraria o botão para os dois. O banco recusa os dois, então a tela também.
export const canWriteDeals = (roles: NewAppRole[]): boolean =>
  roles.length > 0 && DEAL_WRITERS.includes(primaryRole(roles));
