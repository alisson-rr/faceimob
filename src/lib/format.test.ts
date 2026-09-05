import { describe, expect, it } from "vitest";
import { brl, date, dateTime, monthStart, num, parseBrl, parseMonthStart } from "./format";

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

describe("monthStart", () => {
  it("usa o mes local, inclusive entre 21h e 23h59 (quando o UTC ja virou o dia)", () => {
    // Datas montadas por componente local: valem em qualquer fuso da maquina.
    expect(monthStart(new Date(2026, 8, 1, 21, 30))).toBe("2026-09-01");
    expect(monthStart(new Date(2026, 8, 30, 23, 59))).toBe("2026-09-01");
    expect(monthStart(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-01");
    expect(monthStart(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("nao passa pelo UTC — o caminho antigo estourava o dia em fuso negativo", () => {
    const night = new Date(2026, 8, 1, 21, 30);
    // Em UTC-3 `toISOString()` da "2026-09-02"; o helper tem de ignorar isso.
    if (night.getTimezoneOffset() > 0) {
      expect(night.toISOString().slice(0, 10)).not.toBe("2026-09-01");
    }
    expect(monthStart(night)).toBe("2026-09-01");
  });
});

describe("parseMonthStart", () => {
  it("aceita os formatos de mes que uma planilha traz", () => {
    expect(parseMonthStart("2026-08")).toBe("2026-08-01");
    expect(parseMonthStart("2026-8-15")).toBe("2026-08-01");
    expect(parseMonthStart("08/2026")).toBe("2026-08-01");
    expect(parseMonthStart("01/08/2026")).toBe("2026-08-01");
    expect(parseMonthStart(" 8/2026 ")).toBe("2026-08-01");
    expect(parseMonthStart(new Date(2026, 7, 1).toString())).toBe("2026-08-01");
  });

  it("recusa o que nao e mes em vez de inventar data", () => {
    expect(parseMonthStart("13/2026")).toBeNull();
    expect(parseMonthStart("2026-00")).toBeNull();
    expect(parseMonthStart("1")).toBeNull();
    expect(parseMonthStart("agosto")).toBeNull();
    expect(parseMonthStart("")).toBeNull();
    expect(parseMonthStart(null)).toBeNull();
  });
});

describe("parseBrl", () => {
  it("le valor em pt-BR, com ou sem R$, milhar e centavos", () => {
    expect(parseBrl("R$ 5.000,50")).toBe(5000.5);
    expect(parseBrl("5.000")).toBe(5000);
    expect(parseBrl("1.234.567,89")).toBe(1234567.89);
    expect(parseBrl("5000")).toBe(5000);
    expect(parseBrl("5000.5")).toBe(5000.5);
    expect(parseBrl("0")).toBe(0);
  });

  it("devolve null para texto que nao e numero", () => {
    expect(parseBrl("cinco mil")).toBeNull();
    expect(parseBrl("5.00.0")).toBeNull();
    expect(parseBrl("")).toBeNull();
    expect(parseBrl(undefined)).toBeNull();
  });
});
