import { describe, it, expect } from "vitest";
import { groupObservedIps, leadCountWindows } from "./checkin";

/**
 * O contador de leads do check-in conta a partir do DIA OPERACIONAL do banco
 * (`current_work_date()`, que é a data em America/Sao_Paulo desde a 0057).
 * A versão anterior montava a hora zero em UTC — 21:00 do dia anterior em
 * Brasília — e a janela de "hoje" tinha 27 horas: incluía as três últimas horas
 * do turno da noite de ontem, o dia inteiro, não só perto da virada.
 */
describe("janelas do contador de leads", () => {
  it("o dia começa à meia-noite de São Paulo, não à meia-noite UTC", () => {
    const { day } = leadCountWindows("2026-09-02");
    expect(day.toISOString()).toBe("2026-09-02T03:00:00.000Z");
  });

  it("a semana começa na segunda-feira, também à meia-noite de São Paulo", () => {
    // 02/09/2026 é uma quarta-feira; a segunda é 31/08.
    const { week } = leadCountWindows("2026-09-02");
    expect(week.toISOString()).toBe("2026-08-31T03:00:00.000Z");
  });

  it("segunda-feira é o próprio começo da semana", () => {
    const { week } = leadCountWindows("2026-08-31");
    expect(week.toISOString()).toBe("2026-08-31T03:00:00.000Z");
  });

  it("domingo pertence à semana que começou na segunda anterior", () => {
    // 06/09/2026 é domingo: a semana dele começou em 31/08.
    const { week } = leadCountWindows("2026-09-06");
    expect(week.toISOString()).toBe("2026-08-31T03:00:00.000Z");
  });

  it("o mês começa no dia 1 em São Paulo — não às 21:00 do último dia do mês anterior", () => {
    const { month } = leadCountWindows("2026-09-02");
    expect(month.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("no dia 1 as três janelas continuam coerentes entre si", () => {
    const { day, week, month } = leadCountWindows("2026-09-01");
    expect(day.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(month.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    // 01/09/2026 é terça: a semana começou na segunda, 31/08.
    expect(week.toISOString()).toBe("2026-08-31T03:00:00.000Z");
    expect(week.getTime()).toBeLessThanOrEqual(day.getTime());
  });
});

/**
 * A agregação dos endereços que o SERVIDOR gravou.
 *
 * É ela que responde "qual endereço o gateway enxerga de verdade" na tela de
 * faixas — a pergunta que `api.ipify.org` não responde, porque só devolve IPv4.
 */
describe("endereços vistos pelo servidor", () => {
  it("agrupa por endereço, conta as presenças e guarda a mais recente", () => {
    const linhas = [
      { ip_address: "200.150.10.5", checked_in_at: "2026-09-01T12:00:00Z" },
      { ip_address: "200.150.10.5", checked_in_at: "2026-09-03T12:00:00Z" },
      { ip_address: "200.150.10.9", checked_in_at: "2026-09-02T12:00:00Z" },
    ];
    const [primeiro, segundo] = groupObservedIps(linhas);
    // Mais recente primeiro: é o endereço em uso agora que interessa ao admin.
    expect(primeiro).toEqual({
      ip: "200.150.10.5", ipv6: false, checkins: 2, lastSeen: "2026-09-03T12:00:00Z",
    });
    expect(segundo.ip).toBe("200.150.10.9");
  });

  it("marca IPv6 — é o caso em que a faixa cadastrada por ipify nunca casaria", () => {
    const [linha] = groupObservedIps([
      { ip_address: "2804:14c:5b81:8000::1", checked_in_at: "2026-09-03T12:00:00Z" },
    ]);
    expect(linha.ipv6).toBe(true);
  });

  it("presença sem endereço gravado não vira linha", () => {
    // `perform_checkin` exige IP; nulo é correção manual feita pelo admin.
    expect(groupObservedIps([{ ip_address: null, checked_in_at: "2026-09-03T12:00:00Z" }])).toEqual([]);
  });
});
