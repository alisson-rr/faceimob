import { describe, expect, it } from "vitest";
import { missingRequiredTypes, resolveStoredName, type DealDocumentRecord, type DocumentTypeRecord } from "./documents";

const type = (over: Partial<DocumentTypeRecord> = {}): DocumentTypeRecord => ({
  id: "t1",
  code: "rg_cpf",
  label: "RG / CPF",
  category: "identificacao",
  required_for_conversion: true,
  allows_multiple: false,
  naming_pattern: "{tipo}-{cliente}",
  sort_order: 1,
  ...over,
});

const doc = (over: Partial<DealDocumentRecord> = {}): DealDocumentRecord => ({
  id: "d1",
  deal_id: "deal-1",
  document_type_id: "t1",
  storage_path: "deal-1/1-x.pdf",
  original_name: "x.pdf",
  stored_name: "x.pdf",
  mime_type: "application/pdf",
  size_bytes: 10,
  version: 1,
  superseded_at: null,
  created_at: "2026-08-02T10:00:00Z",
  ...over,
});

const parts = { tipo: "rg_cpf", cliente: "João da Silva", negocio: "NEG-42", data: new Date(2026, 7, 2) };

describe("resolveStoredName", () => {
  it("aplica o naming_pattern e preserva a extensão", () => {
    expect(resolveStoredName("{tipo}-{cliente}", parts, "scan.PDF")).toBe("rg-cpf-joao-da-silva.pdf");
  });

  it("resolve {data} no formato ISO", () => {
    expect(resolveStoredName("{tipo}-{data}", parts, "a.jpg")).toBe("rg-cpf-2026-08-02.jpg");
  });

  it("resolve {negocio}", () => {
    expect(resolveStoredName("{tipo}-{negocio}", parts, "a.png")).toBe("rg-cpf-neg-42.png");
  });

  it("usa o padrão do banco quando o tipo não define um", () => {
    expect(resolveStoredName(null, parts, "a.pdf")).toBe("rg-cpf-joao-da-silva-2026-08-02.pdf");
  });

  it("remove placeholder desconhecido em vez de deixá-lo literal", () => {
    expect(resolveStoredName("{tipo}-{obra}-{cliente}", parts, "a.pdf")).toBe("rg-cpf-joao-da-silva.pdf");
  });

  it("aceita arquivo sem extensão", () => {
    expect(resolveStoredName("{tipo}", parts, "semponto")).toBe("rg-cpf");
  });

  it("não quebra quando o cliente é só pontuação", () => {
    const semNome = { ...parts, cliente: "***" };
    expect(resolveStoredName("{cliente}", semNome, "a.pdf")).toBe("sem-nome.pdf");
  });
});

describe("missingRequiredTypes", () => {
  const obrigatorio = type({ id: "t1" });
  const opcional = type({ id: "t2", code: "ctps", required_for_conversion: false });

  it("aponta o obrigatório sem documento", () => {
    expect(missingRequiredTypes([obrigatorio, opcional], []).map((t) => t.id)).toEqual(["t1"]);
  });

  it("considera atendido quando há documento vigente", () => {
    expect(missingRequiredTypes([obrigatorio], [doc()])).toEqual([]);
  });

  it("ignora documento substituído — versão antiga não vale como entregue", () => {
    const antigo = doc({ superseded_at: "2026-08-02T11:00:00Z" });
    expect(missingRequiredTypes([obrigatorio], [antigo]).map((t) => t.id)).toEqual(["t1"]);
  });

  it("não cobra tipo opcional", () => {
    expect(missingRequiredTypes([opcional], [])).toEqual([]);
  });
});
