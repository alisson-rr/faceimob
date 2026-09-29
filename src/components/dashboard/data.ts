/**
 * Dados do Dashboard: uma consulta por assunto, com chave estavel, e as
 * derivacoes puras que as telas consomem.
 *
 * Tudo que a tela carrega passa por `useQuery`. O padrao antigo era
 * `useEffect` + `useState` para escolher o mes, e ele tinha corrida: o efeito
 * escrevia o mes depois da primeira pintura, entao o filtro piscava "Todos" e
 * so depois assumia o mes aberto. Aqui o mes padrao e DERIVADO na renderizacao
 * (`defaultMonth`) — nao ha estado para dessincronizar.
 *
 * As derivacoes sao funcoes PURAS exportadas (`monthView`, `monthlySeries`,
 * `monthOptions`, `directorPipeline` em `directorData.ts`). Os hooks sao so o
 * `useMemo` em volta delas: e o que permite testar a conta sem montar React.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dealsQuery } from "@/components/pipeline/data";
import { format, parseISO } from "date-fns";
import {
  compareMonth,
  contaComoVenda,
  currentMonthBase,
  isLossStatus,
  normalizeStatus,
} from "@/lib/dealStatus";
import { developerColor, type ChartToken } from "@/lib/tone";
import { useAuth } from "@/contexts/AuthContext";
import { listPipelineStages } from "@/integrations/supabase/permissions";
import type { Lead } from "@/types/crm";
import {
  displayMonthToIso,
  listLegacyLeads,
  loadDashboardPayload,
  loadMonthlyGoals,
  type DashboardPayload,
  type LegacyDealRecord,
  type MonthlyGoalRow,
  type PersonRecord,
} from "@/integrations/supabase/newSchema";

export const ALL_MONTHS = "all";

export type DealRow = LegacyDealRecord & { month_base: string };

export type MonthStats = {
  vendas: number;
  propostas: number;
  negocios: number;
  perdas: number;
  vgv: number;
};

export type DeveloperStats = {
  dev: string;
  vendas: number;
  propostas: number;
  negocios: number;
  vgv: number;
  propostaVgv: number;
  token: ChartToken;
};

export type RankRow = { id: string; name: string; vendas: number; vgv: number };

export type MonthlySeries = { rows: Record<string, string | number>[]; years: string[] };

/** "08/2026" → "07/2026". Vira o ano sozinho; e o comparativo do delta dos KPIs. */
export const previousMonth = (month: string): string | null => {
  const match = /^(\d{2})\/(\d{4})$/.exec(month);
  if (!match) return null;
  const monthIndex = Number(match[1]);
  const year = Number(match[2]);
  return monthIndex === 1
    ? `12/${year - 1}`
    : `${String(monthIndex - 1).padStart(2, "0")}/${year}`;
};

/** Meses com negocio, do mais novo para o mais antigo. */
const monthsWithDealsOf = (deals: DealRow[]): string[] =>
  Array.from(new Set(deals.map((deal) => deal.month_base))).sort((a, b) => compareMonth(b, a));

/**
 * Os meses do filtro de periodo.
 *
 * Alem dos meses COM negocio entra sempre o mes corrente: a meta do mes e
 * cadastrada em /equipes pelo calendario (`GlobalGoalCard` abre em `yyyy-MM`), e
 * enquanto a lista saia so dos negocios o mes recem-cadastrado nao aparecia aqui
 * — quem gravava a meta de 09/2026 nao tinha como abri-la no painel. Medido na
 * homologacao em 02/09/2026: meta de 14 vendas para 09/2026, zero negocio no mes.
 */
export const monthOptions = (deals: DealRow[], hoje: string = currentMonthBase()): string[] => {
  const seen = new Set(monthsWithDealsOf(deals));
  seen.add(hoje);
  return Array.from(seen).sort((a, b) => compareMonth(b, a));
};

/**
 * Carga unica do painel: negocios, leads por canal, CCA, staff e meses
 * fechados. `loadDashboardPayload` ja resolve tudo em paralelo no Supabase.
 */
