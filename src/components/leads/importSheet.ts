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

/**
 * O que o CONTEÚDO diz que o arquivo é — a extensão não decide.
 *
 * O nome do arquivo é digitado por quem o envia: um binário renomeado para
 * `.csv` era lido como texto, e o `accept` do seletor não vale no
 * arrastar-e-soltar. As duas assinaturas abaixo são o formato de verdade:
 * XLSX é um zip (`PK\x03\x04`) e o `.xls` de 1997 é um documento OLE2.
 */
const ASSINATURA_XLSX = [0x50, 0x4b, 0x03, 0x04];
const ASSINATURA_XLS = [0xd0, 0xcf, 0x11, 0xe0];

const comecaCom = (bytes: Uint8Array, assinatura: readonly number[]) =>
  assinatura.every((byte, i) => bytes[i] === byte);

export const ERRO_XLS = "Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.";

/** Separadores que aparecem em CSV de verdade, na ordem de desempate. */
const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Qual caractere separa as colunas desta planilha.
 *
 * O Excel em pt-BR salva CSV com `;` — é o separador de lista do Windows em
 * português. Assumir vírgula fazia a linha inteira virar UMA coluna: o
 * mapeamento não achava campo nenhum, `rowsToLeads` descartava tudo pelo
 * `row.length > 1` e a tela dizia "0 leads serão importados" sem motivo.
 *
 * Conta fora das aspas, no cabeçalho, e vence quem aparece mais. Empate fica
 * com a vírgula, que é o formato de exportação do Leadfy.
 */
export const detectDelimiter = (headerLine: string): CsvDelimiter => {
  let melhor: CsvDelimiter = ",";
  let maior = 0;
  for (const delimiter of CSV_DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < headerLine.length; i += 1) {
      const char = headerLine[i];
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    if (count > maior) { maior = count; melhor = delimiter; }
  }
  return melhor;
};

/** Divide uma linha de CSV respeitando aspas — endereço com vírgula é comum. */
const splitCsvLine = (line: string, delimiter: CsvDelimiter = ","): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

/** CSV inteiro em matriz, com o separador descoberto no cabeçalho. */
export const parseCsv = (text: string): string[][] => {
  const lines = text.split(/\r?\n/);
  const header = lines.find((line) => line.trim()) ?? "";
  const delimiter = detectDelimiter(header);
  return lines.map((line) => splitCsvLine(line, delimiter));
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
 *
 * Sempre em bytes: é o conteúdo que diz se o arquivo é planilha ou texto, e ler
 * como texto antes de saber disso é justamente o que fazia um binário renomeado
 * virar linhas.
 */
function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImportError("Não foi possível ler o arquivo."));
    reader.onload = () => resolve((reader.result as ArrayBuffer | null) ?? new ArrayBuffer(0));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Codificações que um BOM identifica sem ambiguidade — o "Unicode Text" do
 * Excel é UTF-16. O próprio `TextDecoder` descarta o BOM depois de decodificar,
 * então basta escolher o decodificador certo (um BOM deixado no texto viraria
 * parte do primeiro cabeçalho e nenhuma coluna seria reconhecida).
 */
