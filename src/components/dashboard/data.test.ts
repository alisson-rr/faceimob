import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  dashboardScope,
  dealCategory,
  leadsInMonth,
  monthOptions,
  monthView,
  monthlySeries,
  participantsOf,
  perdaIds,
  pickSalesGoal,
  rankBy,
  useDashboardPayload,
  vazioTotal,
  withZeroSellers,
  type DashboardScope,
  type DealRow,
} from "./data";
import type { Lead } from "@/types/crm";
import { catalogoDeTeste } from "@/components/pipeline/statusCatalog.fixture";
import { linhasDoStatus2 } from "./cartoesDoMes";
import type { DashboardPayload, MonthlyGoalRow, PersonRecord } from "@/integrations/supabase/newSchema";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, roles: [] }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * As contas do painel que discordavam do banco.
 *
 * 1. A categoria (venda/produção/perda) saía de `status_detail`, o "Status 2" de
 *    32 rótulos digitados na operação. `normalizeStatus` devolvia `null` para 27
 *    deles e o negócio sumia de TODOS os indicadores — na homologação, em
 *    08/2026, três negócios com "13. ESTEIRA AGIL" faziam o cartão "Negócios"
 *    dizer 22 e o bloco "Negócios por etapa" dizer 25, na mesma tela. Agora
 *    manda `outcome`, que é o banco quem mantém.
 * 2. O ranking lia só `broker1_id` e somava o `deal_value` inteiro: num negócio
 *    dividido, o segundo corretor sumia do pódio e o primeiro levava o VGV do
 *    colega. O banco divide (`recalc_deal_shares`, `share_pct = 100/n`) e conta
 *    a venda para cada corretor (`deals_award_points`).
 * 3. O card de meta comparava as vendas do usuário logado com a meta 'global'.
 *    O numerador já sai recortado pela RLS, então o denominador segue o escopo.
 */
const deal = (fields: Partial<DealRow>): DealRow =>
  ({
    id: "d1",
    outcome: "open",
    status: "",
    stage: "proposal",
    client: "",
    developer: "",
    month_base: "08/2026",
    deal_value: 0,
    broker1: "",
    manager1: "",
    ...fields,
  }) as DealRow;

const venda = (fields: Partial<DealRow> = {}) => deal({ outcome: "won", stage: "closed", ...fields });

const pessoa = (id: string, name: string, extra: Partial<PersonRecord> = {}) =>
  ({ id, name, roles: ["broker"], role: "broker", active: true, manager_id: null, director_id: null, ...extra }) as PersonRecord;

describe("rankBy — cada ranking com os números do papel (29/09/2026)", () => {
  // Diretor Daniel também é gerente da equipe A e aparece como gerente e
  // diretor nos slots do negócio — o caso que o punha acima dos gerentes.
  const people = [
    pessoa("b1", "Ana", { manager_id: "m1", director_id: "dir" }),
    pessoa("b2", "Bia", { manager_id: "m1", director_id: "dir" }),
    pessoa("b3", "Caio", { manager_id: "m2", director_id: "dir" }),
    pessoa("m1", "Marcos", { roles: ["manager", "broker"], role: "manager" }),
    pessoa("m2", "Mara", { roles: ["manager", "broker"], role: "manager" }),
    pessoa("dir", "Daniel", { roles: ["director", "manager", "broker"], role: "director" }),
  ];
  const vendas = [
    venda({ id: "v1", deal_value: 300_000, broker1_id: "b1", broker1: "Ana", broker2_id: "b2", broker2: "Bia",
      manager1_id: "dir", manager1: "Daniel", director1_id: "dir", director1_name: "Daniel" }),
    venda({ id: "v2", deal_value: 100_000, broker1_id: "b3", broker1: "Caio",
      manager1_id: "dir", manager1: "Daniel", director1_id: "dir", director1_name: "Daniel" }),
  ];

  it("geral é só corretor: o diretor no slot de gestor não entra", () => {
    expect(rankBy(vendas, "broker", people)).toEqual([
      { id: "b1", name: "Ana", vendas: 1, vgv: 150_000 },
      { id: "b2", name: "Bia", vendas: 1, vgv: 150_000 },
      { id: "b3", name: "Caio", vendas: 1, vgv: 100_000 },
    ]);
  });

  it("gerente soma os corretores da equipe que gerencia — dois da mesma equipe são uma venda", () => {
    expect(rankBy(vendas, "manager", people)).toEqual([
      { id: "m1", name: "Marcos", vendas: 1, vgv: 300_000 },
      { id: "m2", name: "Mara", vendas: 1, vgv: 100_000 },
    ]);
  });

  it("diretor soma a diretoria inteira", () => {
    expect(rankBy(vendas, "director", people)).toEqual([
      { id: "dir", name: "Daniel", vendas: 2, vgv: 400_000 },
    ]);
  });

  it("corretor fora do alcance de quem olha não credita gestor nenhum", () => {
    expect(rankBy(vendas, "manager", [])).toEqual([]);
  });
});

