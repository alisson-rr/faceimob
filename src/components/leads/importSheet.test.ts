import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectDelimiter, explainEmptyImport, ImportError, MAX_IMPORT_ROWS, mapColumns, parseSheet,
  rowsToLeads, rowsToRecords, splitDuplicates,
} from "./importSheet";
import type { LeadSource } from "@/integrations/supabase/leads";

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

describe("mapColumns", () => {
  it("o sinônimo específico ganha do genérico, na ordem declarada", () => {
    // "E-mail do cliente" batia em "cliente" e virava o nome; "Canal" batia em
    // telefone. Como a prévia repete a planilha crua, o erro só aparecia depois
    // de gravado.
    expect(mapColumns(["E-mail do cliente", "Canal", "Nome", "Telefone"]))
      .toEqual({ email: 0, phone: 3, source: -1, notes: -1, name: 2 });
  });

  it("uma coluna alimenta um campo só: o nome escolhe entre as que sobraram", () => {
    // Sem "Nome" na planilha, "Cliente" ainda vira o nome — mas a coluna de
    // e-mail já foi tomada e não é reutilizada.
    expect(mapColumns(["E-mail", "Cliente"])).toEqual({ email: 0, phone: -1, source: -1, notes: -1, name: 1 });
  });

  it("campo sem coluna correspondente fica em -1, não aponta para a coluna errada", () => {
    expect(mapColumns(["Nome"]).phone).toBe(-1);
  });
});

describe("splitDuplicates", () => {
  const lead = (nome: string, phone: string | null) => ({ full_name: nome, phone });

  it("separa o que já existe no banco pelo telefone, só dígitos", () => {
    const { novos, repetidos } = splitDuplicates(
      [lead("Ana", "(11) 98877-0001"), lead("Bruno", "11988770002")],
      new Set(["11988770001"]),
    );
    expect(novos.map((l) => l.full_name)).toEqual(["Bruno"]);
    expect(repetidos.map((l) => l.full_name)).toEqual(["Ana"]);
  });

  it("a repetição DENTRO da própria planilha também é pulada", () => {
    // A exportação do Leadfy costuma trazer a mesma linha duas vezes; sem isto
    // dois corretores atendem o mesmo cliente.
    const { novos, repetidos } = splitDuplicates(
      [lead("Ana", "11988770001"), lead("Ana de novo", "11988770001")],
      new Set(),
    );
    expect(novos).toHaveLength(1);
    expect(repetidos.map((l) => l.full_name)).toEqual(["Ana de novo"]);
  });

  it("lead sem telefone entra como novo — não há como compará-lo", () => {
    const { novos, repetidos } = splitDuplicates([lead("Sem fone", null), lead("Vazio", "")], new Set());
    expect(novos).toHaveLength(2);
    expect(repetidos).toHaveLength(0);
  });
});

describe("rowsToRecords", () => {
  it("usa o cabeçalho em minúsculas como chave e preenche coluna faltante", () => {
    const records = rowsToRecords([["Nome", " Fone ", "Campanha"], ["Ana", "11999"]]);

    expect(records).toEqual([{ nome: "Ana", fone: "11999", campanha: "" }]);
  });
});


/**
 * O separador do CSV.
 *
 * O Excel em pt-BR salva com `;` — é o separador de lista do Windows em
 * português. Com a vírgula fixa, a linha inteira virava UMA coluna, todas as
 * linhas eram descartadas por `row.length > 1` e a tela dizia "0 leads serão
 * importados" sem dizer o motivo. É o caminho mais comum de planilha do
 * cliente, e era o que não funcionava.
 */
describe("separador do CSV", () => {
  it("descobre o ponto e vírgula do Excel em português", () => {
    expect(detectDelimiter("Cliente;Telefone;Email")).toBe(";");
  });

  it("descobre a tabulação de quem cola do Google Sheets", () => {
    expect(detectDelimiter("Cliente\tTelefone\tEmail")).toBe("\t");
  });

  it("na dúvida fica com a vírgula, que é o formato do Leadfy", () => {
    expect(detectDelimiter("Cliente")).toBe(",");
  });

  it("vírgula dentro de aspas no cabeçalho não decide nada", () => {
    // Um cabeçalho `"Nome, completo";Telefone` é ponto e vírgula, não vírgula.
    expect(detectDelimiter('"Nome, completo";Telefone;Email')).toBe(";");
  });

  it("um CSV com ponto e vírgula vira leads de verdade", async () => {
    const conteudo = [
      "Cliente;Telefone;Email",
      "Ana Paula;11988770001;ana@exemplo.com",
      "Bruno Tavares;11988770002;bruno@exemplo.com",
    ].join("\n");
    const rows = await parseSheet(asFile(conteudo, "excel-ptbr.csv"));

    expect(rows[0]).toEqual(["Cliente", "Telefone", "Email"]);
    expect(rowsToLeads(rows, []).map((lead) => lead.full_name))
      .toEqual(["Ana Paula", "Bruno Tavares"]);
  });
});

describe("explainEmptyImport", () => {
  const semOrigens: LeadSource[] = [];

  it("uma coluna só aponta o separador, que é a causa real", () => {
    const rows = [["Cliente;Telefone"], ["Ana;11988770001"]];
    expect(explainEmptyImport(rows, semOrigens)).toMatch(/separador/i);
  });

  it("planilha sem coluna de nome diz que falta o nome", () => {
    const rows = [["", "Telefone"], ["", "11988770001"]];
    expect(explainEmptyImport(rows, semOrigens)).toMatch(/nome do cliente/i);
  });

  it("linhas em branco no nome dizem que o nome é obrigatório", () => {
    const rows = [["Nome", "Telefone"], ["", "11988770001"]];
    expect(explainEmptyImport(rows, semOrigens)).toMatch(/sem nome de cliente/i);
  });

  it("quando há lead para importar, não há o que explicar", () => {
    const rows = [["Nome", "Telefone"], ["Ana", "11988770001"]];
    expect(explainEmptyImport(rows, semOrigens)).toBeNull();
  });
});

describe("grupo de distribuição do lote", () => {
  it("o grupo escolhido vai em cada lead; sem escolha o banco decide", () => {
    const rows = [["Nome", "Telefone"], ["Ana", "11988770001"]];

    expect(rowsToLeads(rows, [], "g-parque")[0].distribution_group_id).toBe("g-parque");
    expect(rowsToLeads(rows, [])[0].distribution_group_id).toBeNull();
  });
});
