import { describe, expect, it } from "vitest";
import { crc32, montarZip } from "./zipSimples";

const texto = (s: string) => new TextEncoder().encode(s);

describe("ZIP sem compressão", () => {
  it("CRC-32 confere com o valor de referência", () => {
    expect(crc32(texto("123456789"))).toBe(0xcbf43926);
  });

  it("monta assinaturas, nomes em UTF-8 e o diretório central", () => {
    const zip = montarZip([
      { nome: "Diandra/rg-cpf.pdf", bytes: texto("%PDF-1") },
      { nome: "Diandra/comprovante residência.jpg", bytes: texto("jpg") },
    ], new Date(2026, 9, 5, 14, 30, 10));
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const fim = zip.length - 22;
    expect(v.getUint32(fim, true)).toBe(0x06054b50);
    expect(v.getUint16(fim + 10, true)).toBe(2);
    const inicioCentral = v.getUint32(fim + 16, true);
    expect(v.getUint32(inicioCentral, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(zip)).toContain("comprovante residência.jpg");
  });
});
