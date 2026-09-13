import { describe, expect, it } from "vitest";
import { bloqueioFiliacao, roletasNaTela } from "./roletaAlcance";

// A regra é a da policy `distribution_group_members_write` (0141): `livre`
// (isAdmin do AuthContext = admin ou sócio) grava em tudo; diretor só em roleta
// que o banco já devolveu como alcance dele.
const alcance = new Set(["roleta-da-equipe"]);
const grupos = [{ id: "roleta-da-equipe" }, { id: "roleta-alheia" }];

describe("roletasNaTela", () => {
  it("quem é livre vê todas as roletas, inclusive fora do alcance calculado", () => {
    expect(roletasNaTela({ livre: true, alcance: new Set() }, grupos)).toEqual(grupos);
  });

  it("quem não é livre vê só as roletas que o banco devolveu como alcance", () => {
    expect(roletasNaTela({ livre: false, alcance }, grupos)).toEqual([{ id: "roleta-da-equipe" }]);
  });
});

describe("bloqueioFiliacao", () => {
  it("quem é livre ajusta qualquer roleta, mesmo fora do alcance calculado", () => {
    expect(bloqueioFiliacao({ livre: true, diretor: false, alcance: new Set() }, "roleta-alheia")).toBeNull();
  });

  it("diretor ajusta a roleta que o banco devolveu como alcance", () => {
    expect(bloqueioFiliacao({ livre: false, diretor: true, alcance }, "roleta-da-equipe")).toBeNull();
  });

  it("diretor fica travado, com motivo, na roleta fora do alcance", () => {
    expect(bloqueioFiliacao({ livre: false, diretor: true, alcance }, "roleta-alheia")).toMatch(/fora do seu alcance/i);
  });

  it("quem não é diretor não grava filiação, nem na roleta ao alcance", () => {
    expect(bloqueioFiliacao({ livre: false, diretor: false, alcance }, "roleta-da-equipe")).toMatch(/diretor/i);
  });
});