export function useDashboardPayload() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ["dashboard", "payload", profileId];

  const query = useQuery({
    // O usuario entra na chave porque o payload sai recortado pela RLS: sem
    // isso a segunda conta a entrar no mesmo navegador (troca de sessao) lia o
    // cache da primeira — negocio de outra equipe pintado como se fosse dela.
    queryKey,
    // Os negocios saem do MESMO cache do Pipeline e da esteira (`dealsQuery`,
    // tambem por perfil): voltar do Pipeline nao baixa a base de novo. O
    // "Recarregar o painel" invalida o prefixo "dashboard" — ai o cache dos
    // negocios nao serve e a lista e relida, como antes.
    queryFn: () => {
      const recarregando = queryClient.getQueryState(queryKey)?.isInvalidated;
      return loadDashboardPayload(() =>
        queryClient.fetchQuery({ ...dealsQuery(profileId), ...(recarregando ? { staleTime: 0 } : {}) }));
    },
    enabled: !!profileId,
  });

  const payload: DashboardPayload | undefined = query.data;

  // Negocio sem `month_base` cai no mes de criacao — senao ele some de todo
  // filtro de periodo e o total do mes nunca fecha com o total geral.
  const deals = useMemo<DealRow[]>(
    () =>
      (payload?.deals ?? []).map((deal) => ({
        ...deal,
        month_base: deal.month_base || format(parseISO(deal.created_at), "MM/yyyy"),
      })),
    [payload?.deals],
  );

  const closedMonths = useMemo(() => payload?.closedMonths ?? [], [payload?.closedMonths]);
  // O painel abre SEMPRE no mes corrente (pedido do dono, 17/09/2026). Antes
  // abria no mes aberto mais recente com negocio, e um unico negocio com
  // mes-base 02/2027 levava todo mundo para 02/2027. Consequencia aceita: no
  // dia 1º o painel abre no mes novo, possivelmente vazio — o `monthOptions`
  // rotula esse mes como "sem negocio".
  const defaultMonth = currentMonthBase();
  // O MESMO mes alimenta a lista: `months` so recalcula quando `deals` muda, e
  // `deals` fica identico por horas (o TanStack devolve a mesma referencia). Com
  // aba aberta na virada do mes, o padrao virava o mes novo e a lista continuava
  // sem ele — o seletor ficava sem rotulo. Aqui os dois viram no mesmo render.
  const months = useMemo(() => monthOptions(deals, defaultMonth), [deals, defaultMonth]);
  const monthsWithDeals = useMemo(() => new Set(monthsWithDealsOf(deals)), [deals]);

  return { query, deals, months, monthsWithDeals, closedMonths, defaultMonth, payload };
}

export type GoalScope = "profile" | "team" | "global";
export type GoalMetric = "sales" | "vgv";

/** O escopo escrito, para o titulo e para o `aria-label` do medidor. */
export const GOAL_SCOPE_LABEL: Record<GoalScope, string> = {
  profile: "sua meta",
  team: "meta da equipe",
  global: "meta da empresa",
};

export type SalesGoal = { target: number | null; scope: GoalScope };

/**
 * Quem le o negocio de TODA a empresa — o espelho de `can_read_all()`, que desde
 * a 0141 e `is_admin()`: administrador e socio. A `deals_select` alcanca por
 * `can_see_deal(id)`.
 *
 * O diretor saiu na 0141 (regra do dono, 12/09/2026): ele le os negocios da
 * PROPRIA hierarquia, pelo mesmo `auth_visible_profiles()` que recorta os leads.
 * Deixar o diretor aqui prometia na tela "toda a operação" e a meta global sobre
 * um realizado que o banco ja nao entrega a ele.
 */
export const readsAllDeals = (roles: string[]) =>
  roles.includes("admin") || roles.includes("partner");

