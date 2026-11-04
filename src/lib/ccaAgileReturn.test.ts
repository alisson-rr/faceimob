import { describe, expect, it } from "vitest";
import { canReturnCcaToAgile, isCcaAgileStage } from "./ccaAgileReturn";

describe("retorno da agência para Esteira Ágil", () => {
  it("exige caso na agência e status comercial correspondente", () => {
    expect(canReturnCcaToAgile({status:"sent_to_agency",dealStatus:"11. AG. RET. AGENCIA"})).toBe(true);
    expect(canReturnCcaToAgile({status:"under_review",dealStatus:"11. AG. RET. AGENCIA"})).toBe(false);
    expect(canReturnCcaToAgile({status:"sent_to_agency",dealStatus:"EM CONTRATO"})).toBe(false);
  });
  it("reconhece a coluna sistêmica sem confundir devolução ao comercial", () => {
    expect(isCcaAgileStage("ESTEIRA ÁGIL")).toBe(true);
    expect(isCcaAgileStage("RETORNO À ESTEIRA ÁGIL")).toBe(false);
  });
});