describe("dealCategory — o outcome manda, o Status 2 é detalhe", () => {
  it("venda com rótulo do catálogo continua sendo venda", () => {
    // Os dois rótulos que o Select da tela oferece/o sistema escreve num
    // negócio ganho. Com a categoria saindo do rótulo, os dois viravam nada.
    expect(dealCategory(venda({ status: "03. ASSINADO" }))).toBe("venda");
    expect(dealCategory(venda({ status: "13. ESTEIRA AGIL" }))).toBe("venda");
    expect(dealCategory(venda({ status: "" }))).toBe("venda");
  });

  it("negócio aberto é produção, com qualquer rótulo", () => {
    expect(dealCategory(deal({ status: "13. ESTEIRA AGIL" }))).toBe("producao");
    expect(dealCategory(deal({ status: "16. PENDENTE" }))).toBe("producao");
    expect(dealCategory(deal({ status: "PROPOSTA" }))).toBe("producao");
  });

  it("perdido é perda, menos os dois rótulos que encerram sem perda", () => {
    expect(dealCategory(deal({ outcome: "lost", status: "18. QUEDA" }))).toBe("perda");
    expect(dealCategory(deal({ outcome: "lost", status: "17. DISTRATO" }))).toBe("perda");
    // `dealStatus.ts`: "19. REPROVADO" e "OFF" tiram o negócio do funil sem
    // entrar na conta de perdas. A regra é de lá; aqui só não pode divergir.
    expect(dealCategory(deal({ outcome: "lost", status: "19. REPROVADO" }))).toBe("fora");
    expect(dealCategory(deal({ outcome: "lost", status: "OFF" }))).toBe("fora");
  });

  it("cancelado não é perda: é negócio que deixou de existir", () => {
    expect(dealCategory(deal({ outcome: "cancelled", status: "" }))).toBe("fora");
  });
});