export type DashboardScope = {
  /** `can_read_all()` — o negocio de toda a empresa. */
  readsAllDeals: boolean;
  /** `auth_visible_profiles()` devolve TODO mundo (composicao do time). */
  seesEveryone: boolean;
  /**
   * O numero de LEADS da tela e mesmo a base inteira.
   *
   * NAO e `seesEveryone`: enxergar todo PERFIL nao e enxergar todo LEAD. O
   * socio passa em `auth_visible_profiles()` e mesmo assim a `leads_select` so
   * libera lead sem dono a quem tem `leads.view_queue` — permissao que
   * `role_permissions` nao da a ele. Quem lia `seesEveryone` aqui escrevia "A
   * base tem 69 leads" para uma base de 74.
   */
  leadsIsWholeBase: boolean;
  /** `cca_cases_select` — a esteira inteira, nao so a dos proprios negocios. */
  seesAllCca: boolean;
  /** Tem a aba Diretoria. */
  isDirector: boolean;
  /** `goals_write` — pode cadastrar a meta que falta. */
  canManageGoal: boolean;
  /** De quem sao os NEGOCIOS que a regua soma. */
  dealsLabel: string;
  /** De quem sao os LEADS que a regua soma — quase nunca o mesmo recorte. */
  leadsLabel: string;
};

/**
 * O recorte da tela por papel, numa funcao pura — porque cada regra dessas e um
 * espelho de uma policy do banco, e espelho sem teste racha calado.
 *
 * Os rotulos existem porque a mesma regua pode mostrar recortes DIFERENTES lado
 * a lado: `deals_select` chega em `can_read_all()` (admin e socio leem a empresa
 * inteira), enquanto `leads_select` recorta por `auth_visible_profiles()` e pela
 * fila. Ate a 0141 o diretor via 35 negocios da empresa ao lado de 58 leads da
 * propria subarvore, sem nada dizendo que os dois numeros nao falavam do mesmo
 * conjunto.
 *
 * O socio e o caso extremo: ele enxerga todo perfil, mas `role_permissions` nao
 * da `leads.view_queue` a ele, e a `leads_select` so libera lead sem dono a quem
 * tem essa permissao — a base dele fica MENOR que a real (69 de 74 medidos na
 * homologacao) sob um rotulo que dizia "total na base".
 */
export const dashboardScope = (roles: string[], canViewQueue: boolean): DashboardScope => {
  const todosOsNegocios = readsAllDeals(roles);
  const seesEveryone = roles.includes("admin") || roles.includes("partner");
  return {
    readsAllDeals: todosOsNegocios,
    seesEveryone,
    leadsIsWholeBase: seesEveryone && canViewQueue,
    seesAllCca: roles.includes("cca") || todosOsNegocios,
    isDirector: roles.includes("director"),
    // `goals_write` (0061) e um `or` com `is_admin()`, que desde a 0097 responde
    // sim para o socio — administrador e socio tem o mesmo nivel de permissao.
    canManageGoal: seesEveryone || roles.includes("director"),
    // `auth_visible_deal_ids()`: os negocios em que ele ou alguem da hierarquia
    // dele participa — "em que você entra" negava ao gestor a equipe que ele ve.
    dealsLabel: todosOsNegocios ? "toda a operação" : "os negócios da sua carteira e das equipes que você lidera",
    leadsLabel: seesEveryone
      ? canViewQueue
        ? "toda a base"
        : "leads já atribuídos — a fila sem dono não entra no seu acesso"
      : "os leads da sua carteira e das equipes que você lidera",
  };
};

/**
 * O texto do painel vazio, por recorte de quem esta olhando.
 *
 * Tres casos, nao dois, porque NEGOCIO e LEAD nao tem o mesmo recorte no banco
 * e o painel so aparece vazio quando os dois zeram ao mesmo tempo:
 *
 * - `leadsIsWholeBase` (admin): le todo negocio e todo lead — so ele pode
 *   afirmar que a base da operacao esta vazia.
 * - `readsAllDeals` sem a base de leads inteira (socio sem a fila): o zero de
 *   NEGOCIO fala da empresa, o de LEAD fala do recorte dele. Dizer "a base esta
 *   vazia" com a fila cheia manda procurar defeito onde ha recorte — e dizer
 *   "nada esta atribuido a voce" nega a leitura da empresa que ele tem.
 * - o resto (corretor, gerente, diretor desde a 0141): o vazio e o da carteira
 *   e da hierarquia dele, nos dois eixos.
 */
