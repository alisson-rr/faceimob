import { describe, expect, it } from "vitest";
import { CHART_SERIES, developerColor, podiumToken, seriesToken, tone } from "./tone";

describe("developerColor", () => {
  it("da sempre a mesma cor para o mesmo nome, independente de caixa e espaco", () => {
    // O achado T05 era exatamente isto: "MRV" verde numa tela e ambar noutra.
    expect(developerColor("MRV")).toBe(developerColor("mrv"));
    expect(developerColor("MRV")).toBe(developerColor("  Mrv "));
  });

  it("nao muda quando outra construtora entra na lista", () => {
    // A versao antiga era `SERIES[i % 5]` sobre a lista ordenada: bastava uma
    // construtora nova comecada por A para todas as outras trocarem de cor.
    const antes = ["MRV", "TENDA", "VASCO"].map(developerColor);
    const depois = ["ABACO", "MRV", "TENDA", "VASCO"].map(developerColor).slice(1);
    expect(depois).toEqual(antes);
  });

  it("responde com um token de serie, sempre", () => {
    for (const name of ["", "MRV", "Melnick", "Construtora com nome bem longo"]) {
      expect(CHART_SERIES).toContain(developerColor(name));
    }
  });
});

describe("seriesToken", () => {
  it("da a volta na paleta em vez de estourar o indice", () => {
    expect(seriesToken(0)).toBe("chart-1");
    expect(seriesToken(5)).toBe("chart-1");
    expect(seriesToken(-1)).toBe("chart-5");
  });
});

describe("podiumToken", () => {
  it("premia so os tres primeiros", () => {
    expect(podiumToken(0)).toBe("gold");
    expect(podiumToken(2)).toBe("bronze");
    expect(podiumToken(3)).toBeNull();
  });
});

describe("tone", () => {
  it("monta a cor com e sem alfa", () => {
    expect(tone("primary")).toBe("hsl(var(--primary))");
    expect(tone("primary", 0.4)).toBe("hsl(var(--primary) / 0.4)");
  });
});
