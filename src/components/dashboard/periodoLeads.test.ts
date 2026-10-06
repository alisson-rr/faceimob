import { describe, expect, it } from "vitest";
import { diasDoIntervalo, intervaloDoPeriodo, rotuloDoIntervalo } from "./periodoLeads";

// Sexta-feira, 03/10/2026, 15h no horário local do teste.
const AGORA = new Date(2026, 9, 3, 15, 0, 0);
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe("períodos dos leads", () => {
  it("hoje, ontem, semana (desde segunda), mês e mês passado", () => {
    const hoje = intervaloDoPeriodo("hoje", AGORA)!;
    expect([ymd(hoje.de), ymd(hoje.ate)]).toEqual(["2026-10-3", "2026-10-4"]);
    const ontem = intervaloDoPeriodo("ontem", AGORA)!;
    expect([ymd(ontem.de), ymd(ontem.ate)]).toEqual(["2026-10-2", "2026-10-3"]);
    const semana = intervaloDoPeriodo("semana", AGORA)!;
    expect(ymd(semana.de)).toBe("2026-9-28");
    const mes = intervaloDoPeriodo("mes", AGORA)!;
    expect([ymd(mes.de), ymd(mes.ate)]).toEqual(["2026-10-1", "2026-10-4"]);
    const passado = intervaloDoPeriodo("mes_passado", AGORA)!;
    expect([ymd(passado.de), ymd(passado.ate)]).toEqual(["2026-9-1", "2026-10-1"]);
  });

  it("personalizado inclui o último dia e recusa intervalo invertido", () => {
    const custom = intervaloDoPeriodo("custom", AGORA, { de: "2026-09-10", ate: "2026-09-12" })!;
    expect([ymd(custom.de), ymd(custom.ate)]).toEqual(["2026-9-10", "2026-9-13"]);
    expect(diasDoIntervalo(custom)).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(rotuloDoIntervalo("custom", custom)).toBe("10/09 a 12/09");
    expect(intervaloDoPeriodo("custom", AGORA, { de: "2026-09-12", ate: "2026-09-10" })).toBeNull();
    expect(intervaloDoPeriodo("filtro", AGORA)).toBeNull();
  });
});
