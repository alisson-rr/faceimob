import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { agruparPorDiretoria, type LinhaDaDiretoria } from "./data";

const linha = (over: Partial<LinhaDaDiretoria>): LinhaDaDiretoria => ({
  diretor_id: "d1", diretor_nome: "Fábio", equipe_id: "e1", equipe_nome: "Victor", gerente_nome: "Victor",
  corretor_id: "c1", corretor_nome: "Ana", leads: 0, legado: 0, proposta: 0, negocio: 0, vendas: 0, vgv: 0, off: 0,
  ...over,
});

describe("agruparPorDiretoria", () => {
  it("agrupa por diretoria e equipe, soma os totais e ordena quem vende mais primeiro", () => {
    const grupos = agruparPorDiretoria([
      linha({ corretor_id: "c1", corretor_nome: "Ana", vendas: 1, vgv: 200, proposta: 0.5 }),
      linha({ corretor_id: "c2", corretor_nome: "Bia", vendas: 2, vgv: 300 }),
      linha({ equipe_id: "e2", equipe_nome: "Zona Sul", corretor_id: "c3", corretor_nome: "Caio", leads: 4 }),
      linha({ diretor_id: "d2", diretor_nome: "Archimedes", corretor_id: "c1", corretor_nome: "Ana", vendas: 1, vgv: 200 }),
    ]);
    expect(grupos.map((d) => d.nome)).toEqual(["Archimedes", "Fábio"]);
    const fabio = grupos[1];
    expect(fabio.equipes.map((e) => e.nome)).toEqual(["Victor", "Zona Sul"]);
    expect(fabio.equipes[0].corretores.map((c) => c.nome)).toEqual(["Bia", "Ana"]);
    expect(fabio.total).toMatchObject({ vendas: 3, vgv: 500, proposta: 0.5, leads: 4 });
    expect(fabio.corretores).toBe(3);
  });

  it("equipe sem diretoria fica por último", () => {
    const grupos = agruparPorDiretoria([
      linha({ diretor_id: null, diretor_nome: "Sem diretoria" }),
      linha({ diretor_id: "d9", diretor_nome: "Zé" }),
    ]);
    expect(grupos.map((d) => d.nome)).toEqual(["Zé", "Sem diretoria"]);
  });
});
