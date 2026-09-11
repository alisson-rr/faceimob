import { describe, expect, it } from "vitest";
import { parseCsv, parseSheet } from "@/components/leads/importSheet";
import {
  conciliar, lerData, lerDinheiro, mapearColunas, paraImportacao, resumir,
  type CampanhaCadastrada,
} from "./metaReport";

/**
 * O relatório da Meta importado.
 *
 * Duas coisas precisam de verificação executável aqui: o PARSER (nome de coluna
 * em pt-BR, dinheiro com ponto de milhar e data que não pode trocar dia por mês)
 * e a IDEMPOTÊNCIA — reimportar o mesmo arquivo não pode somar o mesmo dinheiro
 * duas vezes. A trava final da idempotência é do banco (chave campanha+período e
 * a substituição do recorte sobreposto, em `supabase/tests/99_import_relatorio_meta.sql`);
 * o que se prova aqui é que a tela nunca manda a mesma campanha e o mesmo
 * período duas vezes na mesma importação, e que o segundo envio do mesmo arquivo
 * é idêntico ao primeiro.
 */

/** Cabeçalho como a Meta exporta em pt-BR, com "Identificação da campanha"
 *  antes do valor — a coluna que roubaria o nome se a ordem de escolha não
 *  fosse do específico para o genérico. */
const CABECALHO = "Nome da campanha,Identificação da campanha,Início dos relatórios,Término dos relatórios,Valor usado (BRL)";

const CSV = [
  CABECALHO,
  'Lançamento Zona Sul,120001,2026-08-01,2026-08-31,"4.250,90"',
  'Viva Centro - Leads,120002,2026-08-01,2026-08-31,"3.100,00"',
  'Campanha Fantasma,999999,2026-08-01,2026-08-31,"500,00"',
].join("\n");

const campanha = (over: Partial<CampanhaCadastrada> = {}): CampanhaCadastrada => ({
  id: "uuid-1",
  externalId: "120001",
  name: "Lançamento Zona Sul",
  spend: 0,
  spendPeriodStart: null,
  spendPeriodEnd: null,
  ...over,
});

const CADASTRADAS: CampanhaCadastrada[] = [
  campanha(),
  campanha({ id: "uuid-2", externalId: "120002", name: "Viva Centro - Leads" }),
];

/** O MESMO leitor de CSV da importação, com aspas e separador: dividir por
 *  vírgula aqui quebraria "4.250,90" ao meio e o teste provaria outra coisa. */
const linhas = parseCsv;

describe("mapearColunas", () => {
  it("reconhece o cabeçalho em pt-BR da Meta", () => {
    const mapa = mapearColunas(CABECALHO.split(","));

    expect(mapa).toEqual({ campanha: 0, idExterno: 1, inicio: 2, fim: 3, gasto: 4 });
  });

  it("não deixa a coluna de identificação roubar a do nome", () => {
    // "Identificação da campanha" contém "campanha": sem a ordem de escolha, o
    // nome da campanha viraria o id e nenhuma linha casaria.
    const mapa = mapearColunas(["Identificação da campanha", "Nome da campanha"]);

    expect(mapa.idExterno).toBe(0);
    expect(mapa.campanha).toBe(1);
  });

  it("lê o cabeçalho em inglês da mesma conta configurada em outro idioma", () => {
    const mapa = mapearColunas(["Campaign name", "Campaign ID", "Reporting starts", "Reporting ends", "Amount spent (BRL)"]);

    expect(mapa).toEqual({ campanha: 0, idExterno: 1, inicio: 2, fim: 3, gasto: 4 });
  });

  it("o dia da repartição diária serve de início", () => {
    expect(mapearColunas(["Nome da campanha", "Dia", "Valor usado (BRL)"]).inicio).toBe(1);
  });
});