const BOMS = [
  { assinatura: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { assinatura: [0xff, 0xfe], encoding: "utf-16le" },
  { assinatura: [0xfe, 0xff], encoding: "utf-16be" },
] as const;

const ERRO_BINARIO = "O conteúdo do arquivo não é texto nem planilha — a extensão pode estar trocada. "
  + "Envie um CSV ou XLSX exportado do Leadfy.";

/**
 * Os bytes como texto, na codificação em que o arquivo foi salvo.
 *
 * Decodificar sempre como UTF-8 e depois CONTAR caracteres quebrados recusava
 * planilha boa: um CSV do Excel brasileiro (Windows-1252) com coluna de
 * observação passa dos 10% de caracteres de substituição só de acento (o teste
 * mede), e a importação em massa — único jeito de subir lead — parava nele.
 *
 * A ordem aqui é detecção, não adivinhação: BOM quando existe; sem BOM, UTF-8
 * no modo `fatal`, que LANÇA em byte inválido em vez de mascará-lo; e o que não
 * é UTF-8 é Windows-1252, que é o que o Excel em pt-BR grava.
 *
 * Binário continua recusado pela assinatura (em `parseSheet`) e pelo byte zero,
 * que não existe em arquivo de texto e sobrevive a qualquer decodificação — o
 * Windows-1252 aceita todo byte, então sem essa conferência um PNG renomeado
 * para `.csv` voltaria como linhas de ruído.
 */
const comoTexto = (buffer: ArrayBuffer): string => {
  const inicio = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
  const bom = BOMS.find(({ assinatura }) => comecaCom(inicio, assinatura));

  let texto: string;
  if (bom) {
    texto = new TextDecoder(bom.encoding).decode(buffer);
  } else {
    try {
      texto = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      texto = new TextDecoder("windows-1252").decode(buffer);
    }
  }

  // ponytail: UTF-16 sem BOM decodifica como UTF-8 e cai aqui pelo byte zero;
  // o Excel sempre grava o BOM — tratar se aparecer arquivo assim de verdade.
  if (texto.includes("\0")) throw new ImportError(ERRO_BINARIO);
  return texto;
};

/**
 * O `.xls` (Excel 97-2003) é o único formato que o parser novo deixou de ler.
 * `read-excel-file` o marca com um `code` estável; sem tratar esse caso o
 * usuário veria "formato não reconhecido" para um arquivo que o Excel abre
 * normalmente, sem saber o que fazer a respeito.
 */
const asImportError = (err: unknown): ImportError => {
  if (err instanceof ImportError) return err;
  if ((err as { code?: unknown } | null)?.code === "XLS_FILE_NOT_SUPPORTED") {
    return new ImportError(ERRO_XLS);
  }
  return new ImportError("Formato não reconhecido. Envie um CSV ou XLSX exportado do Leadfy.");
};

export async function parseSheet(file: File): Promise<string[][]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError("Arquivo maior que 8 MB. Divida a planilha em partes menores.");
  }

  let rows: string[][];
  try {
    // O formato sai dos BYTES, e não de `file.name`: é a mesma leitura para o
    // CSV e para o XLSX, e um arquivo com a extensão trocada não decide nada.
    const buffer = await readFile(file);
    const inicio = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
    if (comecaCom(inicio, ASSINATURA_XLS)) throw new ImportError(ERRO_XLS);
    rows = comecaCom(inicio, ASSINATURA_XLSX)
      ? await readWorkbook(buffer)
      : parseCsv(comoTexto(buffer));
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
 * Qual coluna da planilha alimenta cada campo do lead. `-1` = não encontrada.
 *
 * A detecção era `headers.findIndex(h => keys.some(k => h.includes(k)))`: o
 * PRIMEIRO cabeçalho que casasse com QUALQUER sinônimo vencia, sem prioridade.
 * Uma planilha com "E-mail do cliente" à esquerda de "Nome" punha o e-mail em
 * `full_name` (porque "cliente" batia), e "Canal" à esquerda de "Telefone"
 * virava o telefone — erro que só aparecia depois de gravado, porque a prévia
 * repete a planilha crua.
 *
 * Duas regras resolvem: cada campo procura os sinônimos NA ORDEM (o específico
 * antes do genérico), e o nome — que tem os sinônimos mais frouxos — é o último
 * a escolher, sobre as colunas que sobraram.
 */
export type ColumnMap = {
  name: number;
  phone: number;
  email: number;
  source: number;
  notes: number;
};

export const COLUMN_LABELS: Record<keyof ColumnMap, string> = {
  name: "Nome",
  phone: "Telefone",
  email: "E-mail",
  source: "Origem",
  notes: "Observação",
};

const SYNONYMS: Record<keyof ColumnMap, string[]> = {
  email: ["e-mail", "email"],
  phone: ["telefone", "whatsapp", "celular", "phone", "fone", "canal"],
  source: ["fonte", "origem", "source"],
  notes: ["observaç", "observac", "mensagem", "obs"],
  name: ["nome", "cliente", "name", "lead"],
};

export function mapColumns(header: string[]): ColumnMap {
  const headers = header.map((cell) => cell.toLowerCase().trim());
  const taken = new Set<number>();
  const map: ColumnMap = { name: -1, phone: -1, email: -1, source: -1, notes: -1 };

  // A ordem das chaves é a ordem de escolha: `name` por último, de propósito.
  for (const field of Object.keys(SYNONYMS) as (keyof ColumnMap)[]) {
    for (const key of SYNONYMS[field]) {
      const index = headers.findIndex((cell, i) => !taken.has(i) && cell.includes(key));
      if (index >= 0) {
        map[field] = index;
        taken.add(index);
        break;
      }
    }
  }
  return map;
}

/**
 * Linhas da planilha → leads para `createLeads`.
 *
 * A origem sai do rótulo da própria planilha quando ele bate com uma origem
 * cadastrada; senão cai na origem de canal `import` (Leadfy). O `utm_source`
 * guarda o rótulo cru, que é o que permite auditar de onde veio depois.
 */
export function rowsToLeads(
  rows: string[][],
  sources: LeadSource[],
  groupId?: string | null,
): NewLeadInput[] {
  const columns = mapColumns(rows[0]);

  const importSource = sources.find((source) => source.channel === "import")
    || sources.find((source) => /leadfy/i.test(source.label));

  // Uma resposta só para "esta linha tem nome?": o filtro aceitava a linha por
  // `row[0]` (uma data, um id) e a gravação mandava `full_name` vazio — o
  // CHECK do banco derrubava a importação inteira sem dizer qual linha.
  const nameOf = (row: string[]) => ((columns.name >= 0 ? row[columns.name] : row[0]) ?? "").trim();

  return rows.slice(1)
    .filter((row) => row.length > 1 && nameOf(row))
    .map((row) => {
      const label = columns.source >= 0 ? row[columns.source] : "";
      const matched = label
        ? sources.find((source) => source.label.toLowerCase() === label.toLowerCase())
        : null;
      return {
        full_name: nameOf(row),
        phone: columns.phone >= 0 ? row[columns.phone] : null,
        email: columns.email >= 0 ? row[columns.email] : null,
        source_id: (matched || importSource)?.id || null,
        utm_source: label || "Leadfy",
        notes: columns.notes >= 0 ? row[columns.notes] : "Importado via Leadfy",
        distribution_group_id: groupId || null,
      };
    });
}

/**
 * Por que nenhuma linha virou lead.
 *
 * "0 leads serão importados" sem motivo é o pior estado da tela: a planilha
 * está lá, a prévia mostra as linhas, e o botão não faz nada. As três causas
 * reais têm conserto diferente — separador errado, coluna de nome ausente,
 * linhas sem nome —, então a mensagem precisa dizer qual delas é.
 *
 * `null` quando não há o que explicar (a importação vai acontecer).
 */
export function explainEmptyImport(rows: string[][], sources: LeadSource[]): string | null {
  if (rows.length < 2) return null;
  if (rowsToLeads(rows, sources).length > 0) return null;

  const header = rows[0] ?? [];
  if (header.length <= 1) {
    return "A planilha veio com uma coluna só. Isso costuma ser CSV salvo com outro separador "
      + "(ponto e vírgula, tabulação) ou um arquivo de texto comum: salve de novo como CSV ou "
      + "XLSX e reenvie.";
  }
  if (mapColumns(header).name < 0 && !(rows[1]?.[0] ?? "").trim()) {
    return "Nenhuma coluna foi reconhecida como o nome do cliente, e a primeira coluna está "
      + "vazia. Renomeie o cabeçalho da coluna do nome para “Nome” e reenvie.";
  }
  return "Todas as linhas estão sem nome de cliente. O nome é o único campo obrigatório do lead.";
}

/**
 * Separa o que já existe do que é novo.
 *
 * `existing` são os telefones (só dígitos) que o banco devolveu por
 * `existing_lead_phones`. A repetição DENTRO da própria planilha conta junto:
 * a mesma exportação do Leadfy costuma trazer a linha duas vezes, e duas linhas
 * iguais viram dois leads na roleta — dois corretores no mesmo cliente.
 *
 * Lead sem telefone não tem como ser comparado: entra como novo, porque
 * recusá-lo perderia lead legítimo de planilha só com nome e e-mail.
 */
export function splitDuplicates<T extends { phone?: string | null }>(
  inputs: T[],
  existing: Set<string>,
): { novos: T[]; repetidos: T[] } {
  const novos: T[] = [];
  const repetidos: T[] = [];
  const vistos = new Set<string>();

  for (const input of inputs) {
    const digits = (input.phone || "").replace(/\D/g, "");
    if (digits && (existing.has(digits) || vistos.has(digits))) {
      repetidos.push(input);
      continue;
    }
    if (digits) vistos.add(digits);
    novos.push(input);
  }
  return { novos, repetidos };
}
