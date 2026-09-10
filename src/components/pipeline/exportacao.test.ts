import { describe, expect, it } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { HEADERS, linhasDeNegocios, shareValue } from "./exportacao";

/**
 * O rateio na planilha, e o TIPO de cada célula.
 *
 * `deal_participants.share_pct` é o número que define comissão e só existia
 * dentro do modal, ao lado do nome do corretor: conferir o mês inteiro exigia
 * abrir negócio por negócio.
 *
 * O tipo entrou no teste porque foi ele que quebrou na prática: no CSV toda
 * célula saía entre aspas e o Excel lia VGV como texto — somar a coluna dava
 * zero. Um teste que só olhasse o VALOR passaria com o defeito de volta.
 */
const negocio = (patch: Partial<LegacyDealRecord> = {}): LegacyDealRecord => ({
  id: "d1",
  code: "N-1",
  client: "Cliente, com vírgula",
  developer: "MRV",
  project: "Solar",
  unit: "101",
  stage_label: "Proposta",
  status: "PROPOSTA",
  deal_value: 300_000,
  days_in_pipeline: 4,
  broker1: "Ana",
  broker2: "Bruno",
  broker3: null,
  manager1: "Gerente",
  month_base: "08/2026",
  broker1_share: 50,
  broker2_share: 50,
  broker3_share: null,
  created_at: "2026-08-01T00:00:00.000Z",
  ...patch,
} as unknown as LegacyDealRecord);

const coluna = (titulo: string) => HEADERS.indexOf(titulo);

describe("planilha do pipeline · rateio", () => {
  it("leva percentual e valor de cada corretor", () => {
    const [linha] = linhasDeNegocios([negocio()]);
    expect(linha[coluna("% Corretor 1")]).toEqual({ valor: 50, tipo: "numero" });
    expect(linha[coluna("VGV Corretor 1")]).toEqual({ valor: 150_000, tipo: "dinheiro" });
  });

  it("corretor ausente sai vazio, não em zero", () => {
    // Zero afirmaria que o terceiro corretor existe e não leva nada.
    expect(shareValue(300_000, null)).toBeNull();
    const [linha] = linhasDeNegocios([negocio()]);
    expect(linha[coluna("Corretor 3")].valor).toBeNull();
    expect(linha[coluna("% Corretor 3")].valor).toBeNull();
    expect(linha[coluna("VGV Corretor 3")].valor).toBeNull();
  });

  it("dinheiro e dias saem como NÚMERO — era o defeito do CSV", () => {
    const [linha] = linhasDeNegocios([negocio()]);
    expect(linha[coluna("VGV")], "somar a coluna de VGV precisa funcionar").toEqual({
      valor: 300_000,
      tipo: "dinheiro",
    });
    expect(linha[coluna("Dias")]).toEqual({ valor: 4, tipo: "numero" });
    // O código do negócio continua TEXTO: "N-1" e códigos com zero à esquerda
    // viram outra coisa se o Excel resolver interpretá-los.
    expect(linha[coluna("Código")].tipo).toBe("texto");
  });

  it("nome com vírgula deixou de ser um problema de formato", () => {
    // No CSV isto exigia aspas escapadas; na planilha a vírgula é só um caractere.
    const [linha] = linhasDeNegocios([negocio()]);
    expect(linha[coluna("Cliente")].valor).toBe("Cliente, com vírgula");
  });

  it("arredonda a fatia para centavos inteiros", () => {
    // 33,334% de 300.000 = 100.002 — a fatia é dinheiro, não pode sair com dízima.
    expect(shareValue(300_000, 33.334)).toBe(100_002);
  });
});
