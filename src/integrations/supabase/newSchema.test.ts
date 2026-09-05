/**
 * O gravador do negócio, na parte que dá para testar sem banco.
 *
 * Três defeitos moravam aqui e todos eram silenciosos — a tela dizia
 * "Alterações salvas" e o dado saía diferente:
 *
 * 1. `status_detail` recebia o rótulo DERIVADO do desfecho como se fosse
 *    escolha do operador (alcançava 28 dos 32 negócios da homologação);
 * 2. `lost_reason` era reescrito a cada salvamento, então abrir e salvar um
 *    negócio perdido apagava o motivo da perda;
 * 3. "19. REPROVADO" encerrava o negócio pelo diálogo e não encerrava nada
 *    pelo modal, com o aviso vermelho do formulário prometendo o contrário.
 */
import { describe, expect, it } from "vitest";
import {
  dealStageCodeFor, legacyDealFields, toNumberOrNull, type SaveLegacyDealInput,
} from "./newSchema";

const form = (patch: Partial<SaveLegacyDealInput> = {}): SaveLegacyDealInput => ({
  client: "Cliente",
  developer: "",
  project: "",
  unit: "",
  status: "PROPOSTA",
  stage: "proposal",
  deal_value: 0,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  ...patch,
} as SaveLegacyDealInput);

describe("toNumberOrNull", () => {
  it("le o formato brasileiro pela virgula", () => {
    expect(toNumberOrNull("1.234,56")).toBe(1234.56);
    expect(toNumberOrNull("10,5")).toBe(10.5);
  });

  it("nao come o ponto decimal de um input[type=number]", () => {
    // O bug: `replace(/\./g, "")` incondicional lia "10.5" como 105 — o
    // desconto entrava dez vezes maior e o VGV liquido saia dessa conta.
    expect(toNumberOrNull("10.5")).toBe(10.5);
    expect(toNumberOrNull(10.5)).toBe(10.5);
  });

  it("devolve nulo para vazio e para texto que nao e numero", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull("10%")).toBeNull();
  });
});

describe("dealStageCodeFor", () => {
  it("VENDA fecha e os motivos de perda encerram", () => {
    expect(dealStageCodeFor({ status: "VENDA", stage: "proposal" })).toBe("closed");
    for (const rotulo of ["17. DISTRATO", "18. QUEDA", "19. REPROVADO", "OFF"]) {
      expect(dealStageCodeFor({ status: rotulo, stage: "proposal" })).toBe("lost");
    }
  });

  it("qualquer outro rotulo mantem a etapa escolhida na tela", () => {
    expect(dealStageCodeFor({ status: "05. RP APROVADO", stage: "contract" })).toBe("contract");
    expect(dealStageCodeFor({ status: "PROPOSTA", stage: undefined })).toBe("incomplete");
  });
});

describe("legacyDealFields · status_detail", () => {
  it("grava o rotulo escolhido no negocio novo", () => {
    expect(legacyDealFields(form({ status: "05. RP APROVADO" })).status_detail)
      .toBe("05. RP APROVADO");
  });

  it("NAO regrava o rotulo derivado de um negocio que ninguem tocou", () => {
    // `status_detail: null` + `status` igual ao derivado = a tela so exibiu o
    // que deduziu de `outcome`. Persistir isso e inventar escolha do operador.
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "open", status: "PROPOSTA",
    }));
    expect(campos.status_detail).toBeNull();
  });

  it("grava quando o operador troca o rotulo derivado por outro", () => {
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "open", status: "16. PENDENTE",
    }));
    expect(campos.status_detail).toBe("16. PENDENTE");
  });

  it("negocio ganho sem status_detail continua sem status_detail", () => {
    const campos = legacyDealFields(form({
      id: "d1", status_detail: null, outcome: "won", status: "VENDA",
    }));
    expect(campos.status_detail).toBeNull();
  });
});

describe("legacyDealFields · lost_reason", () => {
  it("nao toca no motivo quando o status nao e de perda", () => {
    // Chave ausente: o supabase-js descarta `undefined`, entao o UPDATE nem
    // menciona a coluna. Antes ela virava null e o motivo sumia.
    const campos = legacyDealFields(form({
      id: "d1", status: "16. PENDENTE", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBeUndefined();
    expect("lost_reason" in JSON.parse(JSON.stringify(campos))).toBe(false);
  });

  it("grava o motivo quando o status escolhido encerra o negocio", () => {
    expect(legacyDealFields(form({ status: "19. REPROVADO" })).lost_reason).toBe("19. REPROVADO");
    expect(legacyDealFields(form({ status: "17. DISTRATO" })).lost_reason).toBe("17. DISTRATO");
  });

  it("preserva a observacao do dialogo de perda ao resalvar o mesmo motivo", () => {
    // O dialogo concatena "18. QUEDA — cliente desistiu". Regravar o rotulo
    // puro por cima apagaria a observacao sem ninguem pedir.
    const campos = legacyDealFields(form({
      id: "d1", status: "18. QUEDA", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBeUndefined();
  });

  it("troca o motivo quando o operador escolhe outro rotulo de perda", () => {
    const campos = legacyDealFields(form({
      id: "d1", status: "17. DISTRATO", lost_reason: "18. QUEDA — cliente desistiu",
    }));
    expect(campos.lost_reason).toBe("17. DISTRATO");
  });
});

describe("legacyDealFields · numeros e mes", () => {
  it("converte o mes-base para o primeiro dia do mes", () => {
    expect(legacyDealFields(form({ month_base: "08/2026" })).month_base).toBe("2026-08-01");
  });

  it("desconto de campo numerico entra igual, sem virar dez vezes maior", () => {
    expect(legacyDealFields(form({ perc_desconto: "10.5" })).discount_pct).toBe(10.5);
    expect(legacyDealFields(form({ perc_desconto: "" })).discount_pct).toBe(0);
  });

  it("VGV bruto manda; o liquido e do banco", () => {
    const campos = legacyDealFields(form({ vgv_bruto: 500000, deal_value: 1 }));
    expect(campos.vgv_gross).toBe(500000);
    expect(campos).not.toHaveProperty("vgv_net");
  });
});
