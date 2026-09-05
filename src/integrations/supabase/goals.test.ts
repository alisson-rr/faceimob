import { describe, expect, it } from "vitest";
import { monthInputToPeriodIso } from "./newSchema";

describe("monthInputToPeriodIso", () => {
  it("vira o YYYY-MM do input em primeiro dia do mês, como goals.period guarda", () => {
    expect(monthInputToPeriodIso("2026-09")).toBe("2026-09-01");
    expect(monthInputToPeriodIso("2031-12")).toBe("2031-12-01");
  });

  it("devolve null para campo limpo ou mês fora de 01..12, em vez de mandar data inválida ao banco", () => {
    expect(monthInputToPeriodIso("")).toBeNull();
    expect(monthInputToPeriodIso("2026-13")).toBeNull();
    expect(monthInputToPeriodIso("2026-00")).toBeNull();
    expect(monthInputToPeriodIso("2026-09-01")).toBeNull();
  });
});