describe("monthView — o mês inteiro numa conta só", () => {
  // O recorte de 08/2026 na homologação, medido em 02/09/2026.
  const homologacao = [
    ...Array.from({ length: 15 }, (_, i) => deal({ id: `open${i}`, status: "" })),
    ...Array.from({ length: 3 }, (_, i) => deal({ id: `esteira${i}`, status: "13. ESTEIRA AGIL" })),
    ...Array.from({ length: 7 }, (_, i) => venda({ id: `won${i}`, deal_value: 100_000 })),
    deal({ id: "perdido", outcome: "lost", status: "" }),
  ];

  it("os 3 negócios em '13. ESTEIRA AGIL' entram na produção", () => {
    const { stats } = monthView(homologacao, "08/2026");
    expect(stats.propostas).toBe(18);
    expect(stats.vendas).toBe(7);
    expect(stats.negocios).toBe(25);
    expect(stats.vgv).toBe(700_000);
  });

  it("o total do bloco por Status 2 é o mesmo do cartão 'Negócios', status fora do catálogo inclusive", () => {
    // Era 22 no cartão e 25 no bloco, lado a lado, sem nada avisar. Desde
    // 28/09/2026 o bloco é por Status 2: status fora do catálogo vira linha
    // própria em vez de sumir do total.
    const { stats, rows } = monthView(homologacao, "08/2026");
    const linhas = linhasDoStatus2(rows, catalogoDeTeste);
    expect(linhas.reduce((total, linha) => total + linha.value, 0)).toBe(stats.negocios);
    expect(linhas.every((linha) => linha.value > 0)).toBe(true);
  });

  it("QUEDA é perda; DISTRATO só com venda anterior do mesmo cliente", () => {
    const rows = [
      venda({ id: "v1", client: "Ana", month_base: "07/2026" }),
      deal({ id: "d-ana", outcome: "lost", status: "17. DISTRATO", client: "Ana", month_base: "08/2026" }),
      venda({ id: "v2", client: "Bruno", month_base: "08/2026" }),
      // Distrato no MESMO mês da venda é correção de digitação, não perda.
      deal({ id: "d-bruno", outcome: "lost", status: "17. DISTRATO", client: "Bruno", month_base: "08/2026" }),
      deal({ id: "q1", outcome: "lost", status: "18. QUEDA", client: "Carla", month_base: "08/2026" }),
    ];
    expect([...perdaIds(rows)].sort()).toEqual(["d-ana", "q1"]);
    expect(monthView(rows, "08/2026").stats.perdas).toBe(2);
  });

  it("o mês anterior vira o comparativo do delta", () => {
    const rows = [venda({ id: "a", month_base: "07/2026" }), venda({ id: "b", month_base: "08/2026" })];
    const view = monthView(rows, "08/2026");
    expect(view.previousMonth).toBe("07/2026");
    expect(view.previous?.vendas).toBe(1);
    // "Todos os meses" não tem com o que comparar.
    expect(monthView(rows, "all").previous).toBeNull();
    expect(monthView(rows, "all").stats.vendas).toBe(2);
  });

  it("a construtora sem negócio no mês continua na grade, com zero", () => {
    const rows = [
      venda({ id: "a", developer: " mrv ", month_base: "07/2026", deal_value: 300_000 }),
      venda({ id: "b", developer: "Tenda", month_base: "08/2026" }),
    ];
    const view = monthView(rows, "08/2026");
    expect(view.developers.map((row) => [row.dev, row.negocios])).toEqual([
      ["MRV", 0],
      ["TENDA", 1],
    ]);
  });

  it("construtora acentuada ordena pela letra base, nao depois do Z", () => {
    // `sort()` sem comparador compara code unit: "Á" e U+00C1, maior que "Z"
    // (U+005A), entao toda construtora acentuada ia para o fim da grade, do
    // grafico e do ranking de propostas — que herda esta ordem no empate.
    const rows = [
      venda({ id: "a", developer: "Zamboni" }),
      venda({ id: "b", developer: "Águia" }),
      venda({ id: "c", developer: "Brasal" }),
    ];
    expect(monthView(rows, "08/2026").developers.map((row) => row.dev)).toEqual([
      "ÁGUIA",
      "BRASAL",
      "ZAMBONI",
    ]);
  });
});

describe("monthlySeries — o comparativo anual", () => {
  it("conta a venda pelo outcome, não pelo rótulo digitado", () => {
    const series = monthlySeries([
      venda({ id: "a", status: "13. ESTEIRA AGIL", month_base: "08/2026" }),
      venda({ id: "b", status: "", month_base: "08/2025" }),
      deal({ id: "c", month_base: "08/2026" }),
    ]);
    expect(series.years).toEqual(["2025", "2026"]);
    expect(series.rows.find((row) => row.mes === "08")).toEqual({
      mes: "08",
      "2025": 1,
      "2026": 1,
    });
  });
});

