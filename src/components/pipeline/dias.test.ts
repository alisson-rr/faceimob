import { describe, expect, it } from "vitest";
import { diasNoStatus } from "./dias";

describe("diasNoStatus", () => {
  it("conta desde a última troca do Status 2, não desde a criação", () => {
    expect(diasNoStatus({ days_in_pipeline: 49, days_in_status: 3 })).toBe(3);
    expect(diasNoStatus({ days_in_pipeline: 49, days_in_status: 0 })).toBe(0);
  });

  it("sem a data da troca, vale a idade do negócio", () => {
    expect(diasNoStatus({ days_in_pipeline: 49 })).toBe(49);
  });
});
