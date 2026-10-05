/**
 * ZIP sem compressão ("store"), para "Baixar todos" os documentos numa pasta
 * só (pedido da CCA em 05/10/2026). PDF e foto já vêm comprimidos: comprimir de
 * novo não ganha quase nada, e o formato "store" cabe em poucas linhas sem
 * dependência nova. Nomes em UTF-8 (bit 11), datas no horário local.
 */
export type ArquivoDoZip = { nome: string; bytes: Uint8Array };

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const dataDos = (d: Date) => ({
  hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  dia: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

export function montarZip(arquivos: ArquivoDoZip[], quando: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { hora, dia } = dataDos(quando);
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let deslocamento = 0;

  for (const arq of arquivos) {
    const nome = enc.encode(arq.nome);
    const crc = crc32(arq.bytes);
    const tam = arq.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, tam, true);
    local.setUint32(22, tam, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, arq.bytes);

    const cab = new DataView(new ArrayBuffer(46));
    cab.setUint32(0, 0x02014b50, true);
    cab.setUint16(4, 20, true);
    cab.setUint16(6, 20, true);
    cab.setUint16(8, 0x0800, true);
    cab.setUint16(10, 0, true);
    cab.setUint16(12, hora, true);
    cab.setUint16(14, dia, true);
    cab.setUint32(16, crc, true);
    cab.setUint32(20, tam, true);
    cab.setUint32(24, tam, true);
    cab.setUint16(28, nome.length, true);
    cab.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(cab.buffer), nome);

    deslocamento += 30 + nome.length + tam;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, deslocamento, true);

  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of todas) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
