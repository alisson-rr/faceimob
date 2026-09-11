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
 *
 * O mesmo vale para o código que PERDE o leitor: `deals.edit_stage` saiu daqui
 * em 10/09/2026, porque quem decide a etapa voltou a ser a matriz de etapas e
 * não um switch desta aba. Enquanto ele existir no catálogo do banco a tela cai
 * no genérico — "Nenhuma tela ou RPC lê este código", selo "Ainda sem efeito" —,
 * que é a verdade, mas é uma verdade contada: `e2e/admin/permissoes.spec.ts`
 * exige que só os três acima apareçam inertes. Quem tira o leitor tira também o
 * código do catálogo, por migration; o que não se faz é deixar entrada aqui
 * prometendo efeito para um switch que ninguém lê.
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
  "deals.mark_off_distrato": {
    where: "Negócio: marcar os desfechos OFF e DISTRATO — os dois rótulos do Status 2 que o cliente reservou ao administrador em 10/09/2026, e que tiram o negócio do funil, do VGV e do ranking (gatilho deals_guard_status_columns). O RESTO do Status 2 continua livre para quem edita o negócio, e a \"Etapa (Status 1)\" não passa por aqui: quem decide etapa é a matriz de etapas (can_enter/can_exit), na aba ao lado",
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
  "pipeline.export": {
    where: "Pipeline: botão \"Extrair planilha\". O arquivo sai com VGV, percentual de rateio e VGV POR CORRETOR do recorte inteiro — a folha de comissão da operação. A trava é de TELA: a planilha é montada no navegador a partir dos negócios que o RLS já entregou, então desligar aqui remove o caminho de um clique, não o acesso ao dado",
    enforcedBy: "tela",
  },
  "marketing.meta_manage": {
    where: "Marketing · Meta: pausar, ativar e mudar verba de campanha na Meta e aprovar ou recusar a fila do gestor IA (RPCs meta_action_create e meta_action_decide, 0116), e rodar a nota por anúncio e o gestor IA (meta_ai_run_start). O mesmo switch libera sincronizar agora, salvar plano e mudar os limites dos alertas. Nasce ligado só para o marketing; administrador e sócio passam sempre. Diretor e gerente leem os números por reports.view_finance, mas só mexem na Meta se o switch for ligado para eles",
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
