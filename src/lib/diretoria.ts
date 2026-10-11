/**
 * Diretores de uma equipe e o peso de cada um no rateio (0266).
 *
 * Equipe com Diretor 2 (`co_director_id`) divide 50/50: meia venda, meio VGV e
 * meia meta para cada diretor. Sem Diretor 2, o diretor leva tudo. Mesma regra
 * da view `equipe_diretores` no banco.
 */
export type ComDiretores = { director_id?: string | null; co_director_id?: string | null };

export function diretoresDe(x: ComDiretores | null | undefined): Array<{ id: string; peso: number }> {
  const ids = [x?.director_id, x?.co_director_id].filter((id): id is string => Boolean(id));
  const unicos = [...new Set(ids)];
  return unicos.map((id) => ({ id, peso: 1 / unicos.length }));
}

/** A pessoa (ou equipe) é dirigida por `diretorId`, como Diretor 1 ou 2? */
export const dirigidoPor = (x: ComDiretores | null | undefined, diretorId: string | null | undefined) =>
  Boolean(diretorId) && (x?.director_id === diretorId || x?.co_director_id === diretorId);
