import { describe, expect, it } from "vitest";
import { feiraoNoAr } from "./MotivationalPopup";

describe("feiraoNoAr", () => {
  it("fica no ar os 45 dias, de 07/11 a 21/12/2026", () => {
    expect(feiraoNoAr("2026-11-06")).toBe(false);
    expect(feiraoNoAr("2026-11-07")).toBe(true);
    expect(feiraoNoAr("2026-12-21")).toBe(true);
    expect(feiraoNoAr("2026-12-22")).toBe(false);
  });
});