export const vazioTotal = (
  readsAllDeals: boolean,
  leadsIsWholeBase: boolean,
): { title: string; description: string } => {
  if (leadsIsWholeBase)
    return {
      title: "A base ainda está vazia",
      description:
        "Não há negócio nem lead cadastrado. Assim que o primeiro entrar — pela roleta ou pelo pipeline — os indicadores aparecem aqui.",
    };
  if (readsAllDeals)
    return {
      title: "Nenhum negócio cadastrado ainda",
      description:
        "Também não há lead no seu acesso, e o seu recorte de leads é menor que a base da operação — pode haver lead que o seu perfil não enxerga. Assim que um negócio entrar pelo pipeline, os indicadores aparecem aqui.",
    };
  return {
    title: "Você ainda não tem lead nem negócio",
    description:
      "Nenhum negócio ou lead está atribuído a você. Assim que a roleta distribuir o primeiro lead, os indicadores deste painel aparecem aqui.",
  };
};

/**
 * Qual linha de `goals` e o denominador do usuario.
 *
 * A regra e uma so: **o alvo vem do mesmo recorte do realizado.** Quem le todos
 * os negocios (`can_read_all()`) tem um unico denominador coerente, o global —
 * por isso ele e testado ANTES do proprio perfil e da equipe. Um admin com linha
 * `scope='profile'` cadastrada comparava a meta pessoal dele com as vendas da
 * empresa inteira. O diretor, desde a 0141, le so a propria hierarquia — e cai
 * na regra de baixo, com a meta das equipes que lidera.
 *
 * Para quem NAO le tudo, a ordem e a de sempre: meta do proprio perfil > meta
 * das equipes que ele lidera. Sem linha casando, devolve `target: null` com o
 * escopo que o usuario TERIA — o estado vazio precisa dizer qual meta falta.
 *
 * Quem lidera mais de uma equipe soma os alvos: o numerador ja junta as duas.
 */
export function pickSalesGoal(
  rows: MonthlyGoalRow[],
  ctx: { profileId: string | null; ledTeamIds: string[]; roles: string[] },
): SalesGoal {
  if (readsAllDeals(ctx.roles)) {
    const global = rows.find((row) => row.scope === "global");
    return { target: global ? global.target : null, scope: "global" };
  }

  const own = rows.find((row) => row.scope === "profile" && row.profile_id === ctx.profileId);
  if (own) return { target: own.target, scope: "profile" };

  const led = rows.filter(
    (row) => row.scope === "team" && row.team_id && ctx.ledTeamIds.includes(row.team_id),
  );
  if (led.length) return { target: led.reduce((total, row) => total + row.target, 0), scope: "team" };

  return { target: null, scope: ctx.ledTeamIds.length ? "team" : "profile" };
}

/**
 * Meta do mes no escopo do usuario logado, por metrica (`goals`).
 *
 * O prefixo da chave continua sendo `["dashboard", "sales-goal"]` para as DUAS
 * metricas de proposito: e esse prefixo que o `GlobalGoalCard` de /equipes
 * invalida depois de salvar, e uma chave nova para 'vgv' deixaria o painel
 * servindo o alvo velho por ate 60 s (o `staleTime` do App) sem ninguem
 * perceber. A metrica entra no elemento seguinte, que a invalidacao por prefixo
 * alcanca.
 */
export function useGoal(metric: GoalMetric, activeMonth: string) {
  const { user, roles } = useAuth();
  const profileId = user?.id ?? null;

  return useQuery({
    // O usuario entra na chave: dois papeis diferentes no mesmo navegador
    // (troca de sessao, previsualizacao de papel) leem metas diferentes.
    queryKey: ["dashboard", "sales-goal", metric, activeMonth, profileId, roles.join(",")],
    enabled: activeMonth !== ALL_MONTHS && !!profileId,
    queryFn: async (): Promise<SalesGoal> => {
      const { rows, ledTeamIds } = await loadMonthlyGoals(
        metric,
        displayMonthToIso(activeMonth),
        profileId as string,
      );
      return pickSalesGoal(rows, { profileId, ledTeamIds, roles: roles });
    },
  });
}

