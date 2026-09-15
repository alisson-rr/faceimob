/**
 * O catálogo de Status 2 (banco, 0149) × as regras que citam status pelo TEXTO.
 *
 * `LOSS_REASONS` e `SYSTEM_STATUSES` continuam no código porque são regra: um
 * rótulo desses encerra o negócio ou é escrito pela esteira. O catálogo passou
 * a ser cadastro do administrador, então o que precisa valer é o contrato entre
 * os dois: todo texto que uma regra cita existe no seed e está TRAVADO — senão o
 * admin desativaria pela tela um status de que o sistema depende.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOSS_REASONS, SYSTEM_STATUSES } from "@/lib/dealStatus";
import { EMPTY_STATUS_CATALOG, statusKey } from "@/integrations/supabase/dealStatuses";
import { GRUPOS, catalogoDeTeste as catalogo } from "./statusCatalog.fixture";
import {
  faceimobStatusRank, faceimobStatusTone, groupChoices, statusChoices, statusGroupCode,
  statusGroupLabel, statusGroupOf, statusLabel,
} from "./statuses";

const m0149 = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20260915090000_0149_status_catalogo.sql"),
  "utf8",
);

/** `('VENDA', '01. RC EMITIDA', 1, 'info', true, false)` → linha do seed. */
const seed = [...m0149.matchAll(
  /\('(VENDA|PROPOSTA|LEGADO|DISTRATO|OFF)',\s*'([^']+)',\s*\d+,\s*'(\w+)',\s*(true|false),\s*(true|false)\)/g,
)].map(([, group, value, tone, active, locked]) => ({
  group, value, tone, active: active === "true", locked: locked === "true",
}));

describe("seed do catálogo × regras do código", () => {
  it("o seed da 0149 foi lido inteiro", () => {
    expect(seed.length).toBeGreaterThanOrEqual(30);
    // Mesma chave do índice único do banco: dois textos com a mesma chave
    // derrubariam a migration.
    expect(new Set(seed.map((row) => statusKey(row.value))).size).toBe(seed.length);
  });

  it("todo motivo de perda e todo rótulo do sistema existe no seed e está travado", () => {
    for (const texto of [...LOSS_REASONS, ...SYSTEM_STATUSES]) {
      const linha = seed.find((row) => row.value === texto);
      expect(linha, `${texto} precisa estar no catálogo`).toBeDefined();
      expect(linha?.locked, `${texto} é citado por regra: não pode ser desativado pela tela`).toBe(true);
    }
  });

  it('"15. ANÁLISE P/ VIRAR NEGÓCIO" é rótulo do sistema (0150)', () => {
    expect(SYSTEM_STATUSES).toContain("15. ANÁLISE P/ VIRAR NEGÓCIO");
  });
});

