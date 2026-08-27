import { describe, expect, it } from "vitest";
import { LOSS_REASONS, isLossStatus, isPerda, isProducao, isResultado, normalizeStatus } from "./dealStatus";

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