/** Meta de vendas do mes (contagem) — o denominador do `GoalCard`. */
export const useSalesGoal = (activeMonth: string) => useGoal("sales", activeMonth);

/** Meta de VGV do mes (R$) — o alvo do cartao de VGV, gravado no mesmo cartao
 *  de /equipes que grava a de vendas e que ate agora nada lia. */
export const useVgvGoal = (activeMonth: string) => useGoal("vgv", activeMonth);

/**
 * Lista completa de leads — o painel de Leads precisa das linhas, e o KPI de
 * leads precisa da DATA de cada um para respeitar o filtro de periodo (o
 * payload devolve so a contagem total da base).
 */
export function useDashboardLeads() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  return useQuery({
    // Mesmo motivo do payload: `leads_select` recorta por usuario.
    queryKey: ["dashboard", "leads", profileId],
    queryFn: listLegacyLeads,
    enabled: !!profileId,
  });
}

/** Os leads criados no mes selecionado. "Todos os meses" nao filtra nada. */
export const leadsInMonth = (leads: Lead[], month: string): Lead[] =>
  month === ALL_MONTHS
    ? leads
    : leads.filter((lead) => format(new Date(lead.created_at), "MM/yyyy") === month);

/** Catalogo de etapas do banco (`pipeline_stages`) — a fonte unica do funil. */
export function useFunnelStages() {
  return useQuery({
    queryKey: ["dashboard", "stages"],
    queryFn: listPipelineStages,
    staleTime: 5 * 60_000,
  });
}

export type DealCategory = "venda" | "producao" | "perda" | "fora";

/**
 * Encerra o negocio mas NAO entra na conta de perdas.
 *
 * Mesma distincao de `@/lib/dealStatus`: "19. REPROVADO" e "OFF" tiram o
 * negocio do funil sem virar perda no relatorio. `normalizeStatus` devolve
 * "OFF" para o primeiro e `null` para "19. REPROVADO" (que so `isLossStatus`
 * reconhece) — dai a pergunta em duas partes.
 */
const encerraSemPerda = (status: string | null | undefined): boolean => {
  const normalizado = normalizeStatus(status);
  return normalizado === "OFF" || (normalizado === null && isLossStatus(status));
};

/**
 * A categoria do negocio no relatorio. **`outcome` manda.**
 *
 * `deals.status_detail` guarda o "Status 2", um vocabulario de 32 rotulos
 * digitados na operacao ("13. ESTEIRA AGIL", "03. ASSINADO"). Enquanto a
 * categoria saia dele, `normalizeStatus` devolvia `null` para 27 dos 32 e o
 * negocio sumia de TODOS os indicadores: em 08/2026, na homologacao, tres
 * negocios com "13. ESTEIRA AGIL" faziam o cartao "Negocios" dizer 22 e o bloco
 * "Negocios por etapa" dizer 25, na mesma tela.
 *
 * `deals.outcome` e mantido pelo proprio banco (`deals_guard_stage` copia o
 * `outcome` da etapa de destino), entao ele nao depende de ninguem digitar
 * certo. O Status 2 sobra para o que ele e: detalhe operacional — e para a
 * unica distincao que o outcome nao carrega, DISTRATO x QUEDA.
 *
 * Decisao de 02/09/2026 (recomendacao do inventario).
 */
export const dealCategory = (deal: Pick<DealRow, "outcome" | "status" | "status_group_code">): DealCategory => {
  // Fechado ou Status 1 VENDA (Em contrato…): a regra única de `contaComoVenda`.
  if (contaComoVenda(deal)) return "venda";
  if (deal.outcome === "open") return "producao";
  if (deal.outcome === "lost") return encerraSemPerda(deal.status) ? "fora" : "perda";
  return "fora"; // 'cancelled' nao e perda: e negocio que deixou de existir.
};

