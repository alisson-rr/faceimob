/**
 * Leitura da planilha de importação (Leadfy: CSV ou XLSX).
 *
 * Separado do diálogo por ser a única parte com regra própria — detecção de
 * coluna por sinônimo e limites de tamanho — e a única testável sem DOM.
 *
 * O parser é `read-excel-file` (S06: o `xlsx` 0.18.5 estava abandonado no npm
 * com duas CVEs abertas). A leitura continua na thread principal, então os dois
 * limites abaixo continuam sendo a defesa: é o teto de bytes e de linhas que
 * impede um arquivo de terceiro de travar a aba.
 */
import { readSheet } from "read-excel-file/browser";
import type { LeadSource, NewLeadInput } from "@/integrations/supabase/leads";

/** Planilha de lead é arquivo de texto: acima disso é engano ou ataque. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
/** `createLeads` insere de uma vez; acima disso a importação vira lote manual. */
export const MAX_IMPORT_ROWS = 5_000;

export class ImportError extends Error {}

const isExcel = (name: string) => /\.(xlsx|xls)$/i.test(name);

/** Divide uma linha de CSV respeitando aspas — endereço com vírgula é comum. */
const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

/** Primeira aba do XLSX como matriz de texto. */
const readWorkbook = async (buffer: ArrayBuffer): Promise<string[][]> => {
  const rows = await readSheet(buffer, 1);
  return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
};

/**
 * `Blob.text()`/`.arrayBuffer()` não existem no jsdom, que é onde o teste do
 * parser roda; `FileReader` existe nos dois lados. É por isso que a planilha
 * continua entrando por ele, e não pelos métodos mais novos do `Blob`.
 */
function readFile(file: File, mode: "text"): Promise<string>;
function readFile(file: File, mode: "buffer"): Promise<ArrayBuffer>;
function readFile(file: File, mode: "text" | "buffer"): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImportError("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(reader.result ?? "");
    if (mode === "buffer") reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

/**
 * O `.xls` (Excel 97-2003) é o único formato que o parser novo deixou de ler.
 * `read-excel-file` o marca com um `code` estável; sem tratar esse caso o
 * usuário veria "formato não reconhecido" para um arquivo que o Excel abre
 * normalmente, sem saber o que fazer a respeito.
 */
const asImportError = (err: unknown): ImportError => {
  if (err instanceof ImportError) return err;
  if ((err as { code?: unknown } | null)?.code === "XLS_FILE_NOT_SUPPORTED") {
    return new ImportError("Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.");
  }
  return new ImportError("Formato não reconhecido. Envie um CSV ou XLSX exportado do Leadfy.");
};

export async function parseSheet(file: File): Promise<string[][]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError("Arquivo maior que 8 MB. Divida a planilha em partes menores.");
  }

  let rows: string[][];
  try {
    rows = isExcel(file.name)
      ? await readWorkbook(await readFile(file, "buffer"))
      : (await readFile(file, "text")).split(/\r?\n/).map(splitCsvLine);
  } catch (err) {
    throw asImportError(err);
  }

  const filled = rows.filter((row) => row.some((cell) => cell));
  if (filled.length < 2) {
    throw new ImportError("A planilha precisa de uma linha de cabeçalho e ao menos um lead.");
  }
  if (filled.length - 1 > MAX_IMPORT_ROWS) {
    throw new ImportError(`A planilha tem ${filled.length - 1} linhas; o limite por importação é ${MAX_IMPORT_ROWS}.`);
  }
  return filled;
}

/**
 * Cabeçalho + linhas → um objeto por linha, com a chave em minúsculas.
 *
 * É o formato que o remarketing do SDR consome; fica aqui, e não lá, para a
 * planilha ter um leitor só — foi o parser duplicado que deixou o SDR sem os
 * limites de tamanho e de linhas.
 */
export function rowsToRecords(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  const keys = header.map((cell) => cell.toLowerCase().trim());
  return body.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}

/**
 * Linhas da planilha → leads para `createLeads`.
 *
 * A origem sai do rótulo da própria planilha quando ele bate com uma origem
 * cadastrada; senão cai na origem de canal `import` (Leadfy). O `utm_source`
 * guarda o rótulo cru, que é o que permite auditar de onde veio depois.
 */
export function rowsToLeads(rows: string[][], sources: LeadSource[]): NewLeadInput[] {
  const headers = rows[0].map((header) => header.toLowerCase().trim());
  const find = (...keys: string[]) => headers.findIndex((header) => keys.some((key) => header.includes(key)));
  const nameIdx = find("cliente", "nome", "name");
  const phoneIdx = find("telefone", "phone", "whatsapp", "canal");
  const emailIdx = find("email", "e-mail");
  const sourceIdx = find("fonte", "origem", "source");
  const notesIdx = find("observaç", "mensagem", "obs");

  const importSource = sources.find((source) => source.channel === "import")
    || sources.find((source) => /leadfy/i.test(source.label));

  return rows.slice(1)
    .filter((row) => row.length > 1 && (row[nameIdx] || row[0]))
    .map((row) => {
      const label = sourceIdx >= 0 ? row[sourceIdx] : "";
      const matched = label
        ? sources.find((source) => source.label.toLowerCase() === label.toLowerCase())
        : null;
      return {
        full_name: (nameIdx >= 0 ? row[nameIdx] : row[0]) || "",
        phone: phoneIdx >= 0 ? row[phoneIdx] : null,
        email: emailIdx >= 0 ? row[emailIdx] : null,
        source_id: (matched || importSource)?.id || null,
        utm_source: label || "Leadfy",
        notes: notesIdx >= 0 ? row[notesIdx] : "Importado via Leadfy",
      };
    });
}
