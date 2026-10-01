import { describe, expect, it } from "vitest";
import { cpfsParaBatida, lerNegocioDoCpf } from "./batidaCpf";

describe("batida de CPF", () => {
  it("bate só CPF com 11 dígitos, com ou sem máscara, sem repetir", () => {
    expect(cpfsParaBatida({ cpf: "111.444.777-35", cpf2: "11144477735" })).toEqual(["11144477735"]);
    expect(cpfsParaBatida({ cpf: "123", cpf2: "" })).toEqual([]);
    expect(cpfsParaBatida({ cpf: null, cpf2: "529.982.247-25" })).toEqual(["52998224725"]);
  });

  it("linha da RPC é validada antes de virar popup", () => {
    expect(lerNegocioDoCpf({ deal_id: "d1", situacao: "encerrado", corretor: "Ana", gerente: "" }))
      .toMatchObject({ deal_id: "d1", situacao: "encerrado", corretor: "Ana", gerente: null });
    expect(lerNegocioDoCpf({ deal_id: "d1", situacao: "outra" })).toBeNull();
    expect(lerNegocioDoCpf(null)).toBeNull();
  });
});