/** Negocio que ainda esta na esteira ou ja fechou — o mesmo conjunto de `active`. */
export const noFunil = (deal: DealRow) => {
  const categoria = dealCategory(deal);
  return categoria === "venda" || categoria === "producao";
};

/**
 * Os negocios que contam como PERDA, ja resolvido o caso do distrato.
 *
 * DISTRATO conta como perda no mes em que aconteceu, mas so quando existe uma
 * venda ANTERIOR do mesmo cliente — um "distrato" lancado no mesmo mes da venda
 * e correcao de digitacao, nao perda.
 */
export const perdaIds = (deals: DealRow[]): Set<string> => {
  const vendasPorCliente = new Map<string, string[]>();
  for (const deal of deals) {
    if (dealCategory(deal) !== "venda" || !deal.client) continue;
    const meses = vendasPorCliente.get(deal.client) ?? [];
    meses.push(deal.month_base);
    vendasPorCliente.set(deal.client, meses);
  }

  const ids = new Set<string>();
  for (const deal of deals) {
    if (dealCategory(deal) !== "perda") continue;
    if (normalizeStatus(deal.status) === "DISTRATO") {
      const vendas = vendasPorCliente.get(deal.client) ?? [];
      if (!vendas.some((mes) => compareMonth(mes, deal.month_base) < 0)) continue;
    }
    ids.add(deal.id);
  }
  return ids;
};

const statsOf = (rows: DealRow[], perdas: Set<string>): MonthStats => {
  const vendas = rows.filter((deal) => dealCategory(deal) === "venda");
  const propostas = rows.filter((deal) => dealCategory(deal) === "producao").length;
  return {
    vendas: vendas.length,
    propostas,
    negocios: vendas.length + propostas,
    perdas: rows.filter((deal) => perdas.has(deal.id)).length,
    vgv: vendas.reduce((total, deal) => total + (deal.deal_value || 0), 0),
  };
};

export type RankRole = "broker" | "manager" | "director";

/**
 * Os participantes do papel que a linha carrega, na ordem dos slots.
 *
 * `name` vem `null` so quando o slot nao tem participante nenhum. O nome sai da
 * RPC `deal_participant_names()`, que e SECURITY DEFINER e libera a linha
 * inteira do negocio visivel (`can_see_deal(deal_id)`) — o corretor LE o nome do
 * coparticipante de outra equipe mesmo com `profiles_select` escondendo o
 * cadastro dele. Decisao de 02/09/2026: fica assim, porque o nome de quem
 * divide o SEU negocio e informacao operacional, nao curiosidade sobre o
 * organograma alheio. Quem chama nao precisa mais tratar anonimo.
 */
export const participantsOf = (
  deal: LegacyDealRecord,
  role: RankRole,
): { id: string; name: string | null }[] => {
  const slots: [string | null | undefined, string | null | undefined][] =
    role === "broker"
      ? [
          [deal.broker1_id, deal.broker1_name ?? deal.broker1],
          [deal.broker2_id, deal.broker2_name ?? deal.broker2],
          [deal.broker3_id, deal.broker3],
        ]
      : role === "manager"
        ? [
            [deal.manager1_id, deal.manager1_name ?? deal.manager1],
            [deal.manager2_id, deal.manager2_name ?? deal.manager2],
            [deal.manager3_id, deal.manager3],
          ]
        : [
            [deal.director1_id, deal.director1_name],
            [deal.director2_id, deal.director2_name],
          ];
  return slots.flatMap(([id, name]) => (id ? [{ id, name: name || null }] : []));
};

