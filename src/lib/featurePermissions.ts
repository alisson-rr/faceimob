/**
 * Onde cada código do catálogo `permissions` é lido.
 *
 * A matriz de Admin · Permissões grava em `role_permissions` para qualquer
 * código do catálogo, mas gravar só muda algo quando alguém lê o código:
 * `has_permission()` numa RPC ou policy (a trava de verdade) ou `can()` numa
 * tela (que só esconde o botão). Onze dos doze códigos de funcionalidade
 * nasceram no seed sem leitor nenhum — o switch virava cinza e nada mudava.
 * Este mapa é a fonte única do que a tela mostra ao lado de cada switch, para
 * o admin não confiar num controle que não existe.
 *
 * Regra para mexer aqui: só marque `"banco"` depois de a migration que lê o
 * código existir e `"tela"` depois de o `can("<code>")` estar no fonte —
 * `featurePermissions.test.ts` confere as duas coisas lendo os arquivos, não
 * este mapa. Mentir aqui é o defeito original.
 *
 * Três dos doze — `deals.view_all`, `users.manage_roles` e `game.close_season`
 * — não têm leitor e não vão ter: as três decisões correspondentes são por
 * papel, no código. Eles continuam no catálogo porque `supabase/seed.sql` os
 * reinsere depois de qualquer migration, então apagá-los não sobrevive a um
 * `db:reset`. O que sobra é dizer a verdade no lugar onde o admin clica:
 * `enforcedBy: null` e o selo "Ainda sem efeito", com a frase explicando quem
 * decide de verdade.
 */
export type EnforcedBy = "banco" | "tela";

export type PermissionEnforcement = {
  /** Tela e ação que o código controla — o que o admin precisa ler. */
  where: string;
  /** Quem lê o código. `null` = ninguém ainda: gravar não muda nada. */
  enforcedBy: EnforcedBy | null;
};

const MENU: PermissionEnforcement = {
  where: "Item do menu lateral e guard da rota; este item não muda o RLS de nenhuma tabela",
  enforcedBy: "tela",
};

/**
 * Exceção: este código de menu virou predicado de RLS na 0044
 * (`allowed_ips_read`). Conceder o item deixa de ser cosmético — entrega a
 * lista de faixas do check-in, que é o controle antifraude. Sem esta entrada a
 * aba Menu afirmaria, como para todo `menu.*`, que o dado continua sob o RLS
 * de cada tabela.
 */
const MENU_ALLOWED_IPS: PermissionEnforcement = {
  where: "Admin · IPs: além do item de menu, libera LER as faixas de IP do check-in (policy allowed_ips_read). Cadastrar, ativar e remover continua só do admin",
  enforcedBy: "banco",
};

/**
 * Segunda exceção, pela mesma razão e com consequência maior: desde a 0065
 * (reafirmada na 0066) `perform_checkin` levanta 42501 quando este código
 * falta. Revogar o item de menu de Check-in não esconde uma tela — TIRA a
 * pessoa da roleta: sem check-in ela não entra em `distribution_queue` e não
 * recebe lead nenhum. O admin precisa ler isso antes do clique.
 */
const MENU_CHECKIN: PermissionEnforcement = {
  where: "Check-in: além do item de menu, é o que a RPC perform_checkin exige (0065/0066). Revogar impede a pessoa de bater ponto e, com isso, de entrar na fila da roleta",
  enforcedBy: "banco",
};

const none = (where: string): PermissionEnforcement => ({ where, enforcedBy: null });

/** Códigos fora de `menu.*` do catálogo (migrations 0044, 0045 e 0061). */
export const FEATURE_PERMISSIONS: Record<string, PermissionEnforcement> = {
  "leads.view_queue": {
    where: "Leads: enxergar e editar leads ainda sem corretor (policies leads_select e leads_update)",
    enforcedBy: "banco",
  },
  "leads.reassign": {
    where: "Leads: realocar lead para corretor da equipe que lidera (RPC reassign_lead); a tela ainda mostra o botão pelo papel",
    enforcedBy: "banco",
  },
  "leads.delete": {
    where: "Excluir lead (policy leads_delete) — a tela ainda não tem esse botão; só quem chamar a API é barrado ou liberado por aqui",
    enforcedBy: "banco",
  },
  "deals.edit_value": {
    where: "Negócio: mudar VGV bruto e desconto (gatilho deals_guard_value, 0061). Desligar impede a EDIÇÃO DO VALOR; ver e mover o negócio continua pelas outras regras",
    enforcedBy: "banco",
  },
  "deals.delete": {
    where: "Excluir negócio (policy deals_delete) — a tela ainda não tem esse botão; só quem chamar a API é barrado ou liberado por aqui",
    enforcedBy: "banco",
  },
  "cca.review": {
    where: "CCA: mover e decidir casos e EDITAR QUALQUER NEGÓCIO, de qualquer equipe (can_edit_deal ignora a hierarquia); a configuração das etapas continua pelo papel. Um switch só para dois poderes muito diferentes — separar exige um código novo",
    enforcedBy: "banco",
  },
  "reports.view_finance": {
    where: "Marketing: ler campanhas e aportes e chamar marketing_campaign_stats() (policies ad_campaigns_select e marketing_investments_select, 0045). Resultados ainda decide por papel",
    enforcedBy: "banco",
  },
  "teams.manage": {
    where: "Equipes: incluir e desligar integrantes da equipe que lidera (policy team_members_manage). Vale para GERENTE e DIRETOR — a policy não tem ramo de diretor, então desligar aqui tira o 'Vincular em massa' dos dois. Renomear equipe e vincular diretoria continuam pelo papel",
    enforcedBy: "banco",
  },
  "settings.integrations": {
    where: "Admin · Integrações: ver e gravar credenciais (RPCs list_integrations e set_integration_secret)",
    enforcedBy: "banco",
  },

  // Os três sem leitor. A frase tem de dizer QUEM decide, senão o admin fica
  // sem saber onde mexer para conseguir o efeito que procurava no switch.
  "deals.view_all": none(
    "Nada lê este código: quem enxerga negócio fora da própria equipe é decidido por PAPEL em can_see_deal() — diretor, sócio e CCA. Ligar ou desligar aqui não muda visibilidade nenhuma",
  ),
  "users.manage_roles": none(
    "Nada lê este código: trocar papel passa por set_profile_roles(), que exige administrador por construção (0046). Para dar o poder a alguém, torne a pessoa administradora",
  ),
  "game.close_season": none(
    "Nada lê este código: encerrar temporada é decidido dentro da própria RPC, também só para administrador",
  ),
};

export function enforcementOf(code: string): PermissionEnforcement {
  if (code === "menu.admin_allowed_ips") return MENU_ALLOWED_IPS;
  if (code === "menu.checkin") return MENU_CHECKIN;
  if (code.startsWith("menu.")) return MENU;
  return FEATURE_PERMISSIONS[code] ?? none("Nenhuma tela ou RPC lê este código");
}

export function enforcementLabel({ enforcedBy }: PermissionEnforcement): string {
  if (enforcedBy === "banco") return "Aplicada no banco";
  if (enforcedBy === "tela") return "Aplicada na tela";
  return "Ainda sem efeito";
}
