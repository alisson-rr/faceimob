import { PDFDocument } from "pdf-lib";

/**
 * "Baixar todos os arquivos em PDF único" (pedido de 29/09/2026).
 *
 * Junta PDFs (todas as páginas, na ordem) e imagens (uma por página A4, sem
 * distorcer). O que não vira página — Word, planilha, PDF protegido por senha,
 * foto que o navegador não abre — fica de fora e volta em `ignorados`, para a
 * tela dizer o nome: sumir com um arquivo em silêncio faria a pessoa mandar à
 * construtora um dossiê incompleto achando que estava inteiro.
 */
export type ArquivoParaJuntar = { nome: string; tipo: string | null; bytes: ArrayBuffer };
export type ResultadoDaJuncao = { pdf: Uint8Array | null; incluidos: number; ignorados: string[] };

/** Converte uma imagem que o pdf-lib não lê (WebP, GIF…) em PNG. Só no navegador. */
export type ConversorDeImagem = (bytes: ArrayBuffer, tipo: string) => Promise<ArrayBuffer | null>;

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 24;

/** Pela assinatura dos bytes, não pela extensão: arquivo renomeado engana a extensão. */
const formato = (bytes: ArrayBuffer): "pdf" | "jpg" | "png" | null => {
  const b = new Uint8Array(bytes.slice(0, 8));
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
};

export async function juntarEmPdf(
  arquivos: ArquivoParaJuntar[],
  converter?: ConversorDeImagem,
): Promise<ResultadoDaJuncao> {
  const destino = await PDFDocument.create();
  const ignorados: string[] = [];
  let incluidos = 0;

  for (const arquivo of arquivos) {
    try {
      let bytes = arquivo.bytes;
      let tipo = formato(bytes);
      if (!tipo && arquivo.tipo?.startsWith("image/") && converter) {
        const png = await converter(bytes, arquivo.tipo);
        if (png) { bytes = png; tipo = formato(png); }
      }

      if (tipo === "pdf") {
        // Sem `ignoreEncryption`: PDF com senha falha aqui e vira "ignorado" —
        // copiar as páginas dele produziria folhas em branco.
        const origem = await PDFDocument.load(bytes);
        const paginas = await destino.copyPages(origem, origem.getPageIndices());
        for (const pagina of paginas) destino.addPage(pagina);
      } else if (tipo === "jpg" || tipo === "png") {
        const imagem = tipo === "jpg" ? await destino.embedJpg(bytes) : await destino.embedPng(bytes);
        const escala = Math.min(
          (A4.largura - 2 * MARGEM) / imagem.width,
          (A4.altura - 2 * MARGEM) / imagem.height,
          1,
        );
        const largura = imagem.width * escala;
        const altura = imagem.height * escala;
        destino.addPage([A4.largura, A4.altura]).drawImage(imagem, {
          x: (A4.largura - largura) / 2,
          y: (A4.altura - altura) / 2,
          width: largura,
          height: altura,
        });
      } else {
        ignorados.push(arquivo.nome);
        continue;
      }
      incluidos += 1;
    } catch {
      ignorados.push(arquivo.nome);
    }
  }

  return { pdf: incluidos > 0 ? await destino.save() : null, incluidos, ignorados };
}

/** Conversor do navegador: desenha a imagem num canvas e exporta PNG. */
export const converterNoNavegador: ConversorDeImagem = async (bytes, tipo) => {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: tipo }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    // HEIC e afins: o navegador não decodifica — o arquivo vai para "ignorados".
    return null;
  }
};
