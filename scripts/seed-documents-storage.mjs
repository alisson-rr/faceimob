#!/usr/bin/env node
/**
 * Sobe um arquivo de verdade para cada linha de `deal_documents`.
 *
 * Os seeds (030 e 060) registram os documentos só no banco: o bucket
 * `deal-documents` fica vazio e todo botão "Baixar" assina a URL de um objeto
 * que não existe. Este script gera um PDF mínimo por registro — o nome
 * amigável escrito na página, enchido até o `size_bytes` que a tela mostra ao
 * lado de "Baixar" — e envia no mesmo `storage_path`.
 *
 *   node scripts/seed-documents-storage.mjs             → Supabase LOCAL
 *   node scripts/seed-documents-storage.mjs --remote    → homologação: URL do .env,
 *                                                        SUPABASE_SERVICE_ROLE_KEY no ambiente
 *   node scripts/seed-documents-storage.mjs --amostra=x.pdf → confere a estrutura do PDF gerado,
 *                                                        grava um exemplo de 200 KB e sai
 *
 * Idempotente: objeto que já existe com o tamanho certo é contado e pulado;
 * com tamanho diferente é reenviado por cima. Rodar depois do `showcase`, que
 * é quem cria as linhas. Imprime só contagens — nunca URL assinada, chave ou
 * cabeçalho.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REMOTO = process.argv.includes("--remote");
const AMOSTRA = process.argv.find((a) => a.startsWith("--amostra="))?.slice(10);
const BUCKET = "deal-documents";

// ── alvo (mesma convenção de scripts/demo.mjs) ───────────────────────────────
function statusLocal() {
  const proc = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const saida = proc.stdout || "";
  const pegar = (chave) => saida.match(new RegExp(`${chave}="([^"]+)"`))?.[1];
  const url = pegar("API_URL");
  const service = pegar("SERVICE_ROLE_KEY");
  if (!url || !service) {
    console.error("Stack local não respondeu. Rode `npm run db:start` e tente de novo.");
    process.exit(1);
  }
  return { url, service };
}

function statusRemoto() {
  let env = "";
  try {
    env = readFileSync(".env", "utf8");
  } catch {
    console.error("Sem .env na raiz — não sei qual é a URL da homologação.");
    process.exit(1);
  }
  const url = env.match(/^VITE_SUPABASE_URL="?([^"\r\n]+)"?/m)?.[1];
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    console.error("VITE_SUPABASE_URL não está no .env.");
    process.exit(1);
  }
  if (!service) {
    console.error(
      [
        "SUPABASE_SERVICE_ROLE_KEY não está no ambiente.",
        "Pegue em Supabase → Project Settings → API → service_role e rode:",
        '  $env:SUPABASE_SERVICE_ROLE_KEY = "..."     # PowerShell',
      ].join("\n"),
    );
    process.exit(1);
  }
  return { url, service };
}

// ── PDF mínimo, sem biblioteca ───────────────────────────────────────────────
/**
 * Um catálogo, uma página A4 e um stream que escreve `texto` em Helvetica.
 * O xref precisa do offset em bytes de cada objeto, por isso o corpo é montado
 * em sequência e medido a cada passo. `tamanho` é o total de bytes desejado:
 * o que falta vira linhas de comentário (%) antes do xref — PDF válido que
 * não desloca objeto nenhum. Cada linha tem no máximo 255 bytes: é o limite do
 * Anexo C.2 do PDF Reference para linha fora de stream, que preflight/veraPDF
 * cobram mesmo que os leitores tolerem.
 */