describe("statusChoices", () => {
  it("ativos, sem os do sistema, na ordem do Status 1 e da posição", () => {
    expect(statusChoices(catalogo, "16. PENDENTE").map((option) => option.value)).toEqual([
      "02. ASS. BANCO",
      "16. PENDENTE", "08. VIROU NEGÓCIO",
      "17. DISTRATO",
      "18. QUEDA", "OFF",
    ]);
  });

  it("Status 2 ativo de um Status 1 desativado sai das opções, a não ser que seja o atual", () => {
    // LEGADO está desligado na fixture e seus dois Status 2 continuam ativos.
    // Oferecê-los devolvia o negócio ao grupo que o admin acabou de desligar.
    const doLegado = statusChoices(catalogo, "15. INTERNALIZADO").map((option) => option.value);
    expect(doLegado).toContain("15. INTERNALIZADO");
    expect(doLegado).not.toContain("19. REPROVADO");
  });

  it("o valor atual aparece mesmo sendo do sistema — e só ele", () => {
    const naEsteira = statusChoices(catalogo, "13. ESTEIRA AGIL").map((option) => option.value);
    expect(naEsteira).toContain("13. ESTEIRA AGIL");
    expect(naEsteira).not.toContain("RET. ESTEIRA AGIL");
    expect(naEsteira).not.toContain("15. ANÁLISE P/ VIRAR NEGÓCIO");
  });

  it("o valor atual aparece mesmo desativado, no lugar dele", () => {
    const values = statusChoices(catalogo, "PROPOSTA").map((option) => option.value);
    expect(values.filter((value) => value === "PROPOSTA")).toHaveLength(1);
    expect(values.indexOf("PROPOSTA")).toBe(values.indexOf("08. VIROU NEGÓCIO") - 1);
    expect(statusChoices(catalogo, "16. PENDENTE").map((option) => option.value)).not.toContain("PROPOSTA");
  });

  it("valor fora do catálogo entra no topo com o texto exato, senão o Select abre em branco", () => {
    const [primeiro] = statusChoices(catalogo, "99. RÓTULO ANTIGO");
    expect(primeiro).toEqual({ value: "99. RÓTULO ANTIGO", label: "RÓTULO ANTIGO", tone: "neutral" });
    // Casa pela chave para nome e cor, mas o `value` é o gravado: o Radix
    // compara o `value` do item com o do Select.
    expect(statusChoices(catalogo, "queda")[0]).toEqual({ value: "queda", label: "QUEDA", tone: "danger" });
  });

  it("sem catálogo carregado sobra o valor atual", () => {
    expect(statusChoices(EMPTY_STATUS_CATALOG, "16. PENDENTE"))
      .toEqual([{ value: "16. PENDENTE", label: "PENDENTE", tone: "neutral" }]);
  });
});

describe("nome, cor, ordem e Status 1 pelo catálogo", () => {
  it("nome exibido é o do catálogo, com bareStatus só para o que está fora", () => {
    expect(statusLabel(catalogo, "02. ASS. BANCO")).toBe("Assinado no banco");
    expect(statusLabel(catalogo, "VENDA")).toBe("VENDA");
    expect(faceimobStatusTone(catalogo, "17. DISTRATO")).toBe("danger");
    expect(faceimobStatusTone(catalogo, "ALGO QUE NÃO EXISTE")).toBe("neutral");
  });

  it("ordena pelo Status 1 e depois pela posição; desconhecido por último", () => {
    const ordem = ["OFF", "02. ASS. BANCO", "NÃO EXISTE", "16. PENDENTE"]
      .sort((a, b) => faceimobStatusRank(catalogo, a) - faceimobStatusRank(catalogo, b));
    expect(ordem).toEqual(["02. ASS. BANCO", "16. PENDENTE", "OFF", "NÃO EXISTE"]);
  });

  it("o Status 2 leva o Status 1 do catálogo; fora dele, nenhum", () => {
    expect(statusGroupOf(catalogo, "02. ASS. BANCO")).toBe(GRUPOS.VENDA.id);
    expect(statusGroupOf(catalogo, "QUEDA")).toBe(GRUPOS.OFF.id);
    expect(statusGroupOf(catalogo, "VENDA")).toBeNull();
    expect(statusGroupLabel(catalogo, GRUPOS.DISTRATO.id)).toBe("DISTRATO");
    expect(statusGroupLabel(catalogo, null)).toBeNull();
    expect(statusGroupLabel(EMPTY_STATUS_CATALOG, GRUPOS.VENDA.id)).toBeNull();
  });

  it("Status 1 desativado só aparece quando é o atual", () => {
    expect(groupChoices(catalogo).map((group) => group.code)).toEqual(["VENDA", "PROPOSTA", "DISTRATO", "OFF"]);
    expect(groupChoices(catalogo, GRUPOS.LEGADO.id).map((group) => group.code)).toContain("LEGADO");
  });
});

describe("statusGroupCode", () => {
  it("caixa alta, sem acento e sem símbolo, até 40 caracteres", () => {
    expect(statusGroupCode("Pós-venda")).toBe("POS_VENDA");
    expect(statusGroupCode("  em análise!! ")).toBe("EM_ANALISE");
    const longo = statusGroupCode(`${"a".repeat(39)} b`);
    expect(longo.length).toBeLessThanOrEqual(40);
    expect(longo.endsWith("_")).toBe(false);
    expect(statusGroupCode("!!!")).toBe("");
  });
});
