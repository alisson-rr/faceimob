import { describe, expect, it } from "vitest";
import {
  dashboardScope,
  dealCategory,
  defaultMonthOf,
  funnelRows,
  leadsInMonth,
  monthOptions,
  monthView,
  monthlySeries,
  participantsOf,
  perdaIds,
  pickSalesGoal,
  rankBy,
  vazioTotal,
  type DashboardScope,
  type DealRow,
} from "./data";
import { currentMonthBase } from "@/lib/dealStatus";
import type { Lead } from "@/types/crm";
import type { MonthlyGoalRow } from "@/integrations/supabase/newSchema";

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

  it("o total do funil por etapa é o mesmo do cartão 'Negócios'", () => {
    const { stats, stageCounts } = monthView(homologacao, "08/2026");
    const noFunil = [...stageCounts.values()].reduce((total, value) => total + value, 0);
    // Era 22 no cartão e 25 no bloco, lado a lado, sem nada avisar.
    expect(noFunil).toBe(stats.negocios);
  });

  it("o bloco COMPOSTO fecha com o KPI mesmo com etapa fora do catálogo ativo", () => {
    // A conta acima somava o `stageCounts` cru, que é a mesma fonte do KPI: ela
    // não podia falhar. O que a tela mostra é `funnelRows(etapas, stageCounts)`,
    // e as etapas vêm de `listPipelineStages()`, que filtra `active = true`.
    // Com um negócio aberto numa etapa desativada o bloco somava 22 sob um KPI
    // de 25 — a mesma divergência, por outro caminho.
    // `visit_scheduled` desativada em `pipeline_stages` — desativar etapa é
    // caminho previsto: `pipeline_stages_position_idx` é índice parcial
    // `where active`, e `pipeline_stages_write` libera `is_admin()`.
    const comDesativada = [
      ...homologacao,
      deal({ id: "arquivada1", stage: "visit_scheduled" }),
      deal({ id: "arquivada2", stage: "visit_scheduled" }),
    ];
    const { stats, stageCounts } = monthView(comDesativada, "08/2026");
    const catalogoAtivo = [
      { id: "1", code: "proposal", label: "Proposta", position: 2 },
      { id: "2", code: "closed", label: "Fechado", position: 3 },
      { id: "3", code: "lost", label: "Perdido", position: 9 },
    ];
    const rows = funnelRows(catalogoAtivo, stageCounts);
    expect(rows.reduce((total, row) => total + row.value, 0)).toBe(stats.negocios);
    expect(rows).toContainEqual({ label: "visit_scheduled · etapa fora do catálogo", value: 2 });
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

describe("monthOptions e defaultMonthOf — o filtro de período", () => {
  const rows = [venda({ id: "a", month_base: "08/2026" }), venda({ id: "b", month_base: "07/2026" })];

  it("o mês corrente entra na lista mesmo sem negócio", () => {
    // A meta de 09/2026 estava gravada e 09/2026 não aparecia no filtro, porque
    // não havia negócio no mês: quem cadastrava a meta não conseguia vê-la.
    expect(monthOptions(rows, "09/2026")).toEqual(["09/2026", "08/2026", "07/2026"]);
  });

  it("mas não muda o mês que abre por padrão", () => {
    // Senão o painel abriria vazio todo dia 1º.
    expect(defaultMonthOf(rows, [])).toBe("08/2026");
    expect(defaultMonthOf(rows, ["08/2026"])).toBe("07/2026");
  });

  it("com todos os meses fechados, cai no mês com negócio mais recente", () => {
    expect(defaultMonthOf(rows, ["08/2026", "07/2026"])).toBe("08/2026");
  });

  it("sem negócio nenhum, o padrão é o mês corrente", () => {
    expect(defaultMonthOf([], [])).toBe(currentMonthBase());
    expect(monthOptions([], "09/2026")).toEqual(["09/2026"]);
  });
});

describe("funnelRows — as etapas saem do banco", () => {
  const stages = [
    { id: "1", code: "lead", label: "Lead", position: 2 },
    { id: "2", code: "proposal", label: "Proposta", position: 3 },
    { id: "3", code: "lost", label: "Perdido", position: 9 },
  ];

  it("mantém a ordem e a etapa vazia, e tira o desfecho 'lost'", () => {
    const counts = new Map([["proposal", 4]]);
    expect(funnelRows(stages, counts)).toEqual([
      { label: "Lead", value: 0 },
      { label: "Proposta", value: 4 },
    ]);
  });

  it("etapa nova no banco aparece sozinha, sem tocar no frontend", () => {
    const comNova = [...stages, { id: "4", code: "reserva", label: "Reserva", position: 4 }];
    expect(funnelRows(comNova, new Map([["reserva", 2]]))).toContainEqual({ label: "Reserva", value: 2 });
  });

  it("negócio em etapa DESATIVADA vira linha própria, em vez de sumir do total", () => {
    // `listPipelineStages()` filtra `active = true`; `listLegacyDeals` lê o
    // catálogo SEM esse filtro. Sem a linha órfã o total do bloco ficava abaixo
    // do KPI "Negócios" na mesma tela — e nada dizia por quê.
    const rows = funnelRows(stages, new Map([["proposal", 4], ["reserva-2024", 3]]));
    expect(rows).toContainEqual({ label: "reserva-2024 · etapa fora do catálogo", value: 3 });
    expect(rows.reduce((total, row) => total + row.value, 0)).toBe(7);
  });

  it("etapa órfã com zero não polui a lista, e 'lost' continua fora", () => {
    const rows = funnelRows(stages, new Map([["reserva-2024", 0], ["lost", 5]]));
    expect(rows).toEqual([
      { label: "Lead", value: 0 },
      { label: "Proposta", value: 0 },
    ]);
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

  it("gerente e diretor ficam com o valor cheio — o share_pct deles e 0 no banco", () => {
    expect(rankBy([meioAMeio], "manager")).toEqual([
      { id: "m1", name: "Marcos", vendas: 1, vgv: 600_000 },
    ]);
    expect(rankBy([meioAMeio], "director")).toEqual([
      { id: "dir1", name: "Daniela", vendas: 1, vgv: 600_000 },
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

  it("diretor le TODOS os negocios, mas nao todos os perfis", () => {
    // `deals_select` -> `can_see_deal` -> `can_read_all()` inclui director;
    // `auth_visible_profiles()` devolve so a subarvore dele. Sao coisas
    // diferentes, e a regua mostra as duas lado a lado.
    const dir = comFila(["director"]);
    expect(dir.readsAllDeals).toBe(true);
    expect(dir.seesEveryone).toBe(false);
    expect(dir.isDirector).toBe(true);
    expect(dir.canManageGoal).toBe(true);
    expect(dir.dealsLabel).toBe("toda a operação");
    expect(dir.leadsLabel).toContain("sua carteira");
  });

  it("socio le tudo, cadastra nada e tem a base de leads MENOR que a real", () => {
    // `role_permissions` nao da `leads.view_queue` a partner, e a
    // `leads_select` so libera lead sem dono a quem tem a permissao: 69 de 74
    // na homologacao, sob um rotulo que dizia "total na base".
    const socio = semFila(["partner"]);
    expect(socio).toMatchObject({ readsAllDeals: true, seesEveryone: true, canManageGoal: false });
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
      expect(escopo.dealsLabel).toBe("os negócios em que você entra");
    }
  });

  it("o CCA ve a esteira inteira sem ler os negocios da empresa", () => {
    expect(comFila(["cca"])).toMatchObject({ seesAllCca: true, readsAllDeals: false });
  });

  it("diretor que tambem e corretor continua diretor (papel e N:N)", () => {
    const dual = comFila(["director", "broker"]);
    expect(dual.isDirector).toBe(true);
    expect(dual.readsAllDeals).toBe(true);
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

  it("socio e diretor leem toda a empresa, mas nao toda a base de leads", () => {
    // Socio: `role_permissions` nao lhe da `leads.view_queue` e a
    // `leads_select` esconde dele o lead sem dono. Diretor: tem a permissao,
    // mas `auth_visible_profiles()` o prende na propria subarvore. Nos dois
    // casos, "a base esta vazia" com a fila cheia manda procurar defeito onde
    // ha recorte — e "nada esta atribuido a voce" nega o `can_read_all()` que
    // ele tem.
    for (const escopo of [socio, diretor]) {
      const saida = texto(escopo);
      expect(saida.title).toBe("Nenhum negócio cadastrado ainda");
      expect(saida.description).toContain("menor que a base da operação");
      expect(saida.description).not.toContain("atribuído a você");
    }
  });

  it("ao corretor, o vazio continua sendo o dele", () => {
    expect(texto(corretor).title).toBe("Você ainda não tem lead nem negócio");
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

  it("quem le TODOS os negocios cai na meta global — inclusive o diretor", () => {
    // `deals_select` -> `can_see_deal(id)` -> `can_read_all()` =
    // has_any_role('admin','director','partner'). O diretor le o negocio de
    // TODA a empresa, mesmo enxergando so a propria subarvore de perfis: com o
    // escopo saindo de `auth_visible_profiles()` ele comparava as vendas da
    // empresa inteira com a soma das metas das equipes que lidera, sob o rotulo
    // "meta da equipe". Medido na homologacao: Paulista(6) + Sul(5) = 11.
    const paulista: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t1", target: 6 };
    const sul: MonthlyGoalRow = { scope: "team", profile_id: null, team_id: "t2", target: 5 };
    expect(
      pickSalesGoal([global, paulista, sul], {
        profileId: "dir",
        ledTeamIds: ["t1", "t2"],
        roles: ["director"],
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
      pickSalesGoal([equipe], { profileId: "dir", ledTeamIds: ["t1"], roles: ["director"] }),
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
