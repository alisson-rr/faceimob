import { describe, expect, it } from "vitest";
import { elapsedDays, elapsedLabel } from "./ccaTime";

describe("tempo no status CCA", () => {
  it("conta dias completos, incluindo mudança de mês, e não inventa data", () => {
    const now = Date.parse("2026-10-02T15:00:00Z");
    expect(elapsedDays("2026-09-30T15:00:00Z", now)).toBe(2);
    expect(elapsedDays("2026-10-01T15:01:00Z", now)).toBe(0);
    expect(elapsedDays("2026-10-03T15:00:00Z", now)).toBe(0);
    expect(elapsedDays(null, now)).toBeNull();
    expect(elapsedDays("inválido", now)).toBeNull();
    expect(elapsedLabel(2)).toBe("2 dias");
    expect(elapsedLabel(null)).toBe("Tempo não informado");
  });
});
