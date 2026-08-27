import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_STAGES } from "@/types/crm";
import { LOST_STAGE_CODE, funnelStages, stageLabelOf, stageSurface, stageTone } from "./stages";
import { FACEIMOB_STATUSES, faceimobStatusTone, statusChoices } from "./statuses";
import { CCA_TONE_CLASS, ccaStageTone } from "./ccaStage";

/**
 * Trava da fonte única de etapa (achados F10 e F11).
 *
 * A tela lia o rótulo de três lugares que discordavam: `DEAL_STAGES`,
 * o `tableStageLabels` do Pipeline e a coluna `pipeline_stages.label`, que
 * ninguém consultava. Este teste lê o seed DE VERDADE — como
 * `theme-contrast.test.ts` faz com o `index.css` — para que o dia em que o
 * banco ganhar ou renomear uma etapa a divergência apareça aqui, e não numa
 * coluna colorida de cinza em produção.
 */
const seed = readFileSync(resolve(__dirname, "../../../supabase/seed.sql"), "utf8");

/** `('closed', 'Fechado', 8, 'won', …)` → { code, label, position }. */
const seededStages = (() => {
  const block = /insert into public\.pipeline_stages[^;]+;/i.exec(seed);
  if (!block) throw new Error("bloco de pipeline_stages não encontrado em supabase/seed.sql");
  return [...block[0].matchAll(/\('([a-z_]+)',\s*'([^']+)',\s*(\d+),/g)].map((row) => ({
    code: row[1],
    label: row[2],
    position: Number(row[3]),
  }));
})();

describe("catálogo de etapas", () => {
  it("o seed traz as nove etapas, incluindo a de perda", () => {
    expect(seededStages).toHaveLength(9);
    expect(seededStages.map((stage) => stage.code)).toContain(LOST_STAGE_CODE);
  });

  it("DEAL_STAGES espelha o rótulo e a ordem do banco", () => {
    const doBanco = seededStages
      .filter((stage) => stage.code !== LOST_STAGE_CODE)
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({ value: stage.code, label: stage.label }));
    expect(DEAL_STAGES).toEqual(doBanco);
  });

  it("toda etapa do banco tem tom próprio — nenhuma cai no neutro por engano", () => {
    const semTom = seededStages.filter((stage) => stageTone(stage.code) === "neutral");
    expect(semTom.map((stage) => stage.code)).toEqual(["lead"]);
  });

  it("todo tom tem classe literal, senão o Tailwind não compila a regra", () => {
    for (const stage of seededStages) {
      const surface = stageSurface(stage.code);
      expect(surface.dot.startsWith("bg-"), stage.code).toBe(true);
      expect(surface.border.startsWith("border-"), stage.code).toBe(true);
    }
  });

  it("a etapa de perda não vira coluna do funil", () => {
    const stages = seededStages.map((stage, index) => ({
      id: `id-${index}`, code: stage.code, label: stage.label, position: stage.position,
    }));
    expect(funnelStages(stages).map((stage) => stage.code)).not.toContain(LOST_STAGE_CODE);
    // E o rótulo continua resolvendo: era ele que virava "PROPOSTA" na tabela.
    expect(stageLabelOf(stages, LOST_STAGE_CODE)).toBe("Perdido");
  });

  it("etapa criada depois do seed não fica sem cor nem sem rótulo", () => {
    expect(stageTone("etapa_nova_do_admin")).toBe("neutral");
    expect(stageLabelOf([], "etapa_nova_do_admin")).toBe("etapa_nova_do_admin");
  });
});

describe("catálogo de Status 2", () => {
  it("não repete rótulo", () => {
    const labels = FACEIMOB_STATUSES.map((status) => status.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('mantém o acento de "08. VIROU NEGÓCIO"', () => {
    // O achado F10 nasceu de "VIROU NEGOCIO" sem acento: o valor não batia com
    // nenhum item e o Select da tabela abria vazio.
    const label = "08. VIROU NEGÓCIO";
    expect(FACEIMOB_STATUSES.some((status) => status.label === label)).toBe(true);
    expect(faceimobStatusTone(label)).not.toBe("neutral");
  });

  it("o valor gravado sempre aparece nas opções, mesmo fora do catálogo", () => {
    const desconhecido = "STATUS VINDO DE IMPORTAÇÃO";
    const opcoes = statusChoices(desconhecido).map((status) => status.label);
    expect(opcoes[0]).toBe(desconhecido);
    expect(opcoes).toHaveLength(FACEIMOB_STATUSES.length + 1);

    // Já um valor conhecido não pode ser duplicado no topo.
    expect(statusChoices("PROPOSTA")).toHaveLength(FACEIMOB_STATUSES.length);
  });

  it("status desconhecido tem tom neutro em vez de quebrar", () => {
    expect(faceimobStatusTone("ALGO QUE NÃO EXISTE")).toBe("neutral");
    expect(faceimobStatusTone(null)).toBe("neutral");
  });
});

describe("cor do estágio CCA (T14)", () => {
  it("lê os três formatos que existem no banco", () => {
    expect(ccaStageTone("warning")).toBe("warning");       // chave nova
    expect(ccaStageTone("text-warning")).toBe("warning");  // token
    expect(ccaStageTone("text-amber-400")).toBe("warning"); // paleta literal antiga
    expect(ccaStageTone("text-emerald-500")).toBe("success");
    expect(ccaStageTone("text-sky-400")).toBe("info");
    expect(ccaStageTone("text-rose-500")).toBe("danger");
    expect(ccaStageTone("text-chart-5")).toBe("highlight");
    expect(ccaStageTone("text-destructive")).toBe("danger");
  });

  it("cor vazia ou desconhecida não deixa o estágio sem classe", () => {
    for (const valor of [null, undefined, "", "#94a3b8", "cor-inventada"]) {
      const tom = ccaStageTone(valor);
      expect(CCA_TONE_CLASS[tom]).toBeDefined();
    }
  });
});
