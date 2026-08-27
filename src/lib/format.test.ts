import { describe, expect, it } from "vitest";
import { brl, date, dateTime, num } from "./format";

describe("format", () => {
  it("formata BRL sem centavos por padrao", () => {
    expect(brl(1200000)).toBe("R$ 1.200.000");
    expect(brl(1200000, { cents: true })).toBe("R$ 1.200.000,00");
  });

  it("devolve travessao para valor ausente em vez de NaN", () => {
    expect(brl(null)).toBe("—");
    expect(brl(undefined)).toBe("—");
    expect(brl(Number.NaN)).toBe("—");
    expect(num(null)).toBe("—");
    expect(date(null)).toBe("—");
    expect(date("")).toBe("—");
    expect(dateTime("nao e data")).toBe("—");
  });

  it("le data do Postgres como data local, sem perder um dia no fuso", () => {
    // new Date("2026-08-21") seria meia-noite UTC => 20/08 no horario de Brasilia.
    expect(date("2026-08-21")).toBe("21/08/2026");
  });

  it("formata data e hora de um timestamp", () => {
    expect(dateTime(new Date(2026, 7, 21, 14, 30))).toBe("21/08/2026 14:30");
  });
});
