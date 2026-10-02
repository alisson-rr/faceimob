import { describe, expect, it } from "vitest";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { linhasDeCorretores } from "./listaDeCorretores";

const pessoa = (id: string, extra: Partial<PersonRecord>): PersonRecord => ({
  id, user_id: id, name: id, full_name: id, email: null, phone: null, avatar_url: null, active: true,
  status: "active", roles: ["broker"], role: "broker", team_id: null, team: "", manager_id: null, director_id: null,
  ...extra,
});

describe("lista de corretores", () => {
  it("só corretores, ativos primeiro, com gerente e diretor pelo nome", () => {
    const linhas = linhasDeCorretores([
      pessoa("Gerente G", { role: "manager", roles: ["manager"] }),
      pessoa("Diretor D", { role: "director", roles: ["director"] }),
      pessoa("Zeca", { manager_id: "Gerente G", director_id: "Diretor D", team: "Equipe G", phone: "51999" }),
      pessoa("Ana Saiu", { active: false, status: "terminated" }),
      pessoa("Bia", {}),
    ]);
    expect(linhas.map((l) => l[0])).toEqual(["Bia", "Zeca", "Ana Saiu"]);
    expect(linhas[1]).toEqual(["Zeca", "", "51999", "Equipe G", "Gerente G", "Diretor D", "Ativo"]);
    expect(linhas[2][6]).toBe("Desligado");
  });
});
