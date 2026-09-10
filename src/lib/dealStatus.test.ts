import { describe, expect, it } from "vitest";
import {
  LOSS_REASONS, SYSTEM_STATUSES, bareStatus, closableMonths, isLossStatus, isPerda,
  isProducao, isResultado, isSystemStatus, normalizeStatus,
} from "./dealStatus";
import {
  legacyDealFields, type SaveLegacyDealInput,
} from "@/integrations/supabase/newSchema";

describe("normalizeStatus", () => {
  it("reconhece o rotulo puro (o que o modal manda)", () => {
    expect(normalizeStatus("VENDA")).toBe("VENDA");
    expect(normalizeStatus("PROPOSTA")).toBe("PROPOSTA");
    expect(normalizeStatus("DISTRATO")).toBe("DISTRATO");
    expect(normalizeStatus("QUEDA")).toBe("QUEDA");
    expect(normalizeStatus("OFF")).toBe("OFF");
  });

  it("reconhece o rotulo numerado da tabela do Pipeline", () => {
    expect(normalizeStatus("17. DISTRATO")).toBe("DISTRATO");
    expect(normalizeStatus("18. QUEDA")).toBe("QUEDA");
    expect(normalizeStatus("18.QUEDA")).toBe("QUEDA");
    expect(normalizeStatus("  17. distrato  ")).toBe("DISTRATO");
  });

  it("tira o prefixo sem inventar status para os demais rotulos", () => {
    expect(normalizeStatus("19. REPROVADO")).toBeNull();
    expect(normalizeStatus("11. AG. RET. AGENCIA")).toBeNull();
    expect(normalizeStatus("RET. ESTEIRA AGIL")).toBeNull();
    expect(normalizeStatus("Ativo")).toBeNull();
    expect(normalizeStatus("")).toBeNull();
    expect(normalizeStatus(null)).toBeNull();
  });

  it("classifica perda e producao com e sem prefixo", () => {
    // O bug F05: a tabela mandava "17. DISTRATO" e o negocio seguia em producao.
    expect(isPerda("17. DISTRATO")).toBe(true);
    expect(isPerda("18. QUEDA")).toBe(true);
    expect(isPerda("DISTRATO")).toBe(true);
    expect(isPerda("PROPOSTA")).toBe(false);
    expect(isProducao("PROPOSTA")).toBe(true);
    expect(isResultado("VENDA")).toBe(true);
    expect(isResultado("17. DISTRATO")).toBe(false);
  });
});

describe("isLossStatus", () => {
  it("todo motivo oferecido no dialogo encerra o negocio", () => {
    // A lista e o desvio para a confirmacao sao a MESMA regra. Enquanto eram
    // duas, "19. REPROVADO" encerrava pelo dialogo e nao encerrava pela tabela.
    for (const motivo of LOSS_REASONS) expect(isLossStatus(motivo)).toBe(true);
    expect(LOSS_REASONS).toContain("19. REPROVADO");
  });

  it("compara sem o prefixo numerado", () => {
    expect(isLossStatus("QUEDA")).toBe(true);
    expect(isLossStatus("REPROVADO")).toBe(true);
    expect(isLossStatus("  19. reprovado  ")).toBe(true);
  });

  it("nao encerra o que nao e motivo de perda", () => {
    expect(isLossStatus("16. PENDENTE")).toBe(false);
    expect(isLossStatus("21. RESTRIÇÃO")).toBe(false);
    expect(isLossStatus("PROPOSTA")).toBe(false);
    expect(isLossStatus("VENDA")).toBe(false);
    expect(isLossStatus("")).toBe(false);
    expect(isLossStatus(null)).toBe(false);
  });

  it("encerrar nao virou contar como perda no relatorio", () => {
    // O dashboard so soma QUEDA e DISTRATO. "19. REPROVADO" tira o negocio do
    // funil sem mexer no numero de perdas que a diretoria le — e "OFF" segue
    // sendo "ignorado", nao "perdido".
    expect(normalizeStatus("19. REPROVADO")).toBeNull();
    expect(isPerda("19. REPROVADO")).toBe(false);
    expect(isPerda("OFF")).toBe(false);
  });
});

describe("isSystemStatus", () => {
  it("os dois rotulos de esteira sao do sistema", () => {
    expect(SYSTEM_STATUSES).toEqual(["13. ESTEIRA AGIL", "RET. ESTEIRA AGIL"]);
    for (const rotulo of SYSTEM_STATUSES) expect(isSystemStatus(rotulo)).toBe(true);
  });

  it("compara sem o prefixo numerado, como o trigger do banco", () => {
    // Um `status_detail` importado pode vir sem numero e em caixa baixa — o
    // guard da 0037 normaliza igual, senao o rotulo escaparia por ali.
    expect(isSystemStatus("ESTEIRA AGIL")).toBe(true);
    expect(isSystemStatus("  13. esteira agil ")).toBe(true);
    expect(isSystemStatus("ret. esteira agil")).toBe(true);
  });

  it("nao confunde com rotulos parecidos nem com os de perda", () => {
    expect(isSystemStatus("11. AG. RET. AGENCIA")).toBe(false);
    expect(isSystemStatus("12. EM PROCESSAMENTO")).toBe(false);
    expect(isSystemStatus("17. DISTRATO")).toBe(false);
    expect(isSystemStatus("")).toBe(false);
    expect(isSystemStatus(null)).toBe(false);
    // Sistema e perda sao conjuntos disjuntos: um rotulo de esteira nunca
    // encerra o negocio, e um de perda nunca e escrito pela esteira.
    for (const rotulo of SYSTEM_STATUSES) expect(isLossStatus(rotulo)).toBe(false);
  });
});

