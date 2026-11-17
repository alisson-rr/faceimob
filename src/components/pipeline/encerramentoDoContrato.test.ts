import { describe, expect, it } from "vitest";
import { encerramentoDoContrato } from "./DealOffToggle";

describe("encerramentoDoContrato (0341)", () => {
  it("mês vigente é Queda; mês anterior, inclusive de outro ano, é Distrato", () => {
    expect(encerramentoDoContrato("11/2026", "11/2026")).toBe("QUEDA");
    expect(encerramentoDoContrato("10/2026", "11/2026")).toBe("DISTRATO");
    expect(encerramentoDoContrato("12/2025", "01/2026")).toBe("DISTRATO");
  });
  it("sem mês, mostra Queda (o banco confirma)", () => {
    expect(encerramentoDoContrato(undefined, "11/2026")).toBe("QUEDA");
  });
});
