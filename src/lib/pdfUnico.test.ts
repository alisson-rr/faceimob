import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { juntarEmPdf } from "./pdfUnico";

// PNG 1×1 transparente — o menor arquivo de imagem válido que o pdf-lib lê.
const PNG_1X1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0)).buffer;

const pdfCom = async (paginas: number) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage();
  return (await doc.save()).slice().buffer;
};

const paginasDe = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();

describe("juntarEmPdf", () => {
  it("todas as páginas dos PDFs e uma página por imagem, na ordem dada", async () => {
    const r = await juntarEmPdf([
      { nome: "rg.pdf", tipo: "application/pdf", bytes: await pdfCom(2) },
      { nome: "comprovante.png", tipo: "image/png", bytes: PNG_1X1 },
      { nome: "contrato.pdf", tipo: "application/pdf", bytes: await pdfCom(3) },
    ]);
    expect(r.incluidos).toBe(3);
    expect(r.ignorados).toEqual([]);
    expect(await paginasDe(r.pdf!)).toBe(6);
  });

  it("o que não vira página sai com o nome, e o resto do PDF continua", async () => {
    const r = await juntarEmPdf([
      { nome: "ficha.docx", tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new TextEncoder().encode("PK\u0003\u0004 word").buffer },
      { nome: "quebrado.pdf", tipo: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7 lixo").buffer },
      { nome: "rg.pdf", tipo: "application/pdf", bytes: await pdfCom(1) },
    ]);
    expect(r.ignorados).toEqual(["ficha.docx", "quebrado.pdf"]);
    expect(await paginasDe(r.pdf!)).toBe(1);
  });

  it("imagem que o pdf-lib não lê passa pelo conversor; sem nada aproveitável, não há PDF", async () => {
    const converter = vi.fn(async () => PNG_1X1);
    const r = await juntarEmPdf([{ nome: "foto.webp", tipo: "image/webp", bytes: new ArrayBuffer(12) }], converter);
    expect(converter).toHaveBeenCalledWith(expect.any(ArrayBuffer), "image/webp");
    expect(await paginasDe(r.pdf!)).toBe(1);

    const vazio = await juntarEmPdf([{ nome: "planilha.xlsx", tipo: null, bytes: new ArrayBuffer(4) }]);
    expect(vazio).toEqual({ pdf: null, incluidos: 0, ignorados: ["planilha.xlsx"] });
  });
});
