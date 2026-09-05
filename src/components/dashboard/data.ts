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
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  compareMonth,
  currentMonthBase,
  isLossStatus,
  normalizeStatus,
  pickOpenMonth,
} from "@/lib/dealStatus";
import { developerColor, type ChartToken } from "@/lib/tone";
import { useAuth } from "@/contexts/AuthContext";
import { listPipelineStages, type PipelineStageRecord } from "@/integrations/supabase/permissions";
import type { Lead } from "@/types/crm";
import {
  displayMonthToIso,
  listLegacyLeads,
  loadDashboardPayload,
  loadMonthlyGoals,
  type DashboardPayload,
  type LegacyDealRecord,
  type MonthlyGoalRow,
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
 * O mes que abre por padrao: o mes ABERTO mais recente **com negocio**.
 *
 * Sai dos meses com negocio, nao de `monthOptions`: incluir o mes corrente na
 * lista nao pode mudar o padrao de quem tem negocio no mes passado, senao o
 * painel abriria vazio todo dia 1º.
 */
export const defaultMonthOf = (deals: DealRow[], closedMonths: string[]): string => {
  const comNegocio = monthsWithDealsOf(deals);
  if (!comNegocio.length) return currentMonthBase();
  const preferido = pickOpenMonth(comNegocio, closedMonths);
  return comNegocio.includes(preferido) ? preferido : comNegocio[0];
};

/**
 * Carga unica do painel: negocios, leads por canal, CCA, staff e meses
 * fechados. `loadDashboardPayload` ja resolve tudo em paralelo no Supabase.
 */
export function useDashboardPayload() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;

  const query = useQuery({
    // O usuario entra na chave porque o payload sai recortado pela RLS: sem
    // isso a segunda conta a entrar no mesmo navegador (troca de sessao) lia o
    // cache da primeira — negocio de outra equipe pintado como se fosse dela.
    queryKey: ["dashboard", "payload", profileId],
    queryFn: loadDashboardPayload,
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
  const months = useMemo(() => monthOptions(deals), [deals]);
  const monthsWithDeals = useMemo(() => new Set(monthsWithDealsOf(deals)), [deals]);
  const defaultMonth = useMemo(() => defaultMonthOf(deals, closedMonths), [deals, closedMonths]);

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
 * Quem le o negocio de TODA a empresa — o espelho de `can_read_all()`
 * (`has_any_role('admin','director','partner')`), que a `deals_select` alcanca
 * por `can_see_deal(id)`.
 *
 * NAO e `auth_visible_profiles()`: o numerador do `GoalCard` e do KPI de VGV sai
 * de `deals`, nao de `profiles`. O diretor enxerga so a propria subarvore de
 * PERFIS e, ao mesmo tempo, todos os NEGOCIOS — `listLegacyDeals` nao filtra
 * nada no cliente. Trocar uma funcao pela outra aqui devolvia ao diretor a soma
 * das metas das equipes que ele lidera sob o realizado da empresa inteira.
 */
export const readsAllDeals = (roles: string[]) =>
  roles.includes("admin") || roles.includes("director") || roles.includes("partner");

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
 * Os rotulos existem porque a mesma regua mostra recortes DIFERENTES lado a
 * lado: `deals_select` chega em `can_read_all()` (admin, diretor, socio leem a
 * empresa inteira), enquanto `leads_select` recorta por
 * `auth_visible_profiles()` — o diretor via 35 negocios da empresa ao lado de
 * 58 leads da propria subarvore, sem nada dizendo que os dois numeros nao falam
 * do mesmo conjunto.
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
    canManageGoal: roles.includes("admin") || roles.includes("director"),
    dealsLabel: todosOsNegocios ? "toda a operação" : "os negócios em que você entra",
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
 * - `readsAllDeals` sem a base de leads inteira (socio, diretor): o zero de
 *   NEGOCIO fala da empresa, o de LEAD fala do recorte dele. O socio nao tem
 *   `leads.view_queue` e a `leads_select` esconde dele o lead sem dono; o
 *   diretor tem a permissao, mas `auth_visible_profiles()` o prende na propria
 *   subarvore. Dizer a qualquer um dos dois "a base esta vazia" com a fila cheia
 *   manda procurar defeito onde ha recorte — e dizer "nada esta atribuido a
 *   voce" nega a leitura da empresa que ele tem.
 * - o resto (corretor, gerente): o vazio e o dele, nos dois eixos.
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
 * empresa inteira; o diretor comparava a meta das equipes que lidera com as
 * vendas de todas as diretorias.
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
  const { user, roles, previewRole } = useAuth();
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const profileId = user?.id ?? null;

  return useQuery({
    // O usuario entra na chave: dois papeis diferentes no mesmo navegador
    // (troca de sessao, previsualizacao de papel) leem metas diferentes.
    queryKey: ["dashboard", "sales-goal", metric, activeMonth, profileId, effectiveRoles.join(",")],
    enabled: activeMonth !== ALL_MONTHS && !!profileId,
    queryFn: async (): Promise<SalesGoal> => {
      const { rows, ledTeamIds } = await loadMonthlyGoals(
        metric,
        displayMonthToIso(activeMonth),
        profileId as string,
      );
      return pickSalesGoal(rows, { profileId, ledTeamIds, roles: effectiveRoles });
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

/**
 * O funil por etapa, na ordem do BANCO.
 *
 * Etapa sem negocio continua na lista com zero: some-la esconde justamente o
 * gargalo. Fica de fora so a etapa de desfecho 'lost' — ela e resultado, nao
 * coluna de funil (a mesma decisao que `DEAL_STAGES` documenta em types/crm),
 * e nenhum negocio ativo pode estar nela.
 *
 * As DUAS listas nao vem da mesma consulta, e e por isso que o resto existe:
 * o catalogo aqui e `listPipelineStages()`, que filtra `active = true`, mas
 * `stageCounts` e chaveado pelo `deal.stage` de `listLegacyDeals`, que le
 * `pipeline_stages` SEM filtro de `active`. Desativar etapa e caminho previsto
 * (`pipeline_stages_position_idx` e indice parcial `where active`, e a
 * `pipeline_stages_write` libera `is_admin()`), e com negocio aberto numa etapa
 * desativada o KPI "Negocios" dizia 25 e este bloco dizia 22 — a divergencia que
 * a tela existe para nao ter. Por isso o codigo orfao vira linha propria, com o
 * proprio codigo por rotulo: melhor uma etapa sem nome bonito do que um total
 * que nao fecha.
 *
 * ponytail: o filtro e pelo `code`; evoluir para `pipeline_stages.outcome`
 * quando `listPipelineStages` passar a trazer a coluna — hoje ela nao vem.
 */
export const funnelRows = (
  stages: PipelineStageRecord[],
  stageCounts: Map<string, number>,
): { label: string; value: number }[] => {
  const noCatalogo = new Set(stages.map((stage) => stage.code));
  const rows = stages
    .filter((stage) => stage.code !== "lost")
    .map((stage) => ({ label: stage.label, value: stageCounts.get(stage.code) ?? 0 }));

  const orfas = [...stageCounts]
    .filter(([code, value]) => value > 0 && code !== "lost" && !noCatalogo.has(code))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, value]) => ({ label: `${code} · etapa fora do catálogo`, value }));

  return [...rows, ...orfas];
};

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
export const dealCategory = (deal: Pick<DealRow, "outcome" | "status">): DealCategory => {
  if (deal.outcome === "won") return "venda";
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
 * Ranking por participante, com o rateio do banco.
 *
 * Ler so `broker1_id` credita a venda e o VGV inteiros ao primeiro corretor e
 * some com o coparticipante — o mesmo negocio aparecia com valor diferente aqui
 * e na Gamificacao. A venda conta para CADA participante (a convencao do
 * trigger `deals_award_points`, que da um evento 'venda' por corretor) e o VGV
 * do corretor divide por quantos corretores o negocio tem, que e o `100/n` de
 * `recalc_deal_shares`. Gerente e diretor somam o valor cheio: o `share_pct`
 * deles e 0 no banco por definicao.
 *
 * O divisor conta TODOS os slots preenchidos, e o nome sempre chega: a RPC
 * `deal_participant_names()` e SECURITY DEFINER e nao passa por
 * `auth_visible_profiles()`. O `continue` abaixo e guarda contra perfil sem
 * `full_name`, nao caminho de rotina — o rodape que contava "N sem nome, fora
 * do seu alcance de visibilidade" descrevia um comportamento que o banco nao
 * tem, e saiu junto com `hiddenParticipants` em 02/09/2026.
 *
 * ponytail: o rateio e DERIVADO (100/n) porque `LegacyDealRecord` nao carrega
 * `share_pct`; evoluir para ler a coluna quando `deal_participants.share_pct`
 * puder ser editado a mao e deixar de ser 100/n.
 */
export const rankBy = (rows: DealRow[], role: RankRole): RankRow[] => {
  const map = new Map<string, RankRow>();
  for (const deal of rows) {
    if (dealCategory(deal) !== "venda") continue;
    const people = participantsOf(deal, role);
    if (!people.length) continue;
    const value = deal.deal_value || 0;
    const share = role === "broker" ? value / people.length : value;
    for (const person of people) {
      if (!person.name) continue;
      const entry = map.get(person.id) ?? { id: person.id, name: person.name, vendas: 0, vgv: 0 };
      entry.vendas += 1;
      entry.vgv += share;
      map.set(person.id, entry);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
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
  const devNames = Array.from(
    new Set(deals.map((deal) => deal.developer.trim().toUpperCase()).filter(Boolean)),
  ).sort();

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

  // Mesmo conjunto do KPI "Negocios" (venda + producao), de proposito: os dois
  // numeros ficavam lado a lado na mesma tela contando coisas diferentes.
  const stageCounts = new Map<string, number>();
  for (const deal of rows) {
    if (!noFunil(deal)) continue;
    stageCounts.set(deal.stage, (stageCounts.get(deal.stage) ?? 0) + 1);
  }

  return {
    rows,
    previousMonth: prevMonth,
    stats: statsOf(rows, perdas),
    previous,
    developers,
    stageCounts,
    brokers: rankBy(rows, "broker"),
    managers: rankBy(rows, "manager"),
    directors: rankBy(rows, "director"),
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
