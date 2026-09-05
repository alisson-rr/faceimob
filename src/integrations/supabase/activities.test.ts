import { describe, expect, it } from "vitest";
import { dueBucket, groupTasksByDue, isTaskOverdue, type TaskRecord } from "./activities";

// Terça, 01/09/2026 15:00 no fuso do runner. As fronteiras são todas relativas
// a este instante, então o fuso em si não muda o resultado.
const NOW = new Date(2026, 8, 1, 15, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString();

describe("dueBucket", () => {
  it("sem prazo vai para a própria faixa", () => {
    expect(dueBucket(null, NOW)).toBe("sem_prazo");
  });

  it("um minuto antes de agora está atrasada", () => {
    expect(dueBucket(iso(new Date(NOW.getTime() - 60_000)), NOW)).toBe("atrasadas");
  });

  it("agora mesmo ainda não está atrasada: vence hoje", () => {
    expect(dueBucket(iso(NOW), NOW)).toBe("hoje");
  });

  it("23:59:59.999 de hoje continua sendo hoje", () => {
    expect(dueBucket(iso(new Date(2026, 8, 1, 23, 59, 59, 999)), NOW)).toBe("hoje");
  });

  it("00:00 de amanhã já é a semana", () => {
    expect(dueBucket(iso(new Date(2026, 8, 2, 0, 0, 0, 0)), NOW)).toBe("semana");
  });

  it("exatamente 7 dias à frente ainda entra na semana", () => {
    expect(dueBucket(iso(new Date(NOW.getTime() + 7 * DAY_MS)), NOW)).toBe("semana");
  });

  it("7 dias e um milissegundo é depois", () => {
    expect(dueBucket(iso(new Date(NOW.getTime() + 7 * DAY_MS + 1)), NOW)).toBe("depois");
  });
});

describe("groupTasksByDue", () => {
  const tasks = [
    { id: "a", due_at: iso(new Date(NOW.getTime() - DAY_MS)) },
    { id: "b", due_at: iso(new Date(2026, 8, 1, 18, 0)) },
    { id: "c", due_at: iso(new Date(NOW.getTime() + 3 * DAY_MS)) },
    { id: "d", due_at: iso(new Date(NOW.getTime() + 30 * DAY_MS)) },
    { id: "e", due_at: null },
    { id: "f", due_at: iso(new Date(NOW.getTime() - 2 * DAY_MS)) },
  ];

  it("distribui cada atividade em uma faixa só e preserva a ordem de entrada", () => {
    const groups = groupTasksByDue(tasks, NOW);
    expect(groups.atrasadas.map((t) => t.id)).toEqual(["a", "f"]);
    expect(groups.hoje.map((t) => t.id)).toEqual(["b"]);
    expect(groups.semana.map((t) => t.id)).toEqual(["c"]);
    expect(groups.depois.map((t) => t.id)).toEqual(["d"]);
    expect(groups.sem_prazo.map((t) => t.id)).toEqual(["e"]);
  });

  it("devolve todas as faixas mesmo sem atividade", () => {
    expect(groupTasksByDue([], NOW)).toEqual({ atrasadas: [], hoje: [], semana: [], depois: [], sem_prazo: [] });
  });
});

describe("isTaskOverdue", () => {
  const task = (over: Partial<TaskRecord>): TaskRecord => ({
    id: "t", title: "x", description: null, assigned_to: null, created_by: null,
    due_at: null, completed_at: null, status: "open", priority: "normal",
    ref_type: null, ref_id: null, created_at: iso(NOW), ...over,
  });

  it("só conta atividade aberta com prazo no passado", () => {
    const passado = iso(new Date(NOW.getTime() - 1));
    expect(isTaskOverdue(task({ due_at: passado }), NOW)).toBe(true);
    expect(isTaskOverdue(task({ due_at: passado, status: "done", completed_at: iso(NOW) }), NOW)).toBe(false);
    expect(isTaskOverdue(task({ due_at: null }), NOW)).toBe(false);
  });
});
