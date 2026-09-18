import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ccaStageColor } from "@/components/pipeline/ccaStage";
import { pipelineStageColor } from "@/components/pipeline/stages";
import {
  CHART_SERIES, TONE_HEX, developerColor, isDeveloperColor, isHexColor, labelToken, podiumRingClass,
  podiumTextClass, podiumToken, seriesToken, textOn, tone,
} from "./tone";

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

describe("labelToken", () => {
  it("a mesma etapa fica com a mesma cor quando a lista muda de ordem", () => {
    // O contrato de que `BarList` e o `CcaStatusCard` dependem: as duas listas
    // sao ordenadas por VALOR e recortadas por periodo, entao cor por indice
    // repintava a lista inteira a cada mes.
    const etapas = ["Qualificação", "Proposta", "Fechado"];
    expect([...etapas].reverse().map(labelToken).reverse()).toEqual(etapas.map(labelToken));
  });

  it("um funil inteiro nao sai de uma cor so", () => {
    // O pedido do cliente em 17/09/2026: "Negócios por etapa" era todo azul.
    const cores = new Set(["Qualificação", "Proposta", "Fechado"].map(labelToken));
    expect(cores.size).toBeGreaterThan(1);
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

describe("classes do podio", () => {
  it("a base e a mesma de podiumToken: 0 e o ouro", () => {
    // Havia tres implementacoes desta cor, uma delas de base 1. Se a base
    // voltar a divergir, o 2o colocado sai de ouro em alguma tela.
    expect(podiumTextClass(0)).toBe("text-gold");
    expect(podiumTextClass(1)).toBe("text-silver");
    expect(podiumTextClass(2)).toBe("text-bronze");
    expect(podiumRingClass(0)).toBe("ring-gold");
  });

  it("fora do podio nao ha medalha", () => {
    expect(podiumTextClass(3)).toBe("text-muted-foreground");
    expect(podiumTextClass(-1)).toBe("text-muted-foreground");
    expect(podiumRingClass(3)).toBe("ring-border");
  });
});

describe("tone", () => {
  it("monta a cor com e sem alfa", () => {
    expect(tone("primary")).toBe("hsl(var(--primary))");
    expect(tone("primary", 0.4)).toBe("hsl(var(--primary) / 0.4)");
  });
});

// ─── Kanban colorido (18/09/2026) ───────────────────────────────────────────

/** WCAG 2.x escrito de novo aqui, e não importado: se `textOn` errar a conta,
 *  o teste não pode errar junto. */
const lum = (hex: string) => {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
};
const razao = (a: string, b: string) => {
  const [claro, escuro] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
};

/** Hex de verdade, lidos dos arquivos — a cor inicial de cada coluna da CCA
 *  (0153) e a de cada etapa do Pipeline (seed). */
const hexDe = (arquivo: string) =>
  [...readFileSync(resolve(__dirname, arquivo), "utf8").matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map(([, hex]) => hex);
const HEX_CCA = hexDe("../../supabase/migrations/20260918090000_0153_cor_das_colunas_cca.sql");
const HEX_PIPELINE = hexDe("../../supabase/seed.sql");

describe("isHexColor", () => {
  it("aceita só #RRGGBB, o que o seletor nativo devolve", () => {
    expect(["#000000", "#abcdef", "#ABCDEF"].every(isHexColor)).toBe(true);
    expect(["", "red", "#abc", "#abcdefa", " #abcdef", "#gggggg", "warning", "url(x)", null, undefined]
      .some(isHexColor)).toBe(false);
  });

  it("isDeveloperColor continua sendo a mesma regra", () => {
    expect(isDeveloperColor).toBe(isHexColor);
  });
});

describe("cor da coluna do kanban", () => {
  it("CCA: hex gravado vale; chave, classe antiga, lixo e nulo viram o hex do tom", () => {
    expect(ccaStageColor("#1a2b3c")).toBe("#1a2b3c");
    expect(ccaStageColor("warning")).toBe(TONE_HEX.warning);
    expect(ccaStageColor("text-emerald-500")).toBe(TONE_HEX.success);
    expect(ccaStageColor("cor-inventada")).toBe(TONE_HEX.neutral);
    expect(ccaStageColor("#abc")).toBe(TONE_HEX.neutral);
    expect(ccaStageColor(null)).toBe(TONE_HEX.neutral);
    expect(ccaStageColor(undefined)).toBe(TONE_HEX.neutral);
  });

  it("Pipeline: hex do banco vale; sem ele, o tom da etapa", () => {
    expect(pipelineStageColor({ code: "approved", color: "#34d399" })).toBe("#34d399");
    expect(pipelineStageColor({ code: "approved", color: null })).toBe(TONE_HEX.success);
    expect(pipelineStageColor({ code: "approved" })).toBe(TONE_HEX.success);
    expect(pipelineStageColor({ code: "approved", color: "text-green-500" })).toBe(TONE_HEX.success);
    expect(pipelineStageColor({ code: "etapa_nova", color: "lixo" })).toBe(TONE_HEX.neutral);
  });
});

describe("textOn", () => {
  it("leu as cores dos dois arquivos", () => {
    // Regex que não casa nada deixaria os testes abaixo passando no vazio.
    expect(HEX_CCA.length).toBeGreaterThanOrEqual(19);
    expect(HEX_PIPELINE.length).toBeGreaterThanOrEqual(9);
  });

  it("devolve só preto ou branco", () => {
    expect(textOn("#FFFFFF")).toBe("#000000");
    expect(textOn("#000000")).toBe("#FFFFFF");
  });

  it("dá 4,5:1 ou mais sobre toda cor de coluna que existe", () => {
    const fracas = [...Object.values(TONE_HEX), ...HEX_CCA, ...HEX_PIPELINE]
      .map((hex) => ({ hex, razao: razao(textOn(hex), hex) }))
      .filter(({ razao: r }) => r < 4.5);
    expect(fracas).toEqual([]);
  });

  it("escolhe o de MAIOR contraste, não só um que passe", () => {
    for (const hex of [...Object.values(TONE_HEX), ...HEX_CCA, ...HEX_PIPELINE]) {
      const outro = textOn(hex) === "#000000" ? "#FFFFFF" : "#000000";
      expect(razao(textOn(hex), hex), hex).toBeGreaterThanOrEqual(razao(outro, hex));
    }
  });
});