describe("closableMonths", () => {
  // O caso medido na homologacao em 02/09/2026: temporada aberta em 09/2026
  // (zero negocios) e 26 dos 32 negocios em 08/2026. Enquanto o periodo era
  // fixado na temporada, o botao congelaria o mes vazio e 08/2026 ficaria
  // aberto para sempre — nenhuma tela sabia fecha-lo.
  const meses = ["05/2026", "06/2026", "07/2026", "08/2026"];
  const fechados = ["05/2026", "06/2026"];

  it("oferece os meses com negocio que ainda nao foram fechados", () => {
    expect(closableMonths(meses, fechados, "09/2026")).toEqual([
      "09/2026", "08/2026", "07/2026",
    ]);
  });

  it("inclui o mes da temporada aberta mesmo sem negocio nenhum", () => {
    expect(closableMonths([], [], "09/2026")).toEqual(["09/2026"]);
  });

  it("nao oferece de novo um mes ja fechado, nem o da temporada", () => {
    expect(closableMonths(meses, [...fechados, "09/2026"], "09/2026")).toEqual([
      "08/2026", "07/2026",
    ]);
    expect(closableMonths(["05/2026"], ["05/2026"], null)).toEqual([]);
  });

  it("ordena do mais novo para o mais antigo pela data, nao pelo alfabeto", () => {
    // "12/2025" vem depois de "01/2026" no sort() de string.
    expect(closableMonths(["01/2026", "12/2025", "02/2026"], [], null)).toEqual([
      "02/2026", "01/2026", "12/2025",
    ]);
  });

  it("nao repete o mes da temporada quando ele tambem tem negocio", () => {
    expect(closableMonths(["08/2026", "08/2026"], [], "08/2026")).toEqual(["08/2026"]);
  });
});

describe("bareStatus", () => {
  it("tira prefixo numerado, espaco e caixa — os tres formatos que circulam", () => {
    expect(bareStatus("18. QUEDA")).toBe("QUEDA");
    expect(bareStatus("  17. distrato ")).toBe("DISTRATO");
    expect(bareStatus("QUEDA — cliente desistiu")).toBe("QUEDA — CLIENTE DESISTIU");
    expect(bareStatus(null)).toBe("");
  });
});

/**
 * O gravador do motivo da perda, no recorte que os testes de `newSchema` nao
 * cobriam: `status_detail` NULO.
 *
 * Mora aqui, e nao em `newSchema.test.ts`, porque a regra sob teste e a
 * semantica de perda deste modulo (`isLossStatus` + o rotulo DERIVADO de
 * `outcome`) e porque `newSchema.test.ts` e de outra frente nesta rodada — a
 * duplicacao esta registrada como pendencia.
 *
 * O defeito: com `status_detail` nulo, o "Status 2" que a tela mostra e o
 * rotulo deduzido de `outcome` ("QUEDA"/"DISTRATO"), que nunca casa com um
 * motivo em texto livre. Abrir e salvar o negocio trocava
 * "Comprou com concorrente." por "QUEDA" — os negocios ...004 e ...025 da
 * homologacao.
 */
describe("legacyDealFields · lost_reason com status_detail nulo", () => {
  const perdido = (patch: Partial<SaveLegacyDealInput>): SaveLegacyDealInput => ({
    id: "d1",
    client: "Cliente",
    developer: "",
    project: "",
    unit: "",
    stage: "lost",
    deal_value: 0,
    active: false,
    created_at: "2026-08-01T00:00:00.000Z",
    outcome: "lost",
    status_detail: null,
    ...patch,
  } as SaveLegacyDealInput);

  it("nao troca o motivo em texto livre pelo rotulo deduzido", () => {
    const campos = legacyDealFields(perdido({
      status: "QUEDA", lost_reason: "Comprou com concorrente.",
    }));
    expect(campos.lost_reason, "chave ausente = UPDATE nem menciona a coluna")
      .toBeUndefined();
    expect(campos.status_detail).toBeNull();
  });

  it("vale tambem para o distrato deduzido do proprio texto", () => {
    // `legacyStatus` deduz "DISTRATO" porque o motivo contem a palavra.
    const campos = legacyDealFields(perdido({
      status: "DISTRATO", lost_reason: "Distrato pedido pelo cliente em julho",
    }));
    expect(campos.lost_reason).toBeUndefined();
  });

  it("grava quando o operador ESCOLHE outro rotulo de perda", () => {
    const campos = legacyDealFields(perdido({
      status: "17. DISTRATO", lost_reason: "Comprou com concorrente.",
    }));
    expect(campos.lost_reason).toBe("17. DISTRATO");
  });

  it("preserva a observacao mesmo quando o motivo veio sem o prefixo numerado", () => {
    // `startsWith` cru: "18. QUEDA" nao e prefixo de "QUEDA — cliente desistiu",
    // entao o rotulo era regravado por cima e a observacao sumia.
    const campos = legacyDealFields(perdido({
      status_detail: "18. QUEDA",
      status: "18. QUEDA",
      lost_reason: "QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBeUndefined();
  });
});