describe("monthOptions e o mês padrão — o filtro de período", () => {
  const rows = [venda({ id: "a", month_base: "08/2026" }), venda({ id: "b", month_base: "07/2026" })];

  afterEach(() => {
    vi.useRealTimers();
  });

  it("o mês corrente entra na lista mesmo sem negócio", () => {
    // A meta de 09/2026 estava gravada e 09/2026 não aparecia no filtro, porque
    // não havia negócio no mês: quem cadastrava a meta não conseguia vê-la.
    expect(monthOptions(rows, "09/2026")).toEqual(["09/2026", "08/2026", "07/2026"]);
    expect(monthOptions([], "09/2026")).toEqual(["09/2026"]);
  });

  /**
   * Pedido do dono, 17/09/2026: o painel abre SEMPRE no mês corrente. Na
   * homologação um único negócio com mês-base 02/2027 fazia o Dashboard abrir
   * em 02/2027, porque o padrão era o mês aberto mais recente com negócio.
   */
  it("abre no mês corrente, mesmo com negócio em mês futuro e o mês corrente vazio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 17, 10));

    const payload: DashboardPayload = {
      people: [],
      deals: [
        venda({ id: "futuro", month_base: "02/2027" }),
        venda({ id: "dezembro", month_base: "12/2026" }),
        venda({ id: "agosto", month_base: "08/2026" }),
      ],
      leadsCount: 0,
      ccaCounts: {},
      staff: { brokersTotal: 0, active: 0, managers: 0, directors: 0 },
      closedMonths: ["08/2026"],
    };
    // Cache já preenchido e sem prazo de validade: o hook lê daqui e não vai à rede.
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["dashboard", "payload", "u1"], payload);

    let lido: ReturnType<typeof useDashboardPayload> | null = null;
    function Painel() {
      lido = useDashboardPayload();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Painel)));
    });

    expect(lido?.defaultMonth).toBe("09/2026");
    expect(lido?.monthsWithDeals.has("09/2026")).toBe(false);
    expect(lido?.months).toEqual(["02/2027", "12/2026", "09/2026", "08/2026"]);

    await act(async () => root.unmount());
  });

  /**
   * Aba aberta na virada do mês: os negócios não mudam (o TanStack devolve a
   * mesma referência), então a lista de meses só refaz se o mês corrente for
   * dependência dela. Sem isso o padrão virava 10/2026 e a lista continuava em
   * 09/2026 — o seletor ficava sem rótulo, mostrando um mês que ninguém pediu.
   */
  it("na virada do mês, a lista acompanha o mês padrão", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));

    const payload: DashboardPayload = {
      people: [],
      deals: [venda({ id: "agosto", month_base: "08/2026" })],
      leadsCount: 0,
      ccaCounts: {},
      staff: { brokersTotal: 0, active: 0, managers: 0, directors: 0 },
      closedMonths: [],
    };
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["dashboard", "payload", "u1"], payload);

    let lido: ReturnType<typeof useDashboardPayload> | null = null;
    function Painel() {
      lido = useDashboardPayload();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Painel)));
    });
    expect(lido?.months).toEqual(["09/2026", "08/2026"]);

    // Passou da meia-noite e a tela repinta (trocar de aba, clicar em Recarregar).
    vi.setSystemTime(new Date(2026, 9, 1, 0, 1));
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Painel)));
    });

    expect(lido?.defaultMonth).toBe("10/2026");
    expect(lido?.months).toContain("10/2026");

    await act(async () => root.unmount());
  });
});

describe("leadsInMonth — a aba de leads segue o filtro do topo", () => {
  const leads = [
    { id: "a", created_at: "2026-08-10T12:00:00-03:00" },
    { id: "b", created_at: "2026-09-01T09:00:00-03:00" },
  ] as Lead[];

  it("filtra pelo mês escolhido e não filtra nada em 'todos os meses'", () => {
    expect(leadsInMonth(leads, "08/2026").map((lead) => lead.id)).toEqual(["a"]);
    expect(leadsInMonth(leads, "all")).toHaveLength(2);
  });
});

