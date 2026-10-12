import { describe, expect, it } from "vitest";
import { linkAvisoAoGerente, linkBoasVindas } from "./boasVindas";

const texto = (url: string | null) => decodeURIComponent((url ?? "").split("text=")[1] ?? "");

describe("boas-vindas por WhatsApp", () => {
  it("monta o link com o número só em dígitos e sem senha", () => {
    const url = linkBoasVindas({ nome: "Ana Souza", email: "ana.souza@faceimob.com.br", telefone: "(51) 99999-1234", crmUrl: "https://crm.faceimob.com.br" });
    expect(url).toMatch(/^https:\/\/wa\.me\/5551999991234\?text=/);
    expect(texto(url)).toContain("Olá Ana");
    expect(texto(url)).toContain("ana.souza@faceimob.com.br");
    expect(texto(url)).toContain("webmail.faceimob.com.br");
  });

  it("sem telefone não gera link", () => {
    expect(linkBoasVindas({ nome: "Ana", email: "a@b.c", telefone: "", crmUrl: "x" })).toBeNull();
    expect(linkAvisoAoGerente({ gerente: "Victor", nome: "Ana", email: "a@b.c", telefoneGerente: null })).toBeNull();
  });

  it("avisa o gerente pelo nome", () => {
    const url = linkAvisoAoGerente({ gerente: "Victor Lima", nome: "Ana Souza", email: "ana@faceimob.com.br", telefoneGerente: "51988887777" });
    expect(texto(url)).toContain("Olá Victor!");
    expect(texto(url)).toContain("Ana Souza");
  });
});