/**
 * Ranking por papel (pedido de 29/09/2026), com o rateio do banco.
 *
 *   · corretor (e o ranking geral): só os negócios em que a pessoa é CORRETOR.
 *     A venda conta para cada corretor (a convenção de `deals_award_points`) e o
 *     VGV divide por quantos corretores o negócio tem — o `100/n` de
 *     `recalc_deal_shares`;
 *   · gerente: a soma dos corretores das equipes em que ele é `teams.manager_id`;
 *   · diretor: a soma dos corretores das equipes em que ele é `teams.director_id`.
 *
 * Gestor NÃO sai mais do slot de gerente/diretor do negócio, nem ganha o valor
 * cheio de todo negócio em que aparece: era isso que punha o diretor no ranking
 * de gerentes vencendo gerentes, e no geral esmagando o resultado individual.
 * Quem acumula papéis aparece em cada ranking com os números daquele papel.
 * Negócio com dois corretores da mesma equipe é UMA venda do gerente, com a
 * soma das duas fatias.
 *
 * A equipe é a ATUAL do corretor (`people`, recortado pela RLS de quem olha).
 * ponytail: corretor que troca de equipe leva o histórico para a equipe nova;
 * evoluir para a equipe da data do negócio quando `team_members` for lido com
 * `joined_at`/`left_at` no período.
 *
 * O `continue` do nome é guarda contra perfil sem `full_name`, não caminho de
 * rotina: `deal_participant_names()` é SECURITY DEFINER e sempre devolve o nome.
 */
export const rankBy = (rows: DealRow[], role: RankRole, people: PersonRecord[] = []): RankRow[] => {
  const map = new Map<string, RankRow & { deals?: Set<string> }>();
  const personById = new Map(people.map((person) => [person.id, person]));
  for (const deal of rows) {
    if (dealCategory(deal) !== "venda") continue;
    const brokers = participantsOf(deal, "broker");
    const share = (deal.deal_value || 0) / (brokers.length || 1);
    for (const broker of brokers) {
      let id: string | null = broker.id;
      let name = broker.name;
      if (role !== "broker") {
        const team = personById.get(broker.id);
        id = (role === "manager" ? team?.manager_id : team?.director_id) ?? null;
        name = id ? personById.get(id)?.name ?? null : null;
      }
      if (!id || !name) continue;
      const entry = map.get(id) ?? { id, name, vendas: 0, vgv: 0, deals: new Set<string>() };
      if (!entry.deals?.has(deal.id)) {
        entry.deals?.add(deal.id);
        entry.vendas += 1;
      }
      entry.vgv += share;
      map.set(id, entry);
    }
  }
  // Desempate final pelo NOME, como o banco faz ao congelar a temporada
  // (`close_game_season`: `order by r.points desc, r.full_name`) e como a
  // Gamificacao ja fazia na tela (`ordenarRanking`). Sem ele dois corretores do
  // mesmo negocio rateado — sempre empatados — trocavam de degrau a cada negocio
  // novo. `pt-BR` porque "Ana" tem de vir antes de "Ávila" e de "Bruno".
  return Array.from(map.values(), ({ id, name, vendas, vgv }) => ({ id, name, vendas, vgv }))
    .sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv || a.name.localeCompare(b.name, "pt-BR"));
};

/**
 * O ranking do período com quem não vendeu (pedido de 28/09/2026): entra zerado,
 * abaixo de quem vendeu, todo ATIVO do papel. Inativo só aparece se vendeu no
 * período — já está em `ranked`, que sai dos negócios — e some no mês seguinte.
 *
 * Do papel, pela mesma régua de `rankBy`: no de corretores, quem tem corretor
 * como papel PRINCIPAL (toda conta nova ganha `broker`, e o diretor zerado no
 * pé do ranking geral era ruído); no de gestores, quem lidera equipe de fato.
 * A ordem é a de `rankBy`: vendas, VGV e, entre zerados, o nome.
 */
export const withZeroSellers = (ranked: RankRow[], people: PersonRecord[], role: RankRole): RankRow[] => {
  const ranqueados = new Set(ranked.map((row) => row.id));
  const lideres = new Set(people.map((person) => (role === "manager" ? person.manager_id : person.director_id)));
  const doPapel = (person: PersonRecord) =>
    role === "broker" ? person.role === "broker" : person.roles.includes(role) && lideres.has(person.id);
  const zerados = people
    .filter((person) => person.active && !ranqueados.has(person.id) && doPapel(person))
    .map((person) => ({ id: person.id, name: person.name, vendas: 0, vgv: 0 }));
  return [...ranked, ...zerados]
    .sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv || a.name.localeCompare(b.name, "pt-BR"));
};

