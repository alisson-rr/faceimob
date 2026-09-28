import type { RankingRow } from "@/integrations/supabase/game";
import { primeiroEUltimoNome } from "@/lib/format";

export type GrupoDoPlacar = { chave: string; titulo: string | null; linhas: RankingRow[] };

/**
 * Como os Destaques se dividem por quem olha (pedido de 28/09/2026):
 *   · admin/sócio → um bloco por diretoria;
 *   · diretor     → um bloco por gerência da diretoria dele — a equipe que ele
 *                   mesmo gerencia entra como "Sua equipe" (diretor também é
 *                   gerente);
 *   · gerente e corretor → a equipe, sem divisão.
 * Quem entra em cada lista continua sendo decisão do banco
 * (`can_see_game_profile`); aqui só se agrupa o que chegou, preservando a
 * ordem do placar. Blocos em ordem alfabética, "Sem …" no fim.
 */
export function gruposDoPlacar(
  linhas: RankingRow[],
  visao: "empresa" | "diretoria" | "equipe",
  meuId: string | null | undefined,
): GrupoDoPlacar[] {
  if (visao === "equipe") return [{ chave: "equipe", titulo: null, linhas }];

  const porDiretoria = visao === "empresa";
  const grupos = new Map<string, GrupoDoPlacar>();
  for (const linha of linhas) {
    const id = porDiretoria ? linha.director_id : linha.manager_id;
    const nome = porDiretoria ? linha.director_name : linha.manager_name;
    const chave = id ?? "sem";
    const titulo = !id
      ? (porDiretoria ? "Sem diretoria" : "Sem gerência")
      : !porDiretoria && id === meuId
        ? "Sua equipe"
        : `${porDiretoria ? "Diretoria" : "Gerência"} ${primeiroEUltimoNome(nome) || "sem nome"}`;
    const grupo = grupos.get(chave) ?? { chave, titulo, linhas: [] };
    grupo.linhas.push(linha);
    grupos.set(chave, grupo);
  }

  const peso = (grupo: GrupoDoPlacar) => (grupo.chave === "sem" ? 2 : grupo.titulo === "Sua equipe" ? 0 : 1);
  return [...grupos.values()].sort((a, b) =>
    peso(a) - peso(b) || (a.titulo ?? "").localeCompare(b.titulo ?? "", "pt-BR"));
}
