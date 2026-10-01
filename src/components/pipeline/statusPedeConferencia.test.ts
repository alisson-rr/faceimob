import { describe, expect, it } from "vitest";
import { statusPedeConferencia } from "./DealForm";

describe("statusPedeConferencia", () => {
  it("Esteira Ágil no Status 2 vira envio ao gerente, com ou sem o número", () => {
    expect(statusPedeConferencia("13. ESTEIRA AGIL")).toBe(true);
    expect(statusPedeConferencia("ESTEIRA AGIL")).toBe(true);
  });

  it("os outros Status 2 seguem o caminho de sempre", () => {
    expect(statusPedeConferencia("EM ANÁLISE")).toBe(false);
    expect(statusPedeConferencia("06. ENVIO DE RP")).toBe(false);
  });
});
