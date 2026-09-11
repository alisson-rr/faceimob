import { describe, expect, it } from "vitest";
import { validateGoalTarget } from "./newSchema";

/**
 * A meta e o DENOMINADOR de todos os cartoes do mes no Dashboard. Erro de
 * digitacao aqui nao erra um numero, erra o painel inteiro — por isso a
 * validacao mora na fronteira de escrita (`upsertGlobalMonthlyGoal`) e nao no
 * formulario, e por isso ela tem teste.
 *
 * O banco sozinho nao segura nada disso: `goals.target` e
 * `numeric(14,2) check (target >= 0)`, ou seja, aceita zero e so recusa acima
 * de ~1e12.
 */
describe("validateGoalTarget", () => {
  it("aceita a meta que a operacao usa de verdade", () => {
    expect(validateGoalTarget("sales", 14)).toBeNull();
    expect(validateGoalTarget("sales", 1)).toBeNull();
    expect(validateGoalTarget("vgv", 8_500_000.5)).toBeNull();
  });

  it("recusa zero, que o painel leria como 'sem meta cadastrada'", () => {
    // O `GoalCard` trata `target <= 0` como falta de cadastro: gravar 0 mostrava
    // o toast "Meta global salva" e o card continuava dizendo que nao ha meta.
    expect(validateGoalTarget("sales", 0)).toBe("A meta precisa ser maior que zero.");
    expect(validateGoalTarget("vgv", 0)).toBe("A meta precisa ser maior que zero.");
  });

  it("recusa meta negativa", () => {
    expect(validateGoalTarget("sales", -1)).toBe("A meta precisa ser maior que zero.");
    expect(validateGoalTarget("vgv", -0.01)).toBe("A meta precisa ser maior que zero.");
  });

  it("recusa o que nao e numero — texto no campo chega aqui como NaN", () => {
    // `Number("abc")` e `Number("1e999")` sao exatamente o que sai de um campo
    // de texto; nenhum dos dois pode virar denominador.
    expect(validateGoalTarget("sales", Number("abc"))).toBe("Informe um número para a meta.");
    expect(validateGoalTarget("vgv", Number("1e999"))).toBe("Informe um número para a meta.");
  });

  it("recusa valor absurdo, que e o zero a mais na digitacao", () => {
    expect(validateGoalTarget("sales", 100_001)).toBe(
      "A meta de vendas não pode passar de 100.000 no mês.",
    );
    expect(validateGoalTarget("vgv", 1e30)).toBe(
      "A meta de VGV não pode passar de R$ 1 bilhão no mês.",
    );
    // No limite ainda passa: o teto existe para pegar erro, nao para apertar a meta.
    expect(validateGoalTarget("sales", 100_000)).toBeNull();
    expect(validateGoalTarget("vgv", 1_000_000_000)).toBeNull();
  });

  it("meta de vendas e contagem: 3,5 vendas nao existe", () => {
    expect(validateGoalTarget("sales", 3.5)).toBe("A meta de vendas é uma quantidade inteira.");
  });
});