describe("lerDinheiro", () => {
  it("lê o formato brasileiro com ponto de milhar", () => {
    expect(lerDinheiro("R$ 4.250,90")).toBe(4250.9);
  });

  it("lê o formato americano e a célula numérica crua", () => {
    expect(lerDinheiro("4,250.90")).toBe(4250.9);
    expect(lerDinheiro("4250.9")).toBe(4250.9);
  });

  // "1.234" com três casas depois do separador é milhar em pt-BR: ler como
  // 1,23 reais transformaria mil reais em um real no número que divide o CPL.
  it("três dígitos depois do separador são milhar, não centavos", () => {
    expect(lerDinheiro("1.234")).toBe(1234);
    expect(lerDinheiro("1,234")).toBe(1234);
  });

  it("célula vazia ou sem número é null, e não zero", () => {
    expect(lerDinheiro("")).toBeNull();
    expect(lerDinheiro("—")).toBeNull();
  });
});

describe("lerData", () => {
  it("lê o ISO que a Meta exporta", () => {
    expect(lerData("2026-08-31")).toBe("2026-08-31");
  });

  // `new Date("08/01/2026")` no JS é 8 de janeiro: deixar o construtor decidir
  // trocaria dia por mês em todo arquivo salvo de novo pelo Excel em pt-BR.
  it("lê dd/mm/aaaa sem trocar dia por mês", () => {
    expect(lerData("31/08/2026")).toBe("2026-08-31");
    expect(lerData("08/01/2026")).toBe("2026-01-08");
  });

  it("lê a data que o leitor de XLSX devolve como objeto convertido em texto", () => {
    expect(lerData(String(new Date(2026, 7, 31)))).toBe("2026-08-31");
  });

  it("texto que não é data devolve null", () => {
    expect(lerData("Campanha")).toBeNull();
    expect(lerData("")).toBeNull();
  });

  // `new Date("2026-08")` é meia-noite UTC: em UTC-3 ele volta um dia e o
  // recorte de agosto começaria em 31/07. Mês solto não diz o dia — recusa.
  it("mês ou ano sem dia não vira data (viraria o dia anterior em UTC-3)", () => {
    expect(lerData("2026-08")).toBeNull();
    expect(lerData("2026-8")).toBeNull();
    expect(lerData("2026")).toBeNull();
  });
});

describe("parseSheet + conciliar", () => {
  it("lê o CSV exportado e casa cada linha com a campanha cadastrada", async () => {
    const rows = await parseSheet(new File([CSV], "relatorio-meta.csv"));
    const resultado = conciliar(rows, CADASTRADAS);

    expect(resultado).toHaveLength(3);
    expect(resultado[0]).toMatchObject({
      estado: "nova",
      gasto: 4250.9,
      inicio: "2026-08-01",
      fim: "2026-08-31",
    });
    expect(resultado[0].campanha?.id).toBe("uuid-1");
    // A terceira não existe no CRM: fica de fora COM motivo, nunca em silêncio.
    expect(resultado[2].estado).toBe("sem-campanha");
    expect(resultado[2].motivo).toContain("999999");
  });

  it("casa pelo nome quando o arquivo não traz a identificação", () => {
    const rows = linhas([
      "Nome da campanha,Início dos relatórios,Término dos relatórios,Valor usado (BRL)",
      "lançamento zona sul,2026-08-01,2026-08-31,1000.00",
    ].join("\n"));

    expect(conciliar(rows, CADASTRADAS)[0].campanha?.id).toBe("uuid-1");
  });

  it("linha sem valor legível não vira gasto zero", () => {
    const resultado = conciliar(
      linhas([CABECALHO, "Lançamento Zona Sul,120001,2026-08-01,2026-08-31,—"].join("\n")),
      CADASTRADAS,
    );

    expect(resultado[0].estado).toBe("invalida");
    expect(resultado[0].motivo).toContain("valor gasto");
  });

  it("sem coluna de data, o período informado à mão completa a linha", () => {
    const rows = linhas([
      "Nome da campanha,Identificação da campanha,Valor usado (BRL)",
      "Lançamento Zona Sul,120001,1000.00",
    ].join("\n"));

    expect(conciliar(rows, CADASTRADAS)[0].estado).toBe("invalida");
    const comPeriodo = conciliar(rows, CADASTRADAS, { periodoManual: { inicio: "2026-08-01", fim: "2026-08-31" } });
    expect(comPeriodo[0]).toMatchObject({ estado: "nova", inicio: "2026-08-01", fim: "2026-08-31" });
  });

  it("avisa quando o gasto digitado vai sair da conta", () => {
    const comDigitado = [campanha({ spend: 9999 }), CADASTRADAS[1]];
    const resultado = conciliar(linhas(CSV), comDigitado);

    expect(resultado[0].estado).toBe("substitui");
    expect(resultado[0].motivo).toContain("digitado");
  });
});