export type MonthView = ReturnType<typeof monthView>;

/**
 * Tudo que depende do mes selecionado, numa funcao pura.
 *
 * `previous` e o mesmo calculo no mes anterior — e dele que sai o delta dos
 * KPIs. Com "todos os meses" nao ha com o que comparar e o delta some.
 */
export function monthView(deals: DealRow[], activeMonth: string) {
  const perdas = perdaIds(deals);
  const inMonth = (month: string) =>
    month === ALL_MONTHS ? deals : deals.filter((deal) => deal.month_base === month);

  const rows = inMonth(activeMonth);
  const prevMonth = activeMonth === ALL_MONTHS ? null : previousMonth(activeMonth);
  const previous = prevMonth ? statsOf(inMonth(prevMonth), perdas) : null;

  // A lista de construtoras sai de TODOS os negocios: uma construtora sem
  // negocio no mes continua na grade, com zero, em vez de sumir — some-la
  // esconde a construtora que parou. Quem decide se ha o que mostrar e o bloco,
  // pelo TOTAL do periodo: `data.length` nunca zerava e o estado vazio nunca
  // disparava, entao um mes sem negocio pintava um grafico inteiro de zeros.
  // `sort()` sem comparador ordena por code unit: "Á" (U+00C1) cai DEPOIS de
  // "Z", entao toda construtora acentuada ia para o fim da grade e do grafico —
  // "ÁGUIA" depois de "ZAMBONI". `pt-BR` poe o acento no lugar da letra base.
  // A lista sai em CAIXA ALTA, entao caixa nao pesa aqui.
  const devNames = Array.from(
    new Set(deals.map((deal) => deal.developer.trim().toUpperCase()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const developers: DeveloperStats[] = devNames.map((dev) => {
    const devRows = rows.filter((deal) => deal.developer.trim().toUpperCase() === dev);
    const vendas = devRows.filter((deal) => dealCategory(deal) === "venda");
    const propostas = devRows.filter((deal) => dealCategory(deal) === "producao");
    return {
      dev,
      vendas: vendas.length,
      propostas: propostas.length,
      negocios: vendas.length + propostas.length,
      vgv: vendas.reduce((total, deal) => total + (deal.deal_value || 0), 0),
      propostaVgv: propostas.reduce((total, deal) => total + (deal.deal_value || 0), 0),
      token: developerColor(dev),
    };
  });

  return {
    rows,
    previousMonth: prevMonth,
    stats: statsOf(rows, perdas),
    previous,
    developers,
    brokers: rankBy(rows, "broker"),
  };
}

export const useMonthView = (deals: DealRow[], activeMonth: string) =>
  useMemo(() => monthView(deals, activeMonth), [deals, activeMonth]);

/** Vendas por mes do calendario, uma serie por ano — o comparativo anual. */
export function monthlySeries(deals: DealRow[]): MonthlySeries {
  const byMonth = new Map<string, Record<string, number>>();
  for (let month = 1; month <= 12; month += 1) byMonth.set(String(month).padStart(2, "0"), {});

  const years = new Set<string>();
  for (const deal of deals) {
    const [mm, yyyy] = deal.month_base.split("/");
    years.add(yyyy);
    if (dealCategory(deal) !== "venda") continue;
    const bucket = byMonth.get(mm);
    if (bucket) bucket[yyyy] = (bucket[yyyy] ?? 0) + 1;
  }

  return {
    rows: Array.from(byMonth, ([mes, counts]) => ({ mes, ...counts })),
    years: Array.from(years).sort(),
  };
}

export const useMonthlySeries = (deals: DealRow[]): MonthlySeries =>
  useMemo(() => monthlySeries(deals), [deals]);
