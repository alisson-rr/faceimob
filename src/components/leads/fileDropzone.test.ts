import { describe, expect, it } from "vitest";
import { aceitaArquivo, mensagemRecusa } from "./FileDropzone";

/**
 * O `accept` do `<input type="file">` só filtra a janela de escolha: o arquivo
 * ARRASTADO chegava ao leitor sem passar por ele, que é como um binário com a
 * extensão de planilha entrava na importação. Estes casos cobrem a regra que o
 * `drop` passou a aplicar.
 */
const arquivo = (name: string, type = "") => new File(["x"], name, { type });

describe("aceitaArquivo", () => {
  it("sem `accept`, aceita qualquer arquivo — é o contrato do atributo", () => {
    expect(aceitaArquivo(arquivo("qualquer.bin"), undefined)).toBe(true);
    expect(aceitaArquivo(arquivo("qualquer.bin"), "  ")).toBe(true);
  });

  it("casa por extensão, sem depender da caixa", () => {
    expect(aceitaArquivo(arquivo("Relatorio.CSV"), ".csv,.xlsx,.xls")).toBe(true);
    expect(aceitaArquivo(arquivo("relatorio.xlsx"), ".csv,.xlsx,.xls")).toBe(true);
  });

  it("recusa o que a janela de escolha recusaria", () => {
    expect(aceitaArquivo(arquivo("foto.png", "image/png"), ".csv,.xlsx,.xls")).toBe(false);
    // Extensão trocada é o caso do ataque: aqui ela passa, e quem recusa é
    // `parseSheet`, que confere a assinatura dos bytes.
    expect(aceitaArquivo(arquivo("foto.csv", "image/png"), ".csv,.xlsx,.xls")).toBe(true);
  });

  it("casa por tipo MIME, inclusive com curinga", () => {
    expect(aceitaArquivo(arquivo("sem-extensao", "application/pdf"), "application/pdf")).toBe(true);
    expect(aceitaArquivo(arquivo("foto", "image/heic"), "image/*")).toBe(true);
    expect(aceitaArquivo(arquivo("foto", "image/heic"), "application/pdf")).toBe(false);
  });
});

/**
 * Recusar no `drop` respondia ANTES do parser, e a resposta dele era melhor: em
 * /dados o `accept` é `.csv,.xlsx`, então arrastar um `.xls` virava "não é um
 * dos formatos aceitos" — o usuário troca de arquivo e volta com o mesmo
 * problema, em vez de salvar de novo no formato que a tela lê.
 */
describe("mensagemRecusa", () => {
  it("o .xls arrastado numa tela de planilha diz o que fazer com ele", () => {
    expect(mensagemRecusa(arquivo("aportes.xls"), ".csv,.xlsx"))
      .toMatch(/salve como \.xlsx ou CSV/);
  });

  it("o resto continua com a frase que nomeia os formatos aceitos", () => {
    const generica = mensagemRecusa(arquivo("foto.png", "image/png"), ".csv,.xlsx");

    expect(generica).toMatch(/foto\.png/);
    expect(generica).toMatch(/\.csv,\.xlsx/);
  });

  it("num dropzone que não é de planilha, o .xls não recebe conselho de planilha", () => {
    // O anexo do convertido aceita .xls; se algum dia não aceitar, mandar
    // "salve como CSV" para um anexo seria instrução errada.
    expect(mensagemRecusa(arquivo("antiga.xls"), ".pdf,.jpg")).toMatch(/não é um dos formatos/);
  });
});
