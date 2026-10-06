/**
 * Planilha de preços dos imóveis (pedido de 04/10/2026; trazida do painel do
 * site para o CRM em 05/10/2026): baixar, mudar os
 * valores no Excel e subir de volta. CSV com ";" e BOM — o Excel em português
 * abre direto, com acentos, e salva de volta no mesmo formato. O `id` casa a
 * linha com o imóvel; sem ele, o código.
 */
export type ImovelDaPlanilha = {
  id: string;
  code: string;
  developer: string | null;
  title: string;
  city: string;
  price: number | null;
  price_from: number | null;
};

const BOM = String.fromCharCode(0xfeff);
const BOM_NO_INICIO = new RegExp(`^${BOM}`);

export type LinhaLida = { id: string; code: string; price: number | null; from: number | null };

const CABECALHO = [
  "id",
  "codigo",
  "construtora",
  "empreendimento",
  "cidade",
  "preco",
  "a_partir_de",
];

const celula = (valor: string) =>
  /[";\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;

/** Número no formato do Excel em português: sem milhar, vírgula decimal. */
const numero = (valor: number | null) =>
  valor == null ? "" : Number(valor).toFixed(2).replace(".", ",");

export function gerarPlanilha(imoveis: ImovelDaPlanilha[]): string {
  const linhas = imoveis.map((r) =>
    [r.id, r.code, r.developer ?? "", r.title, r.city, numero(r.price), numero(r.price_from)]
      .map((v) => celula(String(v)))
      .join(";"),
  );
  return BOM + [CABECALHO.join(";"), ...linhas].join("\r\n") + "\r\n";
}

/** Separa as células de uma linha de CSV respeitando aspas. */
function separar(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      out.push(atual);
      atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out.map((v) => v.trim());
}

/**
 * Valor de preço como o Excel devolve: "213000,00", "213.000,00",
 * "R$ 213.000,00" ou "213000.5". Vazio = não mexe (`null`); inválido = erro.
 */
export function lerValor(bruto: string): number | null {
  const s = bruto.replace(/R\$|\s/g, "");
  if (!s) return null;
  let normal = s;
  if (s.includes(",")) normal = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, "");
  const n = Number(normal);
  if (!Number.isFinite(n) || n < 0) throw new Error(`valor inválido "${bruto}"`);
  return Math.round(n * 100) / 100;
}

export function lerPlanilha(texto: string): { linhas: LinhaLida[]; erros: string[] } {
  const conteudo = texto.replace(BOM_NO_INICIO, "");
  const brutas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (brutas.length === 0) return { linhas: [], erros: ["Planilha vazia."] };
  const sep = brutas[0].includes(";") ? ";" : ",";
  const cab = separar(brutas[0], sep).map((c) => c.toLowerCase());
  const col = (nome: string) => cab.indexOf(nome);
  const [iId, iCod, iPreco, iFrom] = [col("id"), col("codigo"), col("preco"), col("a_partir_de")];
  if ((iId < 0 && iCod < 0) || (iPreco < 0 && iFrom < 0)) {
    return {
      linhas: [],
      erros: ["Use a planilha baixada aqui: faltam as colunas id/codigo e preco/a_partir_de."],
    };
  }
  const linhas: LinhaLida[] = [];
  const erros: string[] = [];
  brutas.slice(1).forEach((bruta, i) => {
    const v = separar(bruta, sep);
    try {
      linhas.push({
        id: iId >= 0 ? (v[iId] ?? "") : "",
        code: iCod >= 0 ? (v[iCod] ?? "") : "",
        price: iPreco >= 0 ? lerValor(v[iPreco] ?? "") : null,
        from: iFrom >= 0 ? lerValor(v[iFrom] ?? "") : null,
      });
    } catch (e) {
      erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : "inválida"}`);
    }
  });
  return { linhas, erros };
}
