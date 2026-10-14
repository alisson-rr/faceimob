import { describe, expect, it } from "vitest";
import { contemTexto, padraoSemAcento, semAcento } from "./busca";

describe("busca sem acento", () => {
  it("acha com ou sem acento, nos dois sentidos e sem olhar a caixa", () => {
    expect(contemTexto("José Álvaro da Conceição", "jose")).toBe(true);
    expect(contemTexto("Jose Alvaro", "JOSÉ")).toBe(true);
    expect(contemTexto("Conceição", "conceicao")).toBe(true);
    expect(contemTexto("Maria", "joao")).toBe(false);
    expect(contemTexto(null, "jose")).toBe(false);
  });

  it("semAcento tira só o acento", () => {
    expect(semAcento("Ação, Mônica")).toBe("Acao, Monica");
  });

  it("o padrão do banco casa com e sem acento e nunca vira sintaxe de regex", () => {
    const casa = (texto: string, termo: string) => new RegExp(padraoSemAcento(termo), "i").test(texto);
    expect(casa("José Álvaro", "jose")).toBe(true);
    expect(casa("JOSE", "José")).toBe(true);
    expect(casa("Ana Paula", "joao")).toBe(false);
    expect(casa("maria@gmail.com", "maria@gmail.com")).toBe(true);
    expect(casa("mariaXgmailYcom", "maria@gmail.com")).toBe(false);
    expect(() => new RegExp(padraoSemAcento("a(b[c\\d+*?"))).not.toThrow();
  });
});
