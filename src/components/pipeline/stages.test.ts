import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_STAGES } from "@/types/crm";
import { isHexColor } from "@/lib/tone";
import { LOST_STAGE_CODE, funnelStages, pipelineStageColor, stageLabelOf, stageTone } from "./stages";
import { catalogoDeTeste as catalogo } from "./statusCatalog.fixture";
import { faceimobStatusTone, statusChoices } from "./statuses";
import { ccaStageColor, ccaStageTone } from "./ccaStage";

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

/** `('closed', 'Fechado', 8, 'won', '#facc15', …)` → { code, label, position, color }. */
const seededStages = (() => {
  const block = /insert into public\.pipeline_stages[^;]+;/i.exec(seed);
  if (!block) throw new Error("bloco de pipeline_stages não encontrado em supabase/seed.sql");
  return [...block[0].matchAll(/\('([a-z_]+)',\s*'([^']+)',\s*(\d+),\s*'[a-z]+',\s*'([^']*)'/g)].map((row) => ({
    code: row[1],
    label: row[2],
    position: Number(row[3]),
    color: row[4],
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

  it("toda coluna pinta com a cor gravada no banco", () => {
    // O cabeçalho do kanban é sólido na cor da etapa (18/09/2026). Se o seed
    // trocar o hex por outra coisa, a coluna cai no tom de reserva sem aviso.
    for (const stage of seededStages) {
      expect(isHexColor(stage.color), stage.code).toBe(true);
      expect(pipelineStageColor(stage), stage.code).toBe(stage.color);
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
  it('o seed mantém o acento de "08. VIROU NEGÓCIO"', () => {
    // O achado F10 nasceu de "VIROU NEGOCIO" sem acento: o valor não batia com
    // nenhum item e o Select da tabela abria vazio. O catálogo agora é do banco
    // (0149), então a trava lê o seed dele.
    const m0149 = readFileSync(
      resolve(__dirname, "../../../supabase/migrations/20260915090000_0149_status_catalogo.sql"),
      "utf8",
    );
    expect(m0149).toContain("'08. VIROU NEGÓCIO'");
    expect(m0149).not.toContain("'08. VIROU NEGOCIO'");
  });

  it("o valor gravado sempre aparece nas opções, mesmo fora do catálogo", () => {
    const desconhecido = "STATUS VINDO DE IMPORTAÇÃO";
    const opcoes = statusChoices(catalogo, desconhecido).map((status) => status.value);
    expect(opcoes[0]).toBe(desconhecido);
    expect(opcoes.slice(1)).toEqual(statusChoices(catalogo, "16. PENDENTE").map((status) => status.value));
    // Já um valor conhecido não pode ser duplicado no topo.
    expect(statusChoices(catalogo, "16. PENDENTE").filter((status) => status.value === "16. PENDENTE"))
      .toHaveLength(1);
  });

  it("status desconhecido tem tom neutro em vez de quebrar", () => {
    expect(faceimobStatusTone(catalogo, "ALGO QUE NÃO EXISTE")).toBe("neutral");
    expect(faceimobStatusTone(catalogo, null)).toBe("neutral");
    expect(faceimobStatusTone(catalogo, "08. VIROU NEGÓCIO")).toBe("highlight");
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

  it("cor vazia ou desconhecida não deixa o estágio sem cor", () => {
    for (const valor of [null, undefined, "", "#94a3b8", "cor-inventada", "text-amber-400"]) {
      expect(isHexColor(ccaStageColor(valor)), String(valor)).toBe(true);
    }
  });
});