describe("rankBy — rateio do negocio", () => {
  const meioAMeio = venda({
    deal_value: 600_000,
    broker1_id: "b1",
    broker1_name: "Diego",
    broker2_id: "b2",
    broker2_name: "Gustavo",
    manager1_id: "m1",
    manager1_name: "Marcos",
    director1_id: "dir1",
    director1_name: "Daniela",
  });

  it("credita a venda aos dois corretores e divide o VGV pelo numero deles", () => {
    expect(rankBy([meioAMeio], "broker")).toEqual([
      { id: "b1", name: "Diego", vendas: 1, vgv: 300_000 },
      { id: "b2", name: "Gustavo", vendas: 1, vgv: 300_000 },
    ]);
  });

  it("corretor sozinho continua com a venda e o VGV inteiros", () => {
    const sozinho = venda({ id: "d2", deal_value: 400_000, broker1_id: "b1", broker1_name: "Diego" });
    expect(rankBy([sozinho], "broker")).toEqual([
      { id: "b1", name: "Diego", vendas: 1, vgv: 400_000 },
    ]);
  });

  it("negócio em aberto não entra no ranking — so o que virou resultado", () => {
    const proposta = deal({ id: "d3", deal_value: 900_000, broker1_id: "b1", broker1_name: "Diego" });
    expect(rankBy([proposta], "broker")).toEqual([]);
  });

  it("venda com Status 2 do catálogo entra no ranking", () => {
    const assinado = venda({ id: "d5", status: "03. ASSINADO", deal_value: 500_000, broker1_id: "b1", broker1_name: "Diego" });
    expect(rankBy([assinado], "broker")).toEqual([
      { id: "b1", name: "Diego", vendas: 1, vgv: 500_000 },
    ]);
  });

  it("participante sem nome divide o VGV mas nao vira card 'Sem nome'", () => {
    // Guarda, nao caminho de rotina: o nome sai de `deal_participant_names()`,
    // que e SECURITY DEFINER e devolve o nome de todo participante de negocio
    // visivel — nem `auth_visible_profiles()` o filtra. O que este caso fixa e
    // que um perfil sem `full_name` nao rouba o rateio do colega nem imprime um
    // card anonimo num ranking de premiacao. Decisao de 02/09/2026: a RPC fica
    // como esta, e o rodape que contava "N sem nome" saiu (ele descrevia um
    // comportamento que o banco nao tem).
    const semNome = venda({
      id: "d4",
      deal_value: 606_100,
      broker1_id: "b1",
      broker1_name: "Diego",
      broker2_id: "b2",
      broker2_name: null,
    });
    expect(rankBy([semNome], "broker")).toEqual([
      { id: "b1", name: "Diego", vendas: 1, vgv: 303_050 },
    ]);
  });

  it("empate de vendas E de VGV desempata pelo nome, nao pela ordem de chegada", () => {
    // Nao e caso raro: os dois corretores do MESMO negocio rateado empatam
    // sempre — 1 venda e `deal_value / 2` cada, identicos ate o centavo. A
    // ordem era a de insercao no `Map`, que segue a dos negocios
    // (`created_at desc, id`): bastava cadastrar um negocio para o podio trocar
    // de degrau. O acento entra junto — "Ávila" vem antes de "Zeca".
    const zecaNoSlot1 = venda({
      id: "x1", deal_value: 500_000,
      broker1_id: "b9", broker1_name: "Zeca", broker2_id: "b2", broker2_name: "Ávila",
    });
    const avilaNoSlot1 = venda({
      id: "x2", deal_value: 500_000,
      broker1_id: "b2", broker1_name: "Ávila", broker2_id: "b9", broker2_name: "Zeca",
    });
    expect(rankBy([zecaNoSlot1], "broker").map((row) => row.name)).toEqual(["Ávila", "Zeca"]);
    expect(rankBy([avilaNoSlot1], "broker").map((row) => row.name)).toEqual(["Ávila", "Zeca"]);
  });
});

