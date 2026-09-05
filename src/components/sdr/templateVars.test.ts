import { describe, expect, it } from "vitest";
import {
  canonicalVar, nameIssue, parseVariables, placeholderCount, renderPreview, templateIssues,
} from "./templateVars";

describe("placeholderCount", () => {
  it("conta pelo maior índice, não pela quantidade de ocorrências", () => {
    expect(placeholderCount("Olá {{1}}, tudo bem {{1}}?")).toBe(1);
    expect(placeholderCount("Olá {{1}}, sobre {{2}}")).toBe(2);
    expect(placeholderCount("Sem variável nenhuma")).toBe(0);
  });

  it("aceita o espaçamento que a Meta aceita", () => {
    expect(placeholderCount("Olá {{ 1 }} e {{2}}")).toBe(2);
  });
});

describe("templateIssues", () => {
  it("não reclama quando corpo e variáveis combinam", () => {
    expect(templateIssues("Olá {{1}}, sobre {{2}}", ["nome", "campanha"])).toEqual([]);
  });

  // O defeito que motivou o arquivo: corpo com 2 placeholders e envio com 1
  // parâmetro (boas-vindas) só falhava na Graph API, em tempo de disparo.
  it("acusa corpo com mais placeholders do que variáveis declaradas", () => {
    const [erro] = templateIssues("Olá {{1}}, sobre {{2}}", ["nome"]);
    expect(erro).toMatch(/recusa o envio/);
  });

  it("acusa variável sobrando", () => {
    const [erro] = templateIssues("Olá {{1}}", ["nome", "campanha"]);
    expect(erro).toMatch(/parâmetro sobrando/);
  });

  it("avisa quando o nome da variável não casa com nenhum dado do contato", () => {
    const problemas = templateIssues("Olá {{1}}", ["renda"]);
    expect(problemas.some((p) => /"renda"/.test(p))).toBe(true);
  });
});

describe("nameIssue", () => {
  // O nome é a chave do disparo: `sendWhatsAppTemplate(to, tpl.name, …)`. Um
  // nome que a Meta não registra só falhava na Graph API, em tempo de envio.
  it("aceita o formato que a Meta registra", () => {
    expect(nameIssue("boas_vindas_faceimob")).toBeNull();
    expect(nameIssue("  retomada_interesse_2  ")).toBeNull();
  });

  it("recusa maiúscula, espaço e acento", () => {
    expect(nameIssue("Boas Vindas")).toMatch(/minúsculas/);
    expect(nameIssue("boas-vindas")).toMatch(/minúsculas/);
    expect(nameIssue("boas_vindás")).toMatch(/minúsculas/);
  });

  it("recusa nome maior do que a Meta guarda", () => {
    expect(nameIssue("a".repeat(513))).toMatch(/512/);
  });

  // Campo vazio é "ainda não preenchido", não "formato errado": quem cobra o
  // obrigatório é o salvar, e o formulário novo não pode abrir em vermelho.
  it("não trata campo vazio como erro de formato", () => {
    expect(nameIssue("")).toBeNull();
    expect(nameIssue("   ")).toBeNull();
  });
});

describe("canonicalVar", () => {
  it("reconhece os apelidos e ignora caixa e espaço", () => {
    expect(canonicalVar(" Nome ")).toBe("nome");
    expect(canonicalVar("CAMPAIGN")).toBe("campanha");
    expect(canonicalVar("1")).toBe("nome");
    expect(canonicalVar("renda")).toBeNull();
  });
});

describe("parseVariables", () => {
  it("não transforma campo vazio em uma variável vazia", () => {
    expect(parseVariables("")).toEqual([]);
    expect(parseVariables("  ,  ")).toEqual([]);
    expect(parseVariables("nome, campanha")).toEqual(["nome", "campanha"]);
  });
});

describe("renderPreview", () => {
  it("mostra o que o envio real colocaria", () => {
    expect(renderPreview("Olá {{1}}, sobre {{2}}", ["nome", "campanha"]))
      .toBe("Olá Maria Souza, sobre Lançamento Parque");
  });

  it("marca o placeholder sem variável declarada", () => {
    expect(renderPreview("Olá {{1}}", [])).toBe("Olá «sem variável»");
  });

  it("mostra o traço que o envio manda para variável desconhecida", () => {
    expect(renderPreview("Olá {{1}}", ["renda"])).toBe("Olá -");
  });
});
