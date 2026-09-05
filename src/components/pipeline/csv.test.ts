import { describe, expect, it } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { dealsCsv, shareValue } from "./csv";

/**
 * O rateio no CSV.
 *
 * `deal_participants.share_pct` é o número que define comissão e só existia
 * dentro do modal, ao lado do nome do corretor: conferir o mês inteiro exigia
 * abrir negócio por negócio. O CSV é o lugar em que a conferência acontece de
 * verdade — daí as colunas de percentual e de VGV por corretor.
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

describe("dealsCsv · rateio", () => {
  it("leva percentual e valor de cada corretor", () => {
    const linhas = dealsCsv([negocio()]).split("\n");
    expect(linhas[0]).toContain('"% Corretor 1"');
    expect(linhas[1]).toContain('"50"');
    expect(linhas[1]).toContain('"150000"');
  });

  it("corretor ausente sai em branco, não em zero", () => {
    // "0" afirmaria que o terceiro corretor existe e não leva nada.
    expect(shareValue(300_000, null)).toBe("");
    expect(dealsCsv([negocio()]).split("\n")[1]).toContain(',"","",');
  });

  it("continua escapando vírgula do nome do cliente", () => {
    expect(dealsCsv([negocio()])).toContain('"Cliente, com vírgula"');
  });

  it("arredonda a fatia para centavos inteiros", () => {
    // 33,334% de 300.000 = 100.002 — a fatia é dinheiro, não pode sair com
    // dízima no CSV que a operação abre no Excel.
    expect(shareValue(300_000, 33.334)).toBe(100_002);
  });
});