describe("dashboardScope — o recorte por papel, que espelha as policies", () => {
  const comFila = (roles: string[]) => dashboardScope(roles, true);
  const semFila = (roles: string[]) => dashboardScope(roles, false);

  it("admin le tudo e enxerga todo mundo", () => {
    expect(comFila(["admin"])).toMatchObject({
      readsAllDeals: true,
      seesEveryone: true,
      seesAllCca: true,
      isDirector: false,
      canManageGoal: true,
      dealsLabel: "toda a operação",
      leadsLabel: "toda a base",
      leadsIsWholeBase: true,
    });
  });

  it("diretor le so os negocios da propria hierarquia (0141)", () => {
    // Regra do dono (12/09/2026): so socio e admin veem tudo. `can_read_all()`
    // virou `is_admin()` e o diretor chega aos negocios por
    // `auth_visible_deal_ids()` — o mesmo recorte de pessoas dos leads. A tela
    // nao pode continuar prometendo "toda a operação" nem a esteira inteira.
    const dir = comFila(["director"]);
    expect(dir.readsAllDeals).toBe(false);
    expect(dir.seesEveryone).toBe(false);
    expect(dir.seesAllCca).toBe(false);
    expect(dir.isDirector).toBe(true);
    expect(dir.canManageGoal).toBe(true);
    expect(dir.dealsLabel).toContain("equipes que você lidera");
    expect(dir.leadsLabel).toContain("sua carteira");
  });

  it("socio le tudo, cadastra meta e tem a base de leads MENOR que a real", () => {
    // `role_permissions` nao da `leads.view_queue` a partner, e a
    // `leads_select` so libera lead sem dono a quem tem a permissao: 69 de 74
    // na homologacao, sob um rotulo que dizia "total na base".
    //
    // `canManageGoal` e verdadeiro desde 10/09/2026: administrador e socio tem
    // o mesmo nivel de permissao (decisao do cliente), e `goals_write` (0061)
    // abre em `is_admin()`, que a 0097 fez responder sim para o socio. Enquanto
    // isto era falso, a tela escondia do socio um botao que o banco aceitava.
    const socio = semFila(["partner"]);
    expect(socio).toMatchObject({ readsAllDeals: true, seesEveryone: true, canManageGoal: true });
    expect(socio.leadsLabel).toContain("fila sem dono não entra");
    // O booleano que a tela consome tem de dizer o MESMO que o rotulo: enquanto
    // o `LeadsPanel` recebia `seesEveryone`, ele escrevia "A base tem 69 leads"
    // logo abaixo do rotulo que avisava que a fila nao entra no acesso dele.
    expect(socio.leadsIsWholeBase).toBe(false);
    expect(comFila(["admin"]).leadsIsWholeBase).toBe(true);
    // Enxergar todo PERFIL nao e enxergar todo LEAD, e o inverso tambem vale: o
    // diretor tem `leads.view_queue`, mas `auth_visible_profiles()` recorta a
    // base dele na subarvore — nao e a base inteira.
    expect(comFila(["director"]).leadsIsWholeBase).toBe(false);
  });

  it("gerente e corretor nao leem a operacao inteira nem cadastram meta", () => {
    for (const papel of ["manager", "broker"]) {
      const escopo = comFila([papel]);
      expect(escopo).toMatchObject({
        readsAllDeals: false,
        seesEveryone: false,
        seesAllCca: false,
        isDirector: false,
        canManageGoal: false,
      });
      expect(escopo.dealsLabel).toBe("os negócios da sua carteira e das equipes que você lidera");
    }
  });

  it("o CCA ve a esteira inteira sem ler os negocios da empresa", () => {
    expect(comFila(["cca"])).toMatchObject({ seesAllCca: true, readsAllDeals: false });
  });

  it("diretor que tambem e corretor continua diretor (papel e N:N)", () => {
    const dual = comFila(["director", "broker"]);
    expect(dual.isDirector).toBe(true);
    expect(dual.readsAllDeals).toBe(false);
    // Acumular papel nao amplia: so admin ou socio junto leem a empresa.
    expect(comFila(["director", "partner"]).readsAllDeals).toBe(true);
  });
});

