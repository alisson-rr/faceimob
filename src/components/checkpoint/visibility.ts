/**
 * Quem enxerga qual equipe no Checkpoint — e por quê.
 *
 * Aqui convivem DUAS perguntas que a tela misturava numa função só, e a mistura
 * fazia a tela dar um diagnóstico falso:
 *
 *   1. O QUE O BANCO ENTREGA (`readsEveryReport`). `daily_reports_select`
 *      (0009, estreitada pela 0109) libera por
 *      `has_any_role('admin','partner')` — **admin e sócio**, não mais o
 *      diretor —, por `auth_led_team_ids()` (as equipes ATIVAS em que a pessoa
 *      é `manager_id` ou `director_id`) ou por ser membro da equipe em
 *      `team_members`, este último sem exigir `teams.active`.
 *   1b. DE QUEM ESTOU VENDO (`checkpointManagers` / `managerFocus`). O diretor
 *      abre o checkpoint de um gerente dele sem trocar de rota; o recorte do
 *      quadro passa a ser o daquele gerente. É recorte de tela — a trava
 *      continua sendo a RLS, e está descrita em `managerFocus`.
 *   2. O QUE A TELA MOSTRA (`showsEveryTeam`). O quadro é organizado por quem
 *      LIDERA cada equipe: o bloco de diretoria é o funil das equipes que a
 *      pessoa dirige. Desde a 0109 o banco entrega ao diretor exatamente as
 *      equipes que ele lidera, então tela e banco dizem a mesma coisa para ele
 *      — as duas funções continuam separadas porque para admin e sócio elas
 *      ainda divergem (leem tudo, e o quadro mostra tudo).
 *
 * O recorte por EQUIPE (e não por papel primário) é do banco: papel é N:N
 * (`user_roles`) e a ata de 23/07 é explícita ("os Diretores possuem a
 * capacidade de atuar em múltiplos papéis"). `primaryRole()` mentia nos dois
 * sentidos — diretor que também gerencia perdia a equipe que gerencia; sócio
 * que também gerencia perdia a visão total que a policy lhe dá.
 */
import type { AppRole } from "@/contexts/AuthContext";

/** O mínimo de `TeamRow` que o recorte usa. */
export type LedTeam = { id: string; manager_id: string | null; director_id: string | null };

export type CheckpointTeams<T extends LedTeam> = {
  /** Equipes que a pessoa dirige — ou todas, para quem lê tudo. Bloco de diretoria. */
  directed: T[];
  /** Equipes que ela apenas gerencia. Card por equipe, sem bloco de diretoria. */
  managed: T[];
  /** União das duas, na ordem em que chegaram. Alimenta o filtro e o estado vazio. */
  visible: T[];
};

/**
 * Papéis com leitura irrestrita de `daily_reports`. Espelha o primeiro ramo de
 * `daily_reports_select`, que a 0109 passou a escrever como
 * `has_any_role('admin','partner')` — o diretor saiu daqui e entra pelas
 * equipes que lidera, como o gerente.
 *
 * Só serve para EXPLICAR: para estes papéis o banco não recorta nada, então
 * equipe sem número na tela é equipe sem lançamento — nunca falta de permissão.
 */
export const readsEveryReport = (roles: AppRole[]) =>
  roles.includes("admin") || roles.includes("partner");

/**
 * Papéis para quem o quadro lista TODAS as equipes.
 *
 * Hoje tem os mesmos papéis de `readsEveryReport`; continuam separadas porque
 * respondem a perguntas diferentes — uma é o que a RLS entrega, a outra é o que
 * o quadro lista — e o texto de diagnóstico da tela depende da primeira.
 */
export const showsEveryTeam = (roles: AppRole[]) =>
  roles.includes("admin") || roles.includes("partner");

/**
 * Recorta as equipes do Checkpoint para um usuário.
 *
 * `profileId` é o id do perfil (igual ao id do usuário autenticado), que é o que
 * `teams.manager_id` / `teams.director_id` guardam.
 */
export function checkpointTeams<T extends LedTeam>(
  teams: T[],
  roles: AppRole[],
  profileId: string | null,
): CheckpointTeams<T> {
  if (showsEveryTeam(roles)) {
    return { directed: teams, managed: [], visible: teams };
  }
  if (!profileId) return { directed: [], managed: [], visible: [] };

  const directed = teams.filter((t) => t.director_id === profileId);
  // Quem dirige E gerencia a mesma equipe a vê uma vez só, no bloco de diretoria.
  const managed = teams.filter((t) => t.manager_id === profileId && t.director_id !== profileId);
  return { directed, managed, visible: [...directed, ...managed] };
}

