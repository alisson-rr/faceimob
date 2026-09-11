/**
 * Leitura do relatório exportado do Gerenciador de Anúncios da Meta.
 *
 * O ARQUIVO, e não a Marketing API: puxar gasto da Graph API exige app revisado
 * pela Meta e token de longa duração com `ads_read`, que o cofre não tem
 * (`MetaAdsSetup` só guarda o segredo do webhook de Lead Ads). O relatório que o
 * gestor exporta traz o mesmo número e sai hoje.
 *
 * A LEITURA do arquivo é a de `leads/importSheet` (`parseSheet`): mesmo teto de
 * bytes e de linhas, mesma detecção de separador do CSV em pt-BR, mesmo leitor
 * de XLSX. Um segundo parser aqui repetiria o bug que fez o SDR ficar sem os
 * limites de tamanho. O que é próprio deste arquivo é o vocabulário da Meta —
 * nomes de coluna, dinheiro em pt-BR e período do relatório — e a conciliação
 * com as campanhas cadastradas.
 */
import type { AdSpendBookRow, AdSpendImportRow } from "@/integrations/supabase/analytics";
import { brl } from "@/lib/format";

export type ColunaDoRelatorio = "idExterno" | "campanha" | "inicio" | "fim" | "gasto";

export type MapaDeColunas = Record<ColunaDoRelatorio, number>;

export const COLUNA_LABEL: Record<ColunaDoRelatorio, string> = {
  idExterno: "ID da campanha",
  campanha: "Nome da campanha",
  inicio: "Início do período",
  fim: "Fim do período",
  gasto: "Valor gasto",
};

/**
 * Sinônimos NA ORDEM, do específico para o genérico — a mesma regra de
 * `mapColumns`. A ordem das chaves também é de escolha: `idExterno` antes de
 * `campanha` porque "Identificação da campanha" contém "campanha" e roubaria a
 * coluna do nome; o gasto por último porque "valor" aparece em coluna de CPM e
 * de orçamento.
 *
 * Em minúsculas e COM acento: é assim que a Meta exporta em pt-BR
 * ("Início dos relatórios") e o inglês entra na mesma lista porque a conta
 * configurada em inglês exporta "Reporting starts".
 */
const SINONIMOS: Record<ColunaDoRelatorio, string[]> = {
  idExterno: ["identificação da campanha", "identificacao da campanha", "campaign id", "id da campanha", "campaign_id"],
  campanha: ["nome da campanha", "campaign name", "campanha"],
  inicio: ["início dos relatórios", "inicio dos relatorios", "reporting starts", "início do relatório", "dia", "date", "day"],
  fim: ["término dos relatórios", "termino dos relatorios", "reporting ends", "fim do relatório", "fim"],
  gasto: ["valor usado", "valor gasto", "amount spent", "gasto", "spend", "investimento"],
};

