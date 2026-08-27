import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportError, MAX_IMPORT_ROWS, parseSheet, rowsToRecords } from "./importSheet";

/**
 * O parser da planilha trocou de biblioteca (S06: `xlsx` 0.18.5 → `read-excel-file`).
 * A troca só está verificada se um `.xlsx` de verdade entrar e sair como matriz —
 * compilar não prova nada sobre um formato binário.
 *
 * `__fixtures__/leads-teste.xlsx` é a mesma planilha do CSV abaixo: cabeçalho e três
 * leads, aba única "Leads". Para regerar, salve essa tabela pelo Excel/LibreOffice.
 */
const XLSX_FIXTURE = readFileSync(resolve("src/components/leads/__fixtures__/leads-teste.xlsx"));

const CSV_FIXTURE = [
  "Cliente,Telefone,Email,Fonte,Observação",
  "Ana Paula Ribeiro,11988770001,ana.ribeiro@exemplo.com,Meta Ads,Quer 2 dormitórios na zona sul",
  "Bruno Tavares,11988770002,bruno.tavares@exemplo.com,Google Ads,Retornar depois das 18h",
  'Carla Nogueira,11988770003,carla.nogueira@exemplo.com,Indicação,"Já visitou o decorado, ligar à tarde"',
].join("\n");

const asFile = (content: BlobPart, name: string) => new File([content], name);

describe("parseSheet", () => {
  it("lê um .xlsx real: cabeçalho + 3 leads", async () => {
    const rows = await parseSheet(asFile(XLSX_FIXTURE, "leads-teste.xlsx"));

    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(["Cliente", "Telefone", "Email", "Fonte", "Observação"]);
    expect(rows[1]).toEqual([
      "Ana Paula Ribeiro", "11988770001", "ana.ribeiro@exemplo.com", "Meta Ads",
      "Quer 2 dormitórios na zona sul",
    ]);
    expect(rows[3][0]).toBe("Carla Nogueira");
  });

  it("lê um .csv com vírgula dentro de aspas", async () => {
    const rows = await parseSheet(asFile(CSV_FIXTURE, "leads-teste.csv"));

    expect(rows).toHaveLength(4);
    expect(rows[3][4]).toBe("Já visitou o decorado, ligar à tarde");
  });

  it("recusa arquivo acima do teto de bytes sem chegar a abrir", async () => {
    const big = asFile("x", "grande.xlsx");
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });

    await expect(parseSheet(big)).rejects.toThrow(ImportError);
    await expect(parseSheet(big)).rejects.toThrow(/8 MB/);
  });

  it("recusa planilha acima do teto de linhas", async () => {
    const linhas = ["Cliente,Telefone", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Lead ${i},1199900${i}`)];

    await expect(parseSheet(asFile(linhas.join("\n"), "muitos.csv")))
      .rejects.toThrow(new RegExp(String(MAX_IMPORT_ROWS)));
  });

  it("recusa planilha só com cabeçalho", async () => {
    await expect(parseSheet(asFile("Cliente,Telefone", "vazia.csv")))
      .rejects.toThrow(/cabeçalho e ao menos um lead/);
  });

  it("explica o .xls legado em vez de dizer só 'formato não reconhecido'", async () => {
    // Assinatura OLE2 de um Excel 97-2003: é por ela que o parser reconhece o formato.
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

    await expect(parseSheet(asFile(ole2, "antiga.xls"))).rejects.toThrow(/\.xls/);
    await expect(parseSheet(asFile(ole2, "antiga.xls"))).rejects.toThrow(/salve como \.xlsx/);
  });
});

describe("rowsToRecords", () => {
  it("usa o cabeçalho em minúsculas como chave e preenche coluna faltante", () => {
    const records = rowsToRecords([["Nome", " Fone ", "Campanha"], ["Ana", "11999"]]);

    expect(records).toEqual([{ nome: "Ana", fone: "11999", campanha: "" }]);
  });
});
