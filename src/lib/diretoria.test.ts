import { describe, expect, it } from "vitest";
import { diretoresDe, dirigidoPor } from "./diretoria";

describe("diretoresDe", () => {
  it("um diretor leva tudo; com Diretor 2, meio a meio", () => {
    expect(diretoresDe({ director_id: "fabio" })).toEqual([{ id: "fabio", peso: 1 }]);
    expect(diretoresDe({ director_id: "fabio", co_director_id: "archi" }))
      .toEqual([{ id: "fabio", peso: 0.5 }, { id: "archi", peso: 0.5 }]);
    expect(diretoresDe({})).toEqual([]);
  });

  it("Diretor 2 também dirige a equipe", () => {
    expect(dirigidoPor({ director_id: "fabio", co_director_id: "archi" }, "archi")).toBe(true);
    expect(dirigidoPor({ director_id: "fabio" }, "archi")).toBe(false);
    expect(dirigidoPor({ director_id: null }, null)).toBe(false);
  });
});