export function mapearColunas(header: string[]): MapaDeColunas {
  const headers = header.map((cell) => cell.toLowerCase().trim());
  const usadas = new Set<number>();
  const mapa: MapaDeColunas = { idExterno: -1, campanha: -1, inicio: -1, fim: -1, gasto: -1 };

  for (const campo of Object.keys(SINONIMOS) as ColunaDoRelatorio[]) {
    for (const chave of SINONIMOS[campo]) {
      const indice = headers.findIndex((cell, i) => !usadas.has(i) && cell.includes(chave));
      if (indice >= 0) {
        mapa[campo] = indice;
        usadas.add(indice);
        break;
      }
    }
  }
  return mapa;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Data da planilha em `YYYY-MM-DD`, ou `null` quando não dá para afirmar qual é.
 *
 * Três formatos, nesta ordem: ISO (o que a Meta escreve), dd/mm/aaaa (o que o
 * Excel em pt-BR reescreve ao salvar de novo) e, por último, a data que o leitor
 * de XLSX devolve como objeto `Date` já convertido em texto. A ordem importa:
 * `new Date("08/01/2026")` no JS é 8 de JANEIRO pelo calendário americano, e
 * deixar o construtor decidir trocaria dia por mês em todo arquivo brasileiro.
 */
export const lerData = (texto: string): string | null => {
  const valor = texto.trim();
  if (!valor) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const brasileira = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(valor);
  if (brasileira) {
    const dia = Number(brasileira[1]);
    const mes = Number(brasileira[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    return `${brasileira[3]}-${pad2(mes)}-${pad2(dia)}`;
  }

  // Mês ou ano soltos ("2026-08", "2026") não dizem QUAL dia o recorte começa —
  // e o construtor os lê como meia-noite UTC, que em UTC-3 volta um dia e
  // transforma agosto em 31/07. Recusa explícita: a linha cai como inválida com
  // motivo, em vez de entrar com a data errada.
  if (/^\d{4}(-\d{1,2})?$/.test(valor)) return null;

  const convertida = new Date(valor);
  if (Number.isNaN(convertida.getTime())) return null;
  return `${convertida.getFullYear()}-${pad2(convertida.getMonth() + 1)}-${pad2(convertida.getDate())}`;
};

/**
 * Dinheiro da planilha em número.
 *
 * "R$ 1.234,56" (pt-BR), "1,234.56" (en) e "1234.56" (célula numérica do XLSX)
 * são o mesmo valor escrito de três jeitos. A regra: o ÚLTIMO separador é o
 * decimal, a menos que ele tenha exatamente três dígitos depois — aí é separador
 * de milhar, porque a Meta escreve gasto com duas casas.
 *
 * `null` quando não sobra número nenhum: linha de total ("Total gasto: —") e
 * célula vazia não podem virar zero, que na tela seria "campanha que não
 * gastou".
 */
export const lerDinheiro = (texto: string): number | null => {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(limpo)) return null;

  const ultimo = Math.max(limpo.lastIndexOf(","), limpo.lastIndexOf("."));
  if (ultimo < 0) return Number(limpo);

  const casas = limpo.length - ultimo - 1;
  const semSeparadores = limpo.replace(/[.,]/g, "");
  if (casas === 3) return Number(semSeparadores);

  const valor = Number(`${semSeparadores.slice(0, semSeparadores.length - casas)}.${semSeparadores.slice(semSeparadores.length - casas)}`);
  return Number.isFinite(valor) ? valor : null;
};

/** O que a tela já sabe de cada campanha cadastrada — a forma que
 *  `CampaignPerformancePanel` entrega, para não existir um segundo carregamento. */
export type CampanhaCadastrada = {
  id: string;
  externalId: string;
  name: string;
  /** Gasto gravado hoje: é ele que a importação substitui. */
  spend: number;
  /** Recorte já importado (`null` = o gasto de hoje é digitado). */
  spendPeriodStart: string | null;
  spendPeriodEnd: string | null;
};

/**
 * O destino de cada linha do arquivo.
 *
 *   · `nova`        — casou com campanha e o período ainda não tinha gasto;
 *   · `substitui`   — casou, e o período já importado sai para o novo entrar;
 *   · `sem-campanha`— não casou com nenhuma campanha cadastrada;
 *   · `ambigua`     — casaria com mais de uma campanha, e só uma pode receber;
 *   · `invalida`    — falta período ou valor, ou eles não fazem sentido;
 *   · `repetida`    — o mesmo período da mesma campanha já apareceu no arquivo.
 *
 * Nada é descartado em silêncio: os quatro últimos estados aparecem na prévia
 * com o motivo, porque linha que some é a que ninguém percebe que faltou.
 */
export type EstadoDaLinha = "nova" | "substitui" | "sem-campanha" | "ambigua" | "invalida" | "repetida";

export type LinhaConciliada = {
  /** Número da linha no arquivo, contando o cabeçalho — é o que o operador vê no Excel. */
  linha: number;
  nome: string;
  idExterno: string;
  inicio: string | null;
  fim: string | null;
  gasto: number | null;
  estado: EstadoDaLinha;
  /** Por que esta linha vai (ou não vai) entrar. `null` só no caso trivial. */
  motivo: string | null;
  campanha: CampanhaCadastrada | null;
  /** As campanhas que essa linha alcança. Mais de uma = a linha é ambígua e
   *  espera a escolha do operador; é o que a prévia desenha no seletor. */
  candidatas: CampanhaCadastrada[];
};

export const vaiImportar = (linha: LinhaConciliada) => linha.estado === "nova" || linha.estado === "substitui";

const sobrepoe = (aInicio: string, aFim: string, bInicio: string, bFim: string) =>
  aInicio <= bFim && aFim >= bInicio;

const periodoEscrito = (inicio: string, fim: string) => {
  const br = (iso: string) => iso.split("-").reverse().join("/");
  return inicio === fim ? br(inicio) : `${br(inicio)} a ${br(fim)}`;
};

/** Período que o operador informa quando o arquivo não traz as colunas de data. */
export type PeriodoManual = { inicio: string; fim: string };

/** Uma linha do gasto JÁ GRAVADO (`ad_campaign_spend`). */
export type LinhaDoLivro = AdSpendBookRow;

export type OpcoesDaConciliacao = {
  periodoManual?: PeriodoManual | null;
  /** Campanha escolhida à mão para uma linha ambígua: nº da linha → id. */
  escolhas?: Record<number, string>;
};

/**
 * Linhas do arquivo × campanhas cadastradas.
 *
 * O casamento é pelo ID externo primeiro (é ele que liga lead e campanha) e pelo
 * nome depois, porque a exportação sem a coluna de identificação é comum e o
 * nome é o que sobra. Nome é desempate frágil de propósito: casa só quando é
 * IGUAL, sem acento nem caixa, e o ID continua sendo o caminho recomendado na
 * tela.
 *
 * E quando a chave alcança MAIS DE UMA campanha, não casa nenhuma: a linha vira
 * `ambigua` e espera o operador escolher. Escolher por ele — que era o efeito de
 * indexar tudo num `Map` de um valor só — mandaria o gasto para uma das
 * homônimas ao acaso e mudaria o CPL das duas sem deixar rastro.
 */
export function conciliar(
  rows: string[][],
  campanhas: CampanhaCadastrada[],
  opcoes: OpcoesDaConciliacao = {},
): LinhaConciliada[] {
  if (rows.length < 2) return [];
  const colunas = mapearColunas(rows[0]);
  const { periodoManual, escolhas } = opcoes;

  const chave = (texto: string) =>
    texto.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // A COLISÃO SOBREVIVE À INDEXAÇÃO. Era um `Map` de um valor só, e a última
  // campanha com a mesma chave engolia a anterior: nome não é único no banco (a
  // unicidade é de `(plataforma, id externo)`), então duas homônimas viravam
  // uma e o gasto da outra ia parar na errada, em silêncio.
  // `string | null`: o ID externo vem do banco e pode faltar; sem isso a chave
  // quebraria no `.trim()` de uma campanha sem identificação.
  const agrupar = (seletor: (c: CampanhaCadastrada) => string | null | undefined) => {
    const mapa = new Map<string, CampanhaCadastrada[]>();
    for (const campanha of campanhas) {
      const k = chave(seletor(campanha) ?? "");
      if (!k) continue;
      mapa.set(k, [...(mapa.get(k) ?? []), campanha]);
    }
    return mapa;
  };
  const porId = agrupar((c) => c.externalId);
  const porNome = agrupar((c) => c.name);

  // O que já foi aceito NESTE arquivo, por campanha: é o que denuncia a mesma
  // campanha aparecendo duas vezes com períodos que se cruzam — a segunda linha
  // apagaria a primeira dentro da mesma importação.
  const aceitos = new Map<string, { inicio: string; fim: string }[]>();

  const celula = (row: string[], indice: number) => (indice >= 0 ? (row[indice] ?? "").trim() : "");

  return rows.slice(1).map((row, indice): LinhaConciliada => {
    const linha = indice + 2;
    const nome = celula(row, colunas.campanha);
    const idExterno = celula(row, colunas.idExterno);
    const gasto = lerDinheiro(celula(row, colunas.gasto));
    const inicioArquivo = lerData(celula(row, colunas.inicio));
    // "Dia" numa exportação com repartição diária é começo e fim ao mesmo tempo.
    const fimArquivo = lerData(celula(row, colunas.fim)) ?? inicioArquivo;
    const inicio = inicioArquivo ?? periodoManual?.inicio ?? null;
    const fim = fimArquivo ?? periodoManual?.fim ?? null;

    // O ID externo primeiro; o nome só quando o ID não achou nada.
    const candidatas = (idExterno && porId.get(chave(idExterno)))
      || (nome && porNome.get(chave(nome)))
      || [];
    const base = { linha, nome, idExterno, inicio, fim, gasto, campanha: null, candidatas };

    if (!nome && !idExterno) {
      return { ...base, estado: "invalida", motivo: "Linha sem nome e sem ID de campanha (costuma ser o total do relatório)." };
    }
    if (gasto === null) {
      return { ...base, estado: "invalida", motivo: "Sem valor gasto reconhecível nesta linha." };
    }
    if (gasto < 0) {
      return { ...base, estado: "invalida", motivo: "Valor gasto negativo." };
    }
    if (!inicio || !fim) {
      return { ...base, estado: "invalida", motivo: "Sem o período do relatório. Informe o período acima ou exporte com as colunas de data." };
    }
    if (fim < inicio) {
      return { ...base, estado: "invalida", motivo: "Período invertido: o fim vem antes do início." };
    }

    const escolhida = candidatas.find((c) => c.id === escolhas?.[linha]) ?? null;
    const campanha = candidatas.length === 1 ? candidatas[0] : escolhida;

    if (!campanha && candidatas.length > 1) {
      const ids = candidatas.map((c) => c.externalId || "sem ID externo").join(", ");
      return {
        ...base,
        estado: "ambigua",
        motivo: `${candidatas.length} campanhas cadastradas respondem por ${idExterno ? `o ID ${idExterno}` : `o nome "${nome}"`} (${ids}). Escolha qual recebe o gasto, ou exporte o relatório com a coluna de identificação e importe de novo.`,
      };
    }
    if (!campanha) {
      return {
        ...base,
        estado: "sem-campanha",
        motivo: `Nenhuma campanha cadastrada com ${idExterno ? `o ID ${idExterno}` : `o nome "${nome}"`}. Cadastre a campanha com esse ID externo e importe de novo.`,
      };
    }

    // Quem escolheu à mão precisa ver a escolha dele na linha — inclusive para
    // desfazê-la depois de reparar que era a outra campanha homônima.
    const nota = candidatas.length > 1
      ? `Escolhida à mão entre ${candidatas.length} campanhas de mesmo nome (${campanha.externalId || "sem ID externo"}). `
      : "";

    const jaNoArquivo = aceitos.get(campanha.id) ?? [];
    if (jaNoArquivo.some((p) => sobrepoe(p.inicio, p.fim, inicio, fim))) {
      return {
        ...base,
        campanha,
        estado: "repetida",
        motivo: "O mesmo período desta campanha já apareceu antes no arquivo; a segunda linha apagaria a primeira.",
      };
    }
    aceitos.set(campanha.id, [...jaNoArquivo, { inicio, fim }]);

    const importado =
      campanha.spendPeriodStart && campanha.spendPeriodEnd
        ? { inicio: campanha.spendPeriodStart, fim: campanha.spendPeriodEnd }
        : null;

    if (importado && sobrepoe(importado.inicio, importado.fim, inicio, fim)) {
      return {
        ...base,
        campanha,
        estado: "substitui",
        motivo: `${nota}Substitui o gasto já importado (${periodoEscrito(importado.inicio, importado.fim)}).`,
      };
    }
    if (!importado && campanha.spend > 0) {
      return {
        ...base,
        campanha,
        estado: "substitui",
        // O valor digitado é dado de alguém: sumir dele sem dizer é o que
        // transforma a importação em perda silenciosa. Quanto sobra no lugar
        // dele está em `projetar`, que enxerga o livro inteiro.
        motivo: `${nota}A campanha tem gasto digitado (${brl(campanha.spend, { cents: true })}); ele sai da conta e o gasto volta a ser a soma dos períodos importados.`,
      };
    }
    return { ...base, campanha, estado: "nova", motivo: nota || null };
  });
}

/**
 * O que cada campanha do arquivo vai VALER depois de gravar.
 *
 * A soma das linhas do arquivo NÃO é o que fica gravado: a RPC (0113) recalcula
 * `total_spend` como a soma do livro inteiro da campanha — o recorte deste
 * arquivo mais todos os que já estavam lá. Importar setembro com agosto já
 * dentro deixa o campo valendo agosto+setembro, e a prévia que mostrava só
 * setembro prometia um número que nunca apareceria na tela.
 *
 * A conta aqui é a mesma da RPC: sai do livro todo recorte que o arquivo cobre,
 * entra o do arquivo, e o total é a soma do que sobrou.
 *
 * REGRA DO GASTO DIGITADO À MÃO. O gatilho da 0113 devolve a campanha para
 * "digitado" quando alguém corrige `total_spend`, mas não apaga o livro — e o
 * próximo relatório recalcula o total somando o livro, apagando a correção. A
 * regra adotada: a correção manual VALE até a próxima importação, e a
 * importação AVISA, aqui, que vai sobrescrevê-la e com qual número. As outras
 * duas saídas foram descartadas — apagar o livro na edição manual destruiria o
 * histórico de quem já importou, e transformar a edição em linha do livro
 * exigiria inventar o período que ela justamente não tem.
 */
export type ProjecaoDaCampanha = {
  campanha: CampanhaCadastrada;
  /** O que está gravado hoje em `total_spend`. */
  atual: number;
  /** O que ficará gravado: o livro sem os recortes substituídos, mais o arquivo. */
  final: number;
  /** Gasto digitado que esta importação descarta. `null` quando não há. */
  digitadoDescartado: number | null;
  /** O livro desta campanha não pôde ser lido — ela se diz importada e nenhuma
   *  linha apareceu. `final` vira piso, e não promessa. */
  incerto: boolean;
};

export function projetar(linhas: LinhaConciliada[], livro: LinhaDoLivro[] = []): ProjecaoDaCampanha[] {
  type Recorte = { inicio: string; fim: string; gasto: number };
  const soma = (recortes: { gasto: number }[]) => recortes.reduce((total, r) => total + r.gasto, 0);

  const porCampanha = new Map<string, { campanha: CampanhaCadastrada; novos: Recorte[] }>();
  for (const linha of linhas) {
    // A mesma conferência de `paraImportacao`: o estado já garante os campos, e
    // é este teste que garante ao compilador.
    if (!vaiImportar(linha) || !linha.campanha || !linha.inicio || !linha.fim || linha.gasto === null) continue;
    const grupo = porCampanha.get(linha.campanha.id) ?? { campanha: linha.campanha, novos: [] };
    grupo.novos.push({ inicio: linha.inicio, fim: linha.fim, gasto: linha.gasto });
    porCampanha.set(linha.campanha.id, grupo);
  }

  return [...porCampanha.values()].map(({ campanha, novos }) => {
    const doLivro = livro.filter((l) => l.campaignId === campanha.id);
    const mantidos = doLivro.filter((l) => !novos.some((n) => sobrepoe(l.inicio, l.fim, n.inicio, n.fim)));
    return {
      campanha,
      atual: campanha.spend,
      final: soma(mantidos) + soma(novos),
      digitadoDescartado: !campanha.spendPeriodStart && campanha.spend > 0 ? campanha.spend : null,
      incerto: doLivro.length === 0 && campanha.spendPeriodStart !== null,
    };
  });
}

export type ResumoDaImportacao = {
  total: number;
  importar: number;
  substitui: number;
  semCampanha: number;
  ambiguas: number;
  invalidas: number;
  repetidas: number;
  /** Soma das linhas do arquivo — o número que o operador confere contra a Meta. */
  gasto: number;
  /** Quantas campanhas o arquivo toca. */
  campanhas: number;
  /** O que essas campanhas somam hoje. */
  gastoAtual: number;
  /** O que elas vão somar DEPOIS de gravar: é este que a tela promete. */
  gastoFinal: number;
  /** Gasto digitado à mão que a importação descarta. */
  digitadoDescartado: number;
  /** Algum livro não pôde ser lido: `gastoFinal` é piso. */
  incerto: boolean;
};

export function resumir(linhas: LinhaConciliada[], livro: LinhaDoLivro[] = []): ResumoDaImportacao {
  const conta = (estado: EstadoDaLinha) => linhas.filter((l) => l.estado === estado).length;
  const projecao = projetar(linhas, livro);
  const somar = (valor: (p: ProjecaoDaCampanha) => number) =>
    projecao.reduce((total, p) => total + valor(p), 0);

  return {
    total: linhas.length,
    importar: linhas.filter(vaiImportar).length,
    substitui: conta("substitui"),
    semCampanha: conta("sem-campanha"),
    ambiguas: conta("ambigua"),
    invalidas: conta("invalida"),
    repetidas: conta("repetida"),
    gasto: linhas.filter(vaiImportar).reduce((total, l) => total + (l.gasto ?? 0), 0),
    campanhas: projecao.length,
    gastoAtual: somar((p) => p.atual),
    gastoFinal: somar((p) => p.final),
    digitadoDescartado: somar((p) => p.digitadoDescartado ?? 0),
    incerto: projecao.some((p) => p.incerto),
  };
}

/** As linhas que casaram, no formato que `marketing_import_ad_spend` recebe.
 *  `flatMap` com a conferência em vez de `!`: o estado já garante os quatro
 *  campos, mas quem garante para o compilador é este teste. */
export function paraImportacao(linhas: LinhaConciliada[]): AdSpendImportRow[] {
  return linhas.flatMap((l) =>
    vaiImportar(l) && l.campanha && l.inicio && l.fim && l.gasto !== null
      ? [{ campaign_id: l.campanha.id, period_start: l.inicio, period_end: l.fim, spend: l.gasto }]
      : [],
  );
}
