import { describe, expect, it } from "vitest";
import { ccaColumnOf, ccaColumnStatusAllowed, type CcaStage } from "./ccaData";

const coluna = (id: string, status: CcaStage["status"], position: number): CcaStage => ({
  id, name: id, color: "info", position, status,
});

// Colunas ATIVAS, por posição, como `loadCcaBoard` as recebe.
const ativas = [
  coluna("em-analise", "under_review", 1),
  coluna("pendente", "pending_documents", 2),
  coluna("aprovado-total", "approved", 5),
  coluna("aprovado-cond", "approved", 7),
];

describe("ccaColumnOf · onde o caso aparece no quadro", () => {
  it("usa o estágio do caso quando ele está entre os ativos", () => {
    expect(ccaColumnOf(ativas, { stage_id: "aprovado-cond", status: "approved" })?.id).toBe("aprovado-cond");
  });

  it("estágio desativado ou nulo cai na primeira coluna de mesmo desfecho", () => {
    expect(ccaColumnOf(ativas, { stage_id: "aprovado-antigo", status: "approved" })?.id).toBe("aprovado-total");
    expect(ccaColumnOf(ativas, { stage_id: null, status: "pending_documents" })?.id).toBe("pendente");
  });

  // Antes caía em `stages[0]`: os casos cancelados apareciam em "EM ANÁLISE".
  it("sem coluna do desfecho o caso sai do quadro", () => {
    expect(ccaColumnOf(ativas, { stage_id: "distrato-queda", status: "cancelled" })).toBeUndefined();
  });
});

describe("ccaColumnStatusAllowed · o que a coluna pode gravar", () => {
  it("recusa rótulo de envio e desfecho, com prefixo, caixa e NBSP", () => {
    for (const valor of [
      "13. ESTEIRA AGIL", "15. ANÁLISE P/ VIRAR NEGÓCIO",
      "18. QUEDA", "OFF", "OFF - SEM RETORNO", "17. DISTRATO", "13.\u00a0esteira agil",
    ]) {
      expect(ccaColumnStatusAllowed(valor), valor).toBe(false);
    }
  });

  // "RET. ESTEIRA AGIL" é o Status 2 da coluna RETORNO À ESTEIRA ÁGIL (15/09).
  it("aceita o Status 2 comum das colunas e o do retorno à esteira ágil", () => {
    for (const valor of [
      "16. PENDENTE", "09. APROV. TOTAL", "EM ANÁLISE", "19. REPROVADO", "OFFICE",
      "RET. ESTEIRA AGIL", "ret. esteira agil",
    ]) {
      expect(ccaColumnStatusAllowed(valor), valor).toBe(true);
    }
  });
});
