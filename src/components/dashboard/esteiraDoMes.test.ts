import { describe, expect, it } from "vitest";
import { esteiraDoMes } from "./esteiraDoMes";

const negocio = (id: string, status_detail: string | null, extra: { outcome?: "open" | "won"; status_group_code?: string } = {}) =>
  ({ id, status_detail, outcome: extra.outcome ?? "open", status_group_code: extra.status_group_code ?? "PROPOSTA" });

describe("esteiraDoMes", () => {
  it("conta cada negócio na faixa do Status 2 de hoje, e a venda só se passou pelo CCA", () => {
    const deals = [
      negocio("1", "13. ESTEIRA AGIL"),
      negocio("2", "RET. ESTEIRA AGIL"),
      negocio("3", "09. APROV. TOTAL"),
      negocio("4", "10. APROV. COND."),
      negocio("5", "16. PENDENTE"),
      negocio("6", "19. REPROVADO"),
      negocio("7", "08. VIROU NEGÓCIO"),
      negocio("8", "04. EM CONTRATO", { status_group_code: "VENDA" }),
      negocio("9", "03. ASSINADO", { status_group_code: "VENDA" }),
      negocio("10", "12. EM PROCESSAMENTO"),
      negocio("11", null),
    ];
    expect(esteiraDoMes(deals, new Set(["8"]))).toEqual({
      docs: 2, aprovados: 2, pendentes: 1, reprovados: 1, virouNegocio: 1, convertidos: 1,
    });
  });
});