describe("vazioTotal — o painel sem negocio e sem lead", () => {
  const admin = dashboardScope(["admin"], true);
  const socio = dashboardScope(["partner"], false);
  const diretor = dashboardScope(["director"], true);
  const corretor = dashboardScope(["broker"], true);
  const texto = (e: DashboardScope) => vazioTotal(e.readsAllDeals, e.leadsIsWholeBase);

  it("so afirma que a BASE esta vazia a quem le todo negocio E todo lead", () => {
    expect(texto(admin).title).toBe("A base ainda está vazia");
  });

  it("socio sem a fila le toda a empresa, mas nao toda a base de leads", () => {
    // "a base esta vazia" com a fila cheia manda procurar defeito onde ha
    // recorte — e "nada esta atribuido a voce" nega o `can_read_all()` que ele
    // tem.
    const saida = texto(socio);
    expect(saida.title).toBe("Nenhum negócio cadastrado ainda");
    expect(saida.description).toContain("menor que a base da operação");
    expect(saida.description).not.toContain("atribuído a você");
  });

  it("ao corretor e ao diretor (0141), o vazio e o do proprio recorte", () => {
    // O diretor deixou de ler a empresa: afirmar "nenhum negocio cadastrado"
    // falaria de uma base que ele nao enxerga mais.
    expect(texto(corretor).title).toBe("Você ainda não tem lead nem negócio");
    expect(texto(diretor).title).toBe("Você ainda não tem lead nem negócio");
  });
});

describe("participantsOf — a travessia que o Dashboard e o painel da diretoria dividem", () => {
  it("devolve todos os slots preenchidos, na ordem, mesmo sem nome resolvido", () => {
    const dividido = deal({
      broker1_id: "outra-equipe",
      broker1_name: null,
      broker2_id: "b2",
      broker2_name: "Gustavo",
    });
    // O corretor da diretoria e o ordinal 2: filtrar so por `broker1_id` sumia
    // com o negocio inteiro do "medido" do painel do diretor.
    expect(participantsOf(dividido, "broker")).toEqual([
      { id: "outra-equipe", name: null },
      { id: "b2", name: "Gustavo" },
    ]);
  });
});

