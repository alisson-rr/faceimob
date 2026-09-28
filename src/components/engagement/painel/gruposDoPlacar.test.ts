import { describe, expect, it } from "vitest";
import type { RankingRow } from "@/integrations/supabase/game";
import { gruposDoPlacar } from "./gruposDoPlacar";

const linha = (profile_id: string, extra: Partial<RankingRow>): RankingRow => ({
  season_id: "s", profile_id, full_name: profile_id, avatar_url: null, active: true, points: 0, sales: 0, vgv: 0,
  breakdown: null, team_id: null, team_name: null, manager_id: null, manager_name: null,
  director_id: null, director_name: null, ...extra,
});

const placar = [
  linha("c1", { director_id: "d2", director_name: "Zélia Maria Souza", manager_id: "g1", manager_name: "Gil Ramos" }),
  linha("c2", { director_id: "d1", director_name: "Ana Paula Lima", manager_id: "d1", manager_name: "Ana Paula Lima" }),
  linha("c3", {}),
  linha("c4", { director_id: "d1", director_name: "Ana Paula Lima", manager_id: "g1", manager_name: "Gil Ramos" }),
];

describe("gruposDoPlacar", () => {
  it("admin vê por diretoria, em ordem alfabética, e quem não tem diretoria no fim", () => {
    const grupos = gruposDoPlacar(placar, "empresa", "adm");
    expect(grupos.map((g) => g.titulo)).toEqual(["Diretoria Ana Lima", "Diretoria Zélia Souza", "Sem diretoria"]);
    expect(grupos[0].linhas.map((l) => l.profile_id)).toEqual(["c2", "c4"]);
  });

  it("diretor vê por gerência, com a própria equipe primeiro", () => {
    const grupos = gruposDoPlacar(placar.slice(1, 2).concat(placar[3]), "diretoria", "d1");
    expect(grupos.map((g) => g.titulo)).toEqual(["Sua equipe", "Gerência Gil Ramos"]);
  });

  it("gerente e corretor veem a equipe inteira, sem divisão e na ordem do placar", () => {
    const grupos = gruposDoPlacar(placar, "equipe", "c1");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulo).toBeNull();
    expect(grupos[0].linhas.map((l) => l.profile_id)).toEqual(["c1", "c2", "c3", "c4"]);
  });
});
