import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";

/**
 * Lista de ligação do diretor (0185, pedido de 02/10/2026): leads de antes do
 * mês corrente que não viraram negócio — CAMPANHA | CLIENTE | TELEFONE — em
 * Excel e PDF. Quem decide o que entra é o banco (`lista_de_ligacao()`, com a
 * RLS de quem pede); aqui só se monta o arquivo.
 */
export type LinhaDeLigacao = { campanha: string; cliente: string; telefone: string };

export const CABECALHO = ["NOME DA CAMPANHA", "NOME CLIENTE", "TELEFONE"] as const;

// RPC da 0185, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

const texto = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Linhas da RPC validadas na fronteira; sem telefone não é lista de ligação. */
export function lerLinhas(data: unknown): LinhaDeLigacao[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        campanha: texto(r.campanha) || "Sem campanha",
        cliente: texto(r.cliente) || "Sem nome",
        telefone: texto(r.telefone),
      };
    })
    .filter((linha) => linha.telefone !== "");
}

/**
 * Ordem aleatória (02/10/2026): pela ordem do banco a lista saía agrupada por
 * campanha, e quem liga passava a manhã numa construtora só. Fisher–Yates;
 * `sorteio` é injetável para o teste ser determinista.
 */
export function embaralhar<T>(itens: T[], sorteio: () => number = Math.random): T[] {
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(sorteio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export async function buscarListaDeLigacao(): Promise<LinhaDeLigacao[]> {
  const { data, error } = await untyped.rpc("lista_de_ligacao");
  if (error) throw dbError("lista_de_ligacao", error);
  return embaralhar(lerLinhas(data));
}

const nomeDoArquivo = (extensao: string) =>
  `lista-de-ligacao_${new Date().toISOString().slice(0, 10)}.${extensao}`;

export async function baixarListaExcel(linhas: LinhaDeLigacao[]): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  await writeXlsxFile(
    [
      CABECALHO.map((titulo) => ({ value: titulo, fontWeight: "bold" as const })),
      ...linhas.map((l) => [
        { value: l.campanha, type: String },
        { value: l.cliente, type: String },
        { value: l.telefone, type: String },
      ]),
    ],
    { columns: [{ width: 40 }, { width: 36 }, { width: 18 }], stickyRowsCount: 1, sheet: "Lista de ligação" },
  ).toFile(nomeDoArquivo("xlsx"));
}

/** A fonte padrão do PDF só tem o alfabeto latino: emoji e símbolos saem como "?". */
export const paraPdf = (valor: string) =>
  valor.normalize("NFC").replace(/[^\x20-\x7E\xA0-\xFF]/gu, "?");

export async function montarListaPdf(linhas: LinhaDeLigacao[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [largura, altura] = [595.28, 841.89];
  const margem = 36;
  const colunas = [margem, margem + 210, margem + 400];
  const larguras = [200, 180, 120];
  const tamanho = 9;
  const passo = 16;

  // Texto que não cabe na coluna é cortado com "..." em vez de invadir a vizinha.
  const cabe = (valor: string, max: number) => {
    const inteiro = paraPdf(valor);
    if (fonte.widthOfTextAtSize(inteiro, tamanho) <= max) return inteiro;
    let v = inteiro;
    while (v.length > 1 && fonte.widthOfTextAtSize(`${v}...`, tamanho) > max) v = v.slice(0, -1);
    return `${v}...`;
  };

  let pagina = pdf.addPage([largura, altura]);
  let y = altura - margem;
  const titulo = () => {
    pagina.drawText("Lista de ligação · Faceimob", { x: margem, y, size: 14, font: negrito, color: rgb(0.11, 0.16, 0.29) });
    y -= 22;
    CABECALHO.forEach((c, i) => pagina.drawText(c, { x: colunas[i], y, size: tamanho, font: negrito }));
    y -= 6;
    pagina.drawLine({ start: { x: margem, y }, end: { x: largura - margem, y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
    y -= passo - 4;
  };
  titulo();
  for (const linha of linhas) {
    if (y < margem) {
      pagina = pdf.addPage([largura, altura]);
      y = altura - margem;
      titulo();
    }
    [linha.campanha, linha.cliente, linha.telefone].forEach((valor, i) =>
      pagina.drawText(cabe(valor, larguras[i]), { x: colunas[i], y, size: tamanho, font: fonte }));
    y -= passo;
  }
  return pdf.save();
}

export async function baixarListaPdf(linhas: LinhaDeLigacao[]): Promise<void> {
  const bytes = await montarListaPdf(linhas);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo("pdf");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