function pdfMinimo(texto, tamanho = 0) {
  // Helvetica padrão só cobre Latin-1 e parêntese/barra delimitam string no PDF.
  const seguro = texto.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
  const conteudo = `BT /F1 14 Tf 50 780 Td (${seguro}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
  ];

  let corpo = "%PDF-1.4\n";
  const offsets = [];
  for (const [i, obj] of objetos.entries()) {
    offsets.push(Buffer.byteLength(corpo));
    corpo += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }

  const comentario = (n) => {
    let s = "";
    while (n > 0) {
      // "%\n" é o menor comentário possível, então nunca sobra 1 byte para a última linha.
      const linha = n - 255 === 1 ? 254 : Math.min(255, n);
      s += `%${"~".repeat(linha - 2)}\n`;
      n -= linha;
    }
    return s;
  };

  const fechar = (enchimento) => {
    let s = enchimento ? corpo + comentario(enchimento) : corpo;
    const xref = Buffer.byteLength(s);
    s += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) s += `${String(o).padStart(10, "0")} 00000 n \n`;
    s += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(s, "latin1");
  };

  let buf = fechar(0);
  // O enchimento empurra o startxref, que pode ganhar um dígito — a segunda
  // passada corrige a diferença.
  for (let enchimento = 0, i = 0; i < 3 && buf.length !== tamanho; i++) {
    enchimento += tamanho - buf.length;
    if (enchimento < 2) break;
    buf = fechar(enchimento);
  }
  return buf;
}

// O único registro que não é PDF na homologação é um .csv enviado pela tela;
// servir bytes de PDF com esse nome quebraria a abertura do arquivo.
const corpoDe = (doc) =>
  doc.mime_type && doc.mime_type !== "application/pdf"
    ? { bytes: Buffer.from(`${doc.stored_name}\n`.padEnd(doc.size_bytes ?? 0, "\n")), tipo: doc.mime_type }
    : { bytes: pdfMinimo(doc.stored_name, doc.size_bytes ?? 0), tipo: "application/pdf" };

// ── execução ─────────────────────────────────────────────────────────────────
async function main() {
  const { url, service } = REMOTO ? statusRemoto() : statusLocal();
  const cab = { apikey: service, Authorization: `Bearer ${service}` };
  console.log(`[documentos] alvo: ${REMOTO ? "HOMOLOGAÇÃO" : "local"} (${url})\n`);

  const lista = await fetch(
    `${url}/rest/v1/deal_documents?select=storage_path,stored_name,mime_type,size_bytes&order=created_at`,
    { headers: cab },
  );
  if (!lista.ok) throw new Error(`deal_documents → HTTP ${lista.status}`);
  const docs = await lista.json();

  const r = { enviados: 0, existiam: 0, falhas: [] };
  for (const doc of docs) {
    const caminho = doc.storage_path.split("/").map(encodeURIComponent).join("/");
    try {
      const { bytes, tipo } = corpoDe(doc);
      const info = await fetch(`${url}/storage/v1/object/info/${BUCKET}/${caminho}`, { headers: cab });
      if (info.ok && (await info.json()).size === bytes.length) {
        r.existiam++;
        continue;
      }
      const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminho}`, {
        method: "POST",
        headers: { ...cab, "Content-Type": tipo, "x-upsert": "true" },
        body: bytes,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      r.enviados++;
    } catch (e) {
      r.falhas.push(`${doc.storage_path} — ${e.message}`);
    }
  }

  console.log(`  registros ....... ${docs.length}
  enviados ........ ${r.enviados}
  já existiam ..... ${r.existiam}
  falhas .......... ${r.falhas.length}`);
  for (const f of r.falhas) console.log(`    ${f}`);
  process.exit(r.falhas.length ? 1 : 0);
}

/**
 * O que um leitor confere antes de abrir: `startxref` cai no `xref` e cada
 * offset da tabela cai no objeto certo. Um byte contado errado no corpo
 * derruba os dois.
 */
function conferirPdf(buf) {
  const s = buf.toString("latin1");
  const inicio = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
  assert.ok(s.startsWith("%PDF-1.4\n") && s.startsWith("xref\n", inicio), "startxref não aponta para o xref");
  const entradas = s.slice(inicio).match(/^\d{10} 00000 n $/gm) ?? [];
  assert.equal(entradas.length, 5, "xref sem os 5 objetos");
  entradas.forEach((e, i) =>
    assert.ok(s.startsWith(`${i + 1} 0 obj\n`, Number(e.slice(0, 10))), `offset do objeto ${i + 1}`),
  );
  // O único stream é de uma linha curta, então dá para cobrar o limite em todas.
  const longa = s.split("\n").findIndex((l) => l.length > 255);
  assert.equal(longa, -1, `linha ${longa + 1} passa de 255 caracteres`);
}

if (AMOSTRA) {
  // Também o caminho sem enchimento e com nome que precisa de escape.
  conferirPdf(pdfMinimo("Comprovante (residência) \\ João.pdf"));
  // Tamanhos consecutivos passam por todo resto da divisão por 255, inclusive o de 1 byte.
  for (let t = 600; t < 1100; t++) {
    const b = pdfMinimo("x.pdf", t);
    assert.equal(b.length, t, `enchimento não bateu ${t}`);
    conferirPdf(b);
  }
  const buf = pdfMinimo("amostra-faceimob.pdf", 200_000);
  assert.equal(buf.length, 200_000, "enchimento não bateu o tamanho pedido");
  conferirPdf(buf);
  writeFileSync(AMOSTRA, buf);
  console.log(`[documentos] PDF de exemplo (${buf.length} bytes) gravado em ${AMOSTRA}`);
} else {
  main().catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}
