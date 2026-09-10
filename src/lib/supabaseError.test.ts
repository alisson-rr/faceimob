import { describe, expect, it } from "vitest";
import { dbError, describeError } from "./supabaseError";

describe("describeError", () => {
  it("traduz os codigos do Postgres sem citar tabela ou coluna", () => {
    const cru = { code: "23505", message: 'duplicate key value violates unique constraint "leads_document_key"' };
    expect(describeError(cru, "erro")).toBe("Já existe um registro com esses dados.");
    expect(describeError({ code: "42501", message: "permission denied for table leads" }, "erro"))
      .toBe("Você não tem permissão para esta ação.");
    expect(describeError({ code: "23503", message: "violates foreign key constraint" }, "erro"))
      .toBe("Existe outro registro ligado a este; desfaça o vínculo antes.");
    expect(describeError({ code: "22P02", message: "invalid input syntax for type uuid" }, "erro"))
      .toBe("Um dos campos está em formato inválido.");
    expect(describeError({ code: "23514", message: 'new row violates check constraint "developers_email_check"' }, "erro"))
      .toBe("Um dos campos está fora do valor permitido.");
  });

  it("repassa a mensagem das nossas raise exception (ja em pt-BR)", () => {
    expect(describeError({ code: "P0001", message: "Lead já convertido no negócio 42." }, "erro"))
      .toBe("Lead já convertido no negócio 42.");
    expect(describeError({ code: "P0002", message: "Lead não encontrado." }, "erro"))
      .toBe("Lead não encontrado.");
    // Sem mensagem util, cai no fallback em vez de mostrar vazio.
    expect(describeError({ code: "P0001", message: "  " }, "erro")).toBe("erro");
  });

  it("usa o fallback em vez de vazar ingles quando nao reconhece o erro", () => {
    expect(describeError({ code: "XX000", message: "internal error" }, "erro")).toBe("erro");
    expect(describeError(new Error("relation \"deals\" does not exist"), "erro")).toBe("erro");
    expect(describeError(null, "erro")).toBe("erro");
    expect(describeError("boom", "erro")).toBe("erro");
  });

  it("mantem o code atraves do dbError, com o rotulo so na mensagem de log", () => {
    const err = dbError("converter lead", { code: "P0001", message: "Lead já convertido." });
    expect(err.message).toBe("converter lead: Lead já convertido.");
    expect(describeError(err, "erro")).toBe("Lead já convertido.");
    expect(describeError(dbError("leads", { code: "42501", message: "permission denied" }), "erro"))
      .toBe("Você não tem permissão para esta ação.");
  });
});