describe("idempotência da importação", () => {
  it("o mesmo arquivo lido duas vezes produz o mesmo envio", () => {
    const primeiro = paraImportacao(conciliar(linhas(CSV), CADASTRADAS));
    // Depois de gravar, as campanhas voltam do banco com o período coberto.
    const depois = CADASTRADAS.map((c) =>
      ({ ...c, spend: c.id === "uuid-1" ? 4250.9 : 3100, spendPeriodStart: "2026-08-01", spendPeriodEnd: "2026-08-31" }));
    const segundo = conciliar(linhas(CSV), depois);

    expect(segundo.filter((l) => l.estado === "substitui")).toHaveLength(2);
    // Mesmo par (campanha, período) e mesmo valor: o banco reescreve a linha em
    // vez de criar a segunda, e o total não muda.
    expect(paraImportacao(segundo)).toEqual(primeiro);
  });

  it("a mesma campanha duas vezes no arquivo não entra duas vezes", () => {
    const repetido = [
      CABECALHO,
      'Lançamento Zona Sul,120001,2026-08-01,2026-08-31,"1.000,00"',
      'Lançamento Zona Sul,120001,2026-08-10,2026-08-20,"400,00"',
    ].join("\n");

    const resultado = conciliar(linhas(repetido), CADASTRADAS);

    expect(resultado[0].estado).toBe("nova");
    // O segundo recorte cai DENTRO do primeiro: gravar os dois faria o mesmo dia
    // entrar duas vezes na soma do `total_spend`.
    expect(resultado[1].estado).toBe("repetida");
    expect(paraImportacao(resultado)).toHaveLength(1);
  });

  it("período seguinte da mesma campanha soma, e não substitui", () => {
    const setembro = [
      CABECALHO,
      'Lançamento Zona Sul,120001,2026-09-01,2026-09-30,"2.000,00"',
    ].join("\n");
    const jaImportado = [campanha({ spend: 4250.9, spendPeriodStart: "2026-08-01", spendPeriodEnd: "2026-08-31" })];

    expect(conciliar(linhas(setembro), jaImportado)[0].estado).toBe("nova");
  });
});

describe("resumir", () => {
  it("conta o que entra, o que fica de fora e quanto soma", () => {
    const resumo = resumir(conciliar(linhas(CSV), CADASTRADAS));

    expect(resumo).toMatchObject({ total: 3, importar: 2, semCampanha: 1, invalidas: 0, repetidas: 0 });
    expect(resumo.gasto).toBeCloseTo(7350.9, 2);
  });
});

describe("nome repetido no cadastro", () => {
  /** Duas campanhas com o MESMO nome: o banco permite (a unicidade é de
   *  `(plataforma, id externo)`), e era isso que o índice por nome colapsava. */
  const HOMONIMAS: CampanhaCadastrada[] = [
    campanha(),
    campanha({ id: "uuid-3", externalId: "120003" }),
  ];

  const SEM_ID = [
    "Nome da campanha,Início dos relatórios,Término dos relatórios,Valor usado (BRL)",
    "Lançamento Zona Sul,2026-08-01,2026-08-31,1000.00",
  ].join("\n");

  it("não casa sozinho: a linha fica ambígua e não entra", () => {
    const resultado = conciliar(linhas(SEM_ID), HOMONIMAS);

    expect(resultado[0].estado).toBe("ambigua");
    expect(resultado[0].campanha).toBeNull();
    expect(resultado[0].candidatas.map((c) => c.id)).toEqual(["uuid-1", "uuid-3"]);
    expect(resultado[0].motivo).toContain("120003");
    // O defeito era o silêncio: o gasto ia para uma das duas e mudava o CPL
    // das duas sem deixar rastro.
    expect(paraImportacao(resultado)).toHaveLength(0);
    expect(resumir(resultado).ambiguas).toBe(1);
  });

  it("a escolha do operador resolve a linha, e a linha diz que foi à mão", () => {
    const resultado = conciliar(linhas(SEM_ID), HOMONIMAS, { escolhas: { 2: "uuid-3" } });

    expect(resultado[0].estado).toBe("nova");
    expect(resultado[0].campanha?.id).toBe("uuid-3");
    expect(resultado[0].motivo).toContain("à mão");
    expect(paraImportacao(resultado)).toEqual([
      { campaign_id: "uuid-3", period_start: "2026-08-01", period_end: "2026-08-31", spend: 1000 },
    ]);
  });

  it("com a coluna de identificação, o ID casa direto mesmo entre homônimas", () => {
    expect(conciliar(linhas(CSV), HOMONIMAS)[0].campanha?.id).toBe("uuid-1");
  });
});

