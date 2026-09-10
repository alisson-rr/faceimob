import type { RankingRow, SeasonResultRow } from "@/integrations/supabase/game";

/**
 * Regras puras do placar — as duas listas que a Gamificação e o pódio mostram.
 *
 * Ficam fora da tela porque tinham defeito e nenhum teste: empate resolvido por
 * ordem de chegada (o pódio trocava de degrau entre dois carregamentos) e
 * ranking congelado que descartava em silêncio quem saiu da equipe.
 */

export interface BrokerScore {
  brokerId: string;
  brokerName: string;
  team: string;
  managerId?: string;
  managerName?: string;
  directorshipId?: string;
  directorship?: string;
  vendas: number;
  vgv: number;
  points: number;
  avatarUrl: string | null;
  /** `true` quando a linha veio do congelado e ninguém no escopo a identifica. */
  unknownPerson?: boolean;
  /**
   * Colocação gravada no fechamento. Só o congelado tem: no ranking vivo a
   * posição é a da lista. A tela precisa dela porque o recorte de visibilidade
   * pode tirar linhas do meio — sem isto a medalha de 1º ia para quem o
   * congelamento pôs em 7º.
   */
  rank?: number;
}

/** Nome de quem o congelado guarda e o cadastro de hoje não identifica. */
export const UNKNOWN_PERSON = "Corretor fora do escopo";

/**
 * Desempate igual ao do banco.
 *
 * `close_game_season` congela com `row_number() over (order by r.points desc,
 * r.full_name)`. A tela ordenava só por pontos: nove corretores empatados em 0
 * entravam em ordem arbitrária, o pódio trocava de degrau a cada carregamento e
 * o "Você subiu para Nº X" disparava sem ninguém ter subido.
 */
const byPointsThenName = (a: BrokerScore, b: BrokerScore) =>
  b.points - a.points || a.brokerName.localeCompare(b.brokerName, "pt-BR");

/**
 * Monta as linhas da tela a partir do ranking do servidor.
 *
 * Os pontos vêm de `visible_game_ranking` (agregação de `game_events`), não de
 * um cálculo sobre `deals`: o cálculo no cliente dependia de pesos em
 * `useState`, então cada usuário podia ver um ranking diferente e nada era
 * auditável.
 */
export function buildScores(ranking: RankingRow[]): BrokerScore[] {
  return ranking
    .filter((row) => row.active)
    .map((row) => ({
      brokerId: row.profile_id,
      brokerName: row.full_name,
      team: row.team_name || "Sem equipe",
      managerId: row.manager_id ?? undefined,
      managerName: row.manager_name ?? undefined,
      directorshipId: row.director_id ?? undefined,
      directorship: row.director_name ?? undefined,
      vendas: row.sales,
      vgv: Number(row.vgv),
      points: row.points,
      avatarUrl: row.avatar_url,
    }))
    .sort(byPointsThenName);
}

/**
 * Temporada fechada: o número é o congelado em `game_season_results` e só a
 * identificação (nome, equipe, diretoria) é resolvida no ranking de hoje.
 *
 * `keepUnknown` decide o que fazer com a linha que o cadastro de hoje não
 * identifica — quem saiu da equipe, foi desativado ou perdeu o papel `broker`.
 *
 * - `true` para admin, diretor e sócio (o `can_read_all()` do banco): a linha
 *   fica, sem nome, porque para eles o congelado tem que continuar congelado —
 *   descartá-la fazia o 3º lugar de agosto virar 2º porque alguém pediu
 *   demissão em setembro.
 * - `false` para corretor e gerente: a linha sai. É o mesmo recorte que a
 *   policy `game_season_results_select` (migration 0060) aplica, e enquanto ela
 *   não estiver aplicada o SELECT ainda é `using (true)` — sem este filtro, um
 *   corretor de equipe de três abriria uma temporada fechada e leria os pontos
 *   e o VGV da casa inteira, rotulados "Corretor fora do escopo".
 *
 * A ordem é sempre a do `rank` gravado no fechamento, e ele vai junto em
 * `BrokerScore.rank`: com linhas filtradas as posições ficam descontínuas
 * (3, 7, 12) e a tela não pode numerar pelo índice do array.
 */
export function buildFrozenScores(
  results: SeasonResultRow[],
  people: Map<string, RankingRow>,
  { keepUnknown }: { keepUnknown: boolean },
): BrokerScore[] {
  return [...results]
    .filter((row) => keepUnknown || people.has(row.profile_id))
    .sort((a, b) => a.rank - b.rank)
    .map((row) => {
      const person = people.get(row.profile_id);
      return {
        brokerId: row.profile_id,
        brokerName: person?.full_name ?? UNKNOWN_PERSON,
        team: person?.team_name || (person ? "Sem equipe" : "—"),
        managerId: person?.manager_id ?? undefined,
        managerName: person?.manager_name ?? undefined,
        directorshipId: person?.director_id ?? undefined,
        directorship: person?.director_name ?? undefined,
        vendas: row.sales,
        vgv: Number(row.vgv),
        points: row.points,
        avatarUrl: person?.avatar_url ?? null,
        unknownPerson: !person,
        rank: row.rank,
      };
    });
}