describe("pickSalesGoal — o denominador segue o escopo do numerador", () => {
  const perfil: MonthlyGoalRow = { scope: "profile", profile_id: "u1", team_id: null, target: 3 };
  const equipe: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t1", target: 6 };
  const global: MonthlyGoalRow = { scope: "global", profile_id: null, team_id: null, target: 14 };

  it("a meta do proprio perfil vence a da equipe, para quem NAO le tudo", () => {
    expect(
      pickSalesGoal([global, equipe, perfil], {
        profileId: "u1",
        ledTeamIds: ["t1"],
        roles: ["manager"],
      }),
    ).toEqual({ target: 3, scope: "profile" });
  });

  it("o diretor soma as metas das equipes que lidera, nao a global (0141)", () => {
    // Desde a 0141 `can_read_all()` e so admin e socio: o realizado do diretor
    // sai dos negocios da hierarquia dele, entao o denominador e a soma das
    // equipes que ele lidera — Paulista(6) + Sul(5) = 11, e nao a global (14),
    // que falaria da empresa inteira sobre um numero parcial.
    const paulista: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t1", target: 6 };
    const sul: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t2", target: 5 };
    expect(
      pickSalesGoal([global, paulista, sul], {
        profileId: "dir",
        ledTeamIds: ["t1", "t2"],
        roles: ["director"],
      }),
    ).toEqual({ target: 11, scope: "team" });
    expect(
      pickSalesGoal([global, paulista, sul], {
        profileId: "soc",
        ledTeamIds: ["t1", "t2"],
        roles: ["partner"],
      }),
    ).toEqual({ target: 14, scope: "global" });
  });

  it("admin com meta PESSOAL cadastrada tambem fica no global", () => {
    // O numerador dele e a empresa inteira; a meta pessoal embaixo desse
    // realizado e o mesmo descasamento, so que na outra direcao.
    expect(
      pickSalesGoal([global, perfil], { profileId: "u1", ledTeamIds: [], roles: ["admin"] }),
    ).toEqual({ target: 14, scope: "global" });
  });

  it("sem linha global, quem le tudo fica sem alvo — nao herda a meta da equipe", () => {
    expect(
      pickSalesGoal([equipe], { profileId: "soc", ledTeamIds: ["t1"], roles: ["partner"] }),
    ).toEqual({ target: null, scope: "global" });
  });

  it("sem meta propria, vale a da equipe que o usuario LIDERA", () => {
    expect(
      pickSalesGoal([global, equipe], { profileId: "u2", ledTeamIds: ["t1"], roles: ["manager"] }),
    ).toEqual({ target: 6, scope: "team" });
  });

  it("meta de equipe que ele nao lidera nao serve de denominador", () => {
    expect(
      pickSalesGoal([equipe], { profileId: "u3", ledTeamIds: [], roles: ["broker"] }),
    ).toEqual({ target: null, scope: "profile" });
  });

  it("quem lidera mais de uma equipe soma os alvos — o numerador junta as duas", () => {
    const outra: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t2", target: 4 };
    expect(
      pickSalesGoal([equipe, outra], {
        profileId: "u2",
        ledTeamIds: ["t1", "t2"],
        roles: ["manager"],
      }),
    ).toEqual({ target: 10, scope: "team" });
  });

  it("a meta da empresa so vale para quem le todos os negocios", () => {
    const ctx = { profileId: "u9", ledTeamIds: [] };
    expect(pickSalesGoal([global], { ...ctx, roles: ["admin"] })).toEqual({
      target: 14,
      scope: "global",
    });
    expect(pickSalesGoal([global], { ...ctx, roles: ["partner"] })).toEqual({
      target: 14,
      scope: "global",
    });
    // O corretor ENXERGA a linha global (a `goals_select` libera), mas ela nao e
    // dele: com 3 vendas contra 14 da empresa, o card dizia "Abaixo da meta".
    expect(pickSalesGoal([global], { ...ctx, roles: ["broker"] })).toEqual({
      target: null,
      scope: "profile",
    });
  });

  it("sem linha nenhuma devolve null com o escopo que o usuario teria", () => {
    expect(pickSalesGoal([], { profileId: "u1", ledTeamIds: [], roles: ["broker"] })).toEqual({
      target: null,
      scope: "profile",
    });
    expect(pickSalesGoal([], { profileId: "u2", ledTeamIds: ["t1"], roles: ["manager"] })).toEqual({
      target: null,
      scope: "team",
    });
    expect(pickSalesGoal([], { profileId: "u3", ledTeamIds: [], roles: ["admin"] })).toEqual({
      target: null,
      scope: "global",
    });
  });
});

describe("withZeroSellers — ranking com quem não vendeu", () => {
  const vendidos = [{ id: "b1", name: "Diego", vendas: 2, vgv: 500_000 }];

  it("ativos do papel entram zerados, depois de quem vendeu e em ordem alfabética", () => {
    const people = [
      pessoa("b3", "Zeca"),
      pessoa("b2", "Ávila"),
      pessoa("b1", "Diego"),
      pessoa("m1", "Marcos", { roles: ["manager", "broker"], role: "manager" }),
    ];
    expect(withZeroSellers(vendidos, people, "broker").map((row) => [row.name, row.vendas])).toEqual([
      ["Diego", 2], ["Ávila", 0], ["Zeca", 0],
    ]);
  });

  it("inativo só aparece se vendeu no período", () => {
    const people = [pessoa("b1", "Diego", { active: false }), pessoa("b9", "Inativo", { active: false })];
    expect(withZeroSellers(vendidos, people, "broker").map((row) => row.id)).toEqual(["b1"]);
  });

  it("gestor zerado só entra se lidera equipe de fato", () => {
    const people = [
      pessoa("b1", "Diego", { manager_id: "m1" }),
      pessoa("m1", "Marcos", { roles: ["manager", "broker"], role: "manager" }),
      pessoa("d1", "Dora", { roles: ["director", "manager", "broker"], role: "director" }),
    ];
    expect(withZeroSellers([], people, "manager").map((row) => row.id)).toEqual(["m1"]);
  });
});