describe("o valor que fica gravado", () => {
  const AGOSTO_NO_LIVRO = [{ campaignId: "uuid-1", inicio: "2026-08-01", fim: "2026-08-31", gasto: 4250.9 }];
  const JA_IMPORTADA = [campanha({ spend: 4250.9, spendPeriodStart: "2026-08-01", spendPeriodEnd: "2026-08-31" })];
  const arquivo = (linha: string) => linhas([CABECALHO, linha].join("\n"));

  it("a prévia promete a soma do LIVRO, e não a das linhas do arquivo", () => {
    // Importar setembro com agosto já dentro faz o campo valer os dois. A
    // prévia dizia "somando R$ 2.000" e a tela passava a mostrar R$ 6.250,90.
    const resumo = resumir(
      conciliar(arquivo('Lançamento Zona Sul,120001,2026-09-01,2026-09-30,"2.000,00"'), JA_IMPORTADA),
      AGOSTO_NO_LIVRO,
    );

    expect(resumo.gasto).toBeCloseTo(2000, 2);
    expect(resumo.gastoAtual).toBeCloseTo(4250.9, 2);
    expect(resumo.gastoFinal).toBeCloseTo(6250.9, 2);
  });

  it("recorte sobreposto substitui o antigo, e o total não conta o mês duas vezes", () => {
    const resumo = resumir(
      conciliar(arquivo('Lançamento Zona Sul,120001,2026-08-10,2026-08-20,"500,00"'), JA_IMPORTADA),
      AGOSTO_NO_LIVRO,
    );

    expect(resumo.gastoFinal).toBeCloseTo(500, 2);
  });

  it("o gasto digitado à mão aparece como descartado, junto com o que sobra", () => {
    // O gatilho da 0113 devolve a campanha para "digitado" quando alguém
    // corrige o valor, mas não apaga o livro: a importação seguinte recalcula
    // somando julho de novo e o número digitado some. A prévia diz os dois.
    const digitada = [campanha({ spend: 999 })];
    const julho = [{ campaignId: "uuid-1", inicio: "2026-07-01", fim: "2026-07-31", gasto: 800 }];

    const conciliadas = conciliar(arquivo('Lançamento Zona Sul,120001,2026-08-01,2026-08-31,"1.000,00"'), digitada);
    const resumo = resumir(conciliadas, julho);

    expect(conciliadas[0].estado).toBe("substitui");
    expect(resumo.digitadoDescartado).toBe(999);
    expect(resumo.gastoFinal).toBeCloseTo(1800, 2);
    expect(resumo.incerto).toBe(false);
  });

  it("livro ilegível vira aviso, e não um total inventado", () => {
    // A campanha se diz importada e nenhuma linha do livro chegou (RLS, falha
    // de rede): o total previsto é piso, e a tela precisa dizer isso.
    const resumo = resumir(
      conciliar(arquivo('Lançamento Zona Sul,120001,2026-09-01,2026-09-30,"2.000,00"'), JA_IMPORTADA),
      [],
    );

    expect(resumo.incerto).toBe(true);
    expect(resumo.gastoFinal).toBeCloseTo(2000, 2);
  });
});
