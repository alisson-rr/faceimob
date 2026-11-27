import { describe, expect, it } from "vitest";
import { entregasDa3c } from "./data";

const ev = (lead_id: string, kind: string, desfecho: string | null, created_at: string) =>
  ({ lead_id, kind, detail: desfecho ? { desfecho } : {}, created_at });

describe("entregasDa3c", () => {
  it("guarda a visita e a data da entrega mais recente", () => {
    const mapa = entregasDa3c([
      ev("a", "voice_ai_call", "agendado", "2026-11-27T15:41:00Z"),
      ev("a", "voice_ai_call", "interessado", "2026-11-27T16:00:00Z"),
      ev("b", "voice_ai_call", "nao_qualificado", "2026-11-27T16:00:00Z"),
      ev("c", "interessado_3c_roleta", null, "2026-11-26T12:00:00Z"),
    ]);
    expect(mapa.get("a")).toEqual({ tipo: "agenda", em: "2026-11-27T16:00:00Z" });
    expect(mapa.has("b")).toBe(false);
    expect(mapa.get("c")).toEqual({ tipo: "interessado", em: "2026-11-26T12:00:00Z" });
  });
});
