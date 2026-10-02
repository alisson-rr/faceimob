/**
 * Planilha "Leads Todos" da Leadfy → linhas do `importar_leads_leadfy` (0188).
 * Puro: o vitest cobre o mapeamento das colunas, as datas e a ordem.
 */
export type LinhaLeadfy = {
  id: string | null;
  status: string | null;
  corretor: string | null;
  gerente: string | null;
  grupo: string | null;
  imovel: string | null;
  fonte: string | null;
  cliente: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  motivo: string | null;
  atividade: string | null;
  data_atividade: string | null;
  obs: string | null;
  campanha: string | null;
  campanha_id: string | null;
  conjunto: string | null;
  conjunto_id: string | null;
  anuncio: string | null;
  anuncio_id: string | null;
  formulario: string | null;
  criado_em: string | null;
};

/** Coluna da planilha → campo do lote. */
const COLUNAS: Record<string, keyof LinhaLeadfy> = {
  "Identificador": "id", "Status": "status", "Corretor": "corretor", "Gerente": "gerente", "Grupo": "grupo",
  "Imóvel": "imovel", "Fonte": "fonte", "Cliente": "cliente", "Telefone": "telefone", "Email": "email",
  "Cidade": "cidade", "Motivos de perda": "motivo", "Atividade": "atividade", "Data atividade": "data_atividade",
  "Obs. atividade": "obs", "Campanha": "campanha", "ID Campanha": "campanha_id", "Conjunto": "conjunto",
  "ID Conjunto": "conjunto_id", "Anúncio": "anuncio", "ID Anúncio": "anuncio_id", "Formulário": "formulario",
  "Criado em": "criado_em",
};

const OBRIGATORIAS = ["Identificador", "Status", "Corretor", "Cliente", "Telefone", "Criado em"];

/** "01/01/26 00:54" ou "06/01/26 18:12:00" (horário de Brasília) → ISO com fuso. */
export function dataLeadfy(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const [, dd, mm, aa, hh, mi, ss] = m;
  const ano = aa.length === 2 ? `20${aa}` : aa;
  return `${ano}-${mm}-${dd}T${hh}:${mi}:${ss ?? "00"}-03:00`;
}

export class PlanilhaLeadfyInvalida extends Error {}

/** Matriz da planilha (1ª linha = cabeçalho) → linhas, "Em negociação" e as mais novas primeiro. */
export function linhasDaLeadfy(matriz: unknown[][]): LinhaLeadfy[] {
  const [cabecalho, ...corpo] = matriz;
  const nomes = (cabecalho ?? []).map((c) => String(c ?? "").trim());
  const faltam = OBRIGATORIAS.filter((col) => !nomes.includes(col));
  if (faltam.length) {
    throw new PlanilhaLeadfyInvalida(`Esta não parece a planilha da Leadfy: faltam as colunas ${faltam.join(", ")}.`);
  }
  // Primeira ocorrência de cada nome: a Leadfy repete "Neighborhood".
  const indice = new Map<keyof LinhaLeadfy, number>();
  nomes.forEach((nome, i) => {
    const campo = COLUNAS[nome];
    if (campo && !indice.has(campo)) indice.set(campo, i);
  });
  const texto = (linha: unknown[], campo: keyof LinhaLeadfy) => {
    const i = indice.get(campo);
    if (i === undefined) return null;
    const v = linha[i];
    if (v instanceof Date) return v.toISOString();
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  const linhas = corpo
    .filter((linha) => linha.some((c) => String(c ?? "").trim() !== ""))
    .map((linha) => {
      const item = Object.fromEntries(
        (Object.values(COLUNAS) as (keyof LinhaLeadfy)[]).map((campo) => [campo, texto(linha, campo)]),
      ) as LinhaLeadfy;
      item.criado_em = dataLeadfy(item.criado_em);
      item.data_atividade = dataLeadfy(item.data_atividade);
      return item;
    });
  // Na batida de duplicidade vale o primeiro que chega: o lead em negociação e
  // o contato mais novo ganham do arquivado e do antigo com o mesmo telefone.
  return linhas.sort((a, b) =>
    Number(b.status === "Em negociação") - Number(a.status === "Em negociação")
    || (b.criado_em ?? "").localeCompare(a.criado_em ?? ""));
}

export type ResumoLeadfy = {
  total: number;
  porStatus: Record<string, number>;
  corretoresEmNegociacao: Record<string, number>;
  /** Todo nome de corretor da planilha, em qualquer status: vira apelido no cadastro (0189). */
  corretores: string[];
};

export function resumoDaLeadfy(linhas: LinhaLeadfy[]): ResumoLeadfy {
  const porStatus: Record<string, number> = {};
  const corretoresEmNegociacao: Record<string, number> = {};
  const corretores = new Set<string>();
  for (const l of linhas) {
    if (l.corretor) corretores.add(l.corretor);
    const status = l.status ?? "Sem status";
    porStatus[status] = (porStatus[status] ?? 0) + 1;
    if (l.status === "Em negociação") {
      const nome = l.corretor ?? "Sem corretor";
      corretoresEmNegociacao[nome] = (corretoresEmNegociacao[nome] ?? 0) + 1;
    }
  }
  return { total: linhas.length, porStatus, corretoresEmNegociacao, corretores: [...corretores].sort((a, b) => a.localeCompare(b, "pt-BR")) };
}

export function emLotes<T>(itens: T[], tamanho = 500): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}
