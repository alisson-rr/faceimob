import { describe, expect, it } from "vitest";
import { campoCsv, lerLinhas3c, montarCsv3c, periodoDe } from "./exportacao3c";

const id = "d8fbbbb6-4553-4560-b821-d6e3fb466677";

describe("exportação 3C (0360)", () => {
  it("sai com as quatro colunas da 3C e o identificador em branco", () => {
    expect(montarCsv3c([{ leadId: id, nome: "Ricardo F. Barbosa", telefone: "51989373011" }]))
      .toBe(`identificador,telefone,nome,lead_id\r\n,51989373011,Ricardo F. Barbosa,${id}\r\n`);
  });

  it("descarta linha sem lead_id válido ou com telefone fora do formato", () => {
    expect(lerLinhas3c([
      { lead_id: id, nome: " Ana ", telefone: "51999990000" },
      { lead_id: "x", nome: "Sem id", telefone: "51999990001" },
      { lead_id: id, nome: "Fone curto", telefone: "9999" },
    ])).toEqual([{ leadId: id, nome: "Ana", telefone: "51999990000" }]);
  });

  it("nome com vírgula vai entre aspas e não vira fórmula", () => {
    expect(campoCsv("Silva, Ana")).toBe('"Silva, Ana"');
    expect(campoCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });

  it("período de janeiro a junho vai até o fim de junho; invertido é recusado", () => {
    expect(periodoDe("2026-01", "2026-06")).toEqual({ inicio: "2026-01-01", fim: "2026-07-01" });
    expect(periodoDe("2026-06", "2026-01")).toBeNull();
  });
});
