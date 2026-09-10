/**
 * Quem enxerga qual equipe no Checkpoint — e por quê.
 *
 * Aqui convivem DUAS perguntas que a tela misturava numa função só, e a mistura
 * fazia a tela dar um diagnóstico falso:
 *
 *   1. O QUE O BANCO ENTREGA (`readsEveryReport`). `daily_reports_select`
 *      (0009) libera por `can_read_all()` — que é **admin, diretor e sócio**
 *      (0002) —, por `auth_led_team_ids()` (as equipes ATIVAS em que a pessoa é
 *      `manager_id` ou `director_id`) ou por ser membro da equipe em
 *      `team_members`, este último sem exigir `teams.active`.
 *   2. O QUE A TELA MOSTRA (`showsEveryTeam`). O quadro é organizado por quem
 *      LIDERA cada equipe: o bloco de diretoria é o funil das equipes que a
 *      pessoa dirige. Um diretor lê o diário da empresa inteira no banco, mas
 *      somar as 10 equipes da casa no funil dele diluiria justamente o número
 *      que ele leva para a reunião. Então o recorte de tela dele continua sendo
 *      as equipes que lidera — decisão de produto, não recorte do banco, e é
 *      por isso que a tela não pode culpar o banco por ela.
 *
 * O recorte por EQUIPE (e não por papel primário) é do banco: papel é N:N
 * (`user_roles`) e a ata de 23/07 é explícita ("os Diretores possuem a
 * capacidade de atuar em múltiplos papéis"). `primaryRole()` mentia nos dois
 * sentidos — diretor que também gerencia perdia a equipe que gerencia; sócio
 * que também gerencia perdia a visão total que `can_read_all()` lhe dá.
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
 * Papéis com leitura irrestrita de `daily_reports`. Espelha `can_read_all()`.
 *
 * Só serve para EXPLICAR: para estes papéis o banco não recorta nada, então
 * equipe sem número na tela é equipe sem lançamento — nunca falta de permissão.
 */
export const readsEveryReport = (roles: AppRole[]) =>
  roles.includes("admin") || roles.includes("director") || roles.includes("partner");

/**
 * Papéis para quem o quadro lista TODAS as equipes.
 *
 * É decisão de tela, mais estreita que `readsEveryReport`: o diretor lê tudo no
 * banco, mas o quadro dele é o das equipes que ele lidera (ver o cabeçalho).
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
