import { describe, expect, it } from "vitest";
import { camposValidos, faltamParaEntregar, instrucaoDeColeta, lerColeta, TAG_DADOS } from "./sdrColeta.ts";

const CAMPOS = ["Nome", "Unidade", "CRECI"];

describe("coleta do agente", () => {
  it("lê só os campos configurados, sem '?' e sem diferença de caixa", () => {
    const texto = "Perfeito!\n[DADOS: nome: Ana Lia | Unidade: Zona Sul | CRECI: ? | Salário: 5 mil]";
    expect(lerColeta(texto, CAMPOS)).toEqual({ Nome: "Ana Lia", Unidade: "Zona Sul" });
  });

  it("sem tag ou sem campos não coleta nada", () => {
    expect(lerColeta("Oi, tudo bem?", CAMPOS)).toEqual({});
    expect(lerColeta("[DADOS: Nome: Ana]", [])).toEqual({});
  });

  it("a tag sai da mensagem do lead", () => {
    expect("Oi\n[DADOS: Nome: Ana]".replace(TAG_DADOS, "").trim()).toBe("Oi");
  });

  it("campos repetidos, vazios ou com quebra de linha são limpos", () => {
    expect(camposValidos(["Nome", " nome ", "", "Bair\nro", 3, "Uni[dade]"])).toEqual(["Nome", "Bair ro", "Uni dade"]);
    expect(camposValidos(null)).toEqual([]);
  });

  it("instrução lista os campos e some quando não há campos", () => {
    expect(instrucaoDeColeta(CAMPOS)).toContain("[DADOS: Nome: valor | Unidade: valor | CRECI: valor]");
    expect(instrucaoDeColeta([])).toBe("");
  });

  it("só entrega com as respostas obrigatórias apuradas", () => {
    const obrigatorios = ["Renda", "FGTS", "Região de interesse"];
    expect(faltamParaEntregar(obrigatorios, { renda: "5 mil", FGTS: "?", Nome: "Ana" })).toEqual(["FGTS", "Região de interesse"]);
    expect(faltamParaEntregar(obrigatorios, { Renda: "5 mil", FGTS: "sim", "Região de interesse": "Zona Sul" })).toEqual([]);
    expect(instrucaoDeColeta(["Renda"], ["Renda"])).toContain("Só use [QUALIFICADO] depois de saber: Renda");
  });
});