export type QuadroTeam = { id: string; active: boolean };

export type Quadro<T> = {
  /** As equipes que o quadro mostra nesta semana. */
  quadro: T[];
  /**
   * Desativadas que o banco NÃO entrega a este papel — viram aviso na tela.
   * Vazio para quem lê tudo: para esses, desativada e sem número é só isso.
   */
  foraPorRecorte: T[];
};

/**
 * Equipe desativada: quem entra no quadro e quem vira aviso.
 *
 * A prova de que o banco entregou o diário de uma equipe é o diário ter chegado
 * — `comLancamento` sai dos `daily_reports` que a própria consulta trouxe. Com
 * lançamento na semana, a equipe entra no quadro (marcada como desativada) para
 * QUALQUER papel: os números estão na mão, esconder seria perder total da
 * semana sem explicação. É também o caso de quem lidera a equipe e é membro
 * dela — o terceiro ramo de `daily_reports_select` não exige `teams.active`.
 *
 * Desativada e sem nenhum lançamento tem duas causas que a tela não distingue:
 *
 *   · quem lê tudo (`readsEveryReport`): o banco não recortou nada, então não
 *     houve lançamento. Sai do quadro em silêncio — culpar permissão aqui era
 *     mandar o próprio administrador "pedir o número a um administrador";
 *   · os demais: `auth_led_team_ids()` exige `teams.active`, então o diário
 *     pode existir e não ter vindo. Vira aviso, com a ressalva de que também
 *     pode simplesmente não ter havido lançamento.
 */
export function teamsNoQuadro<T extends QuadroTeam>(
  teams: T[],
  roles: AppRole[],
  comLancamento: ReadonlySet<string>,
): Quadro<T> {
  const leTudo = readsEveryReport(roles);
  const quadro: T[] = [];
  const foraPorRecorte: T[] = [];
  for (const team of teams) {
    if (team.active || comLancamento.has(team.id)) quadro.push(team);
    else if (!leTudo) foraPorRecorte.push(team);
  }
  return { quadro, foraPorRecorte };
}

/** Parâmetro da URL com o gerente cujo checkpoint está aberto. */
export const PARAM_GERENTE = "gerente";

/** Um gerente alcançado pelo quadro, com as equipes dele. */
export type CheckpointManager<T> = { id: string; teams: T[] };

/**
 * Os gerentes que este quadro alcança — a lista que o diretor abre.
 *
 * Sai das equipes JÁ recortadas (`CheckpointTeams.visible`), nunca de `teams`
 * inteiro: para o diretor são os gerentes das equipes que ele dirige, para o
 * admin/sócio são todos, e para o gerente é ele mesmo — que `exceptProfileId`
 * tira da lista, porque "entrar no meu próprio checkpoint" é a tela em que ele
 * já está.
 */
export function checkpointManagers<T extends LedTeam>(
  visible: T[],
  exceptProfileId: string | null,
): CheckpointManager<T>[] {
  const porGerente = new Map<string, T[]>();
  for (const team of visible) {
    if (!team.manager_id || team.manager_id === exceptProfileId) continue;
    const lista = porGerente.get(team.manager_id);
    if (lista) lista.push(team);
    else porGerente.set(team.manager_id, [team]);
  }
  return Array.from(porGerente, ([id, teams]) => ({ id, teams }));
}

/**
 * Recorte de quem ENTROU no checkpoint de um gerente.
 *
 * `null` quando aquele gerente não está no recorte de quem olha — falha
 * fechada, e a tela avisa que ignorou o parâmetro em vez de mostrar um quadro
 * vazio com cara de "não há número".
 *
 * Isto é recorte de TELA e não é a trava: quem segura o dado é a RLS. Um
 * gerente que editar `?gerente=` na URL para o id de outro gerente não recebe
 * equipe nenhuma aqui, e mesmo que recebesse `daily_reports_select` (0009, 0109)
 * só entrega o diário de equipe que ele lidera, dirige ou de que é membro — o
 * ramo irrestrito é admin e sócio.
 *
 * Sem `directed`: o checkpoint DO GERENTE é o card por equipe, não o funil de
 * diretoria. Quem abre continua vendo o que aquele gerente veria.
 */
export function managerFocus<T extends LedTeam>(
  visible: T[],
  managerId: string,
): CheckpointTeams<T> | null {
  const teams = visible.filter((t) => t.manager_id === managerId);
  if (!teams.length) return null;
  return { directed: [], managed: teams, visible: teams };
}
