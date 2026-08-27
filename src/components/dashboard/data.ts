/**
 * Dados do Dashboard: uma consulta por assunto, com chave estavel, e as
 * derivacoes puras que as telas consomem.
 *
 * Tudo que a tela carrega passa por `useQuery`. O padrao antigo era
 * `useEffect` + `useState` para escolher o mes, e ele tinha corrida: o efeito
 * escrevia o mes depois da primeira pintura, entao o filtro piscava "Todos" e
 * so depois assumia o mes aberto. Aqui o mes padrao e DERIVADO na renderizacao
 * (`defaultMonth`) — nao ha estado para dessincronizar.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { compareMonth, isProducao, isResultado, normalizeStatus, pickOpenMonth } from "@/lib/dealStatus";
import { developerColor, type ChartToken } from "@/lib/tone";
import {
  displayMonthToIso,
  getGlobalMonthlyGoal,
  listLegacyLeads,
  loadDashboardPayload,
  type DashboardPayload,
  type LegacyDealRecord,
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

/**
 * Carga unica do painel: negocios, leads por canal, CCA, staff e meses
 * fechados. `loadDashboardPayload` ja resolve tudo em paralelo no Supabase.
 */
export function useDashboardPayload() {
  const query = useQuery({
    queryKey: ["dashboard", "payload"],
    queryFn: loadDashboardPayload,
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

  const months = useMemo(() => {
    const seen = new Set(deals.map((deal) => deal.month_base));
    return Array.from(seen).sort((a, b) => compareMonth(b, a));
  }, [deals]);

  // O mes aberto mais recente. `pickOpenMonth` cai no mes corrente quando todos
  // estao fechados, e esse mes pode nao ter negocio nenhum — nesse caso o
  // seletor mostraria um valor que nao esta na lista.
  const defaultMonth = useMemo(() => {
    if (!months.length) return ALL_MONTHS;
    const preferred = pickOpenMonth(months, closedMonths);
    return months.includes(preferred) ? preferred : months[0];
  }, [months, closedMonths]);

  return { query, deals, months, closedMonths, defaultMonth, payload };
}

/** Meta global de vendas do mes em `goals` (scope 'global', metric 'sales'). */
export function useSalesGoal(activeMonth: string) {
  return useQuery({
    queryKey: ["dashboard", "sales-goal", activeMonth],
    queryFn: () => getGlobalMonthlyGoal("sales", displayMonthToIso(activeMonth)),
    enabled: activeMonth !== ALL_MONTHS,
  });
}

/**
 * Lista completa de leads — so o painel de Leads precisa das linhas; o resto do
 * painel se vira com as contagens que `loadDashboardPayload` ja devolve.
 */
export function useDashboardLeads() {
  return useQuery({
    queryKey: ["dashboard", "leads"],
    queryFn: listLegacyLeads,
  });
}

/**
 * DISTRATO conta como perda no mes em que aconteceu, mas so quando existe uma
 * venda ANTERIOR do mesmo cliente — um "distrato" lancado no mesmo mes da
 * venda e correcao de digitacao, nao perda.
 */
const distratoIds = (deals: DealRow[]): Set<string> => {
  const vendasPorCliente = new Map<string, string[]>();
  for (const deal of deals) {
    if (!isResultado(deal.status) || !deal.client) continue;
    const meses = vendasPorCliente.get(deal.client) ?? [];
    meses.push(deal.month_base);
    vendasPorCliente.set(deal.client, meses);
  }

  const ids = new Set<string>();
  for (const deal of deals) {
    if (normalizeStatus(deal.status) !== "DISTRATO" || !deal.client) continue;
    const vendas = vendasPorCliente.get(deal.client) ?? [];
    if (vendas.some((mes) => compareMonth(mes, deal.month_base) < 0)) ids.add(deal.id);
  }
  return ids;
};

const statsOf = (rows: DealRow[], distratos: Set<string>): MonthStats => {
  const vendas = rows.filter((deal) => isResultado(deal.status));
  const propostas = rows.filter((deal) => isProducao(deal.status)).length;
  const quedas = rows.filter((deal) => normalizeStatus(deal.status) === "QUEDA").length;
  return {
    vendas: vendas.length,
    propostas,
    negocios: vendas.length + propostas,
    perdas: quedas + rows.filter((deal) => distratos.has(deal.id)).length,
    vgv: vendas.reduce((total, deal) => total + (deal.deal_value || 0), 0),
  };
};

const rankBy = (rows: DealRow[], idKey: "broker1_id" | "manager1_id" | "director1_id", nameKey: "broker1_name" | "manager1_name" | "director1_name"): RankRow[] => {
  const map = new Map<string, RankRow>();
  for (const deal of rows) {
    const id = deal[idKey];
    if (!isResultado(deal.status) || !id) continue;
    const entry = map.get(id) ?? { id, name: deal[nameKey] || "Sem nome", vendas: 0, vgv: 0 };
    entry.vendas += 1;
    entry.vgv += deal.deal_value || 0;
    map.set(id, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
};

/**
 * Tudo que depende do mes selecionado, em um `useMemo` so.
 *
 * `previous` e o mesmo calculo no mes anterior — e dele que sai o delta dos
 * KPIs. Com "todos os meses" nao ha com o que comparar e o delta some.
 */
export function useMonthView(deals: DealRow[], activeMonth: string) {
  return useMemo(() => {
    const distratos = distratoIds(deals);
    const inMonth = (month: string) =>
      month === ALL_MONTHS ? deals : deals.filter((deal) => deal.month_base === month);

    const rows = inMonth(activeMonth);
    const prevMonth = activeMonth === ALL_MONTHS ? null : previousMonth(activeMonth);
    const previous = prevMonth ? statsOf(inMonth(prevMonth), distratos) : null;

    // A lista de construtoras sai de TODOS os negocios: uma construtora sem
    // negocio no mes continua na grade, com zero, em vez de sumir.
    const devNames = Array.from(
      new Set(deals.map((deal) => deal.developer.trim().toUpperCase()).filter(Boolean)),
    ).sort();

    const developers: DeveloperStats[] = devNames.map((dev) => {
      const devRows = rows.filter((deal) => deal.developer.trim().toUpperCase() === dev);
      const vendas = devRows.filter((deal) => isResultado(deal.status));
      const propostas = devRows.filter((deal) => isProducao(deal.status));
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

    const stageCounts = new Map<string, number>();
    for (const deal of rows) {
      if (!deal.active) continue;
      stageCounts.set(deal.stage, (stageCounts.get(deal.stage) ?? 0) + 1);
    }

    return {
      rows,
      previousMonth: prevMonth,
      stats: statsOf(rows, distratos),
      previous,
      developers,
      stageCounts,
      brokers: rankBy(rows, "broker1_id", "broker1_name"),
      managers: rankBy(rows, "manager1_id", "manager1_name"),
      directors: rankBy(rows, "director1_id", "director1_name"),
    };
  }, [deals, activeMonth]);
}

/** Vendas por mes do calendario, uma serie por ano — o comparativo anual. */
export function useMonthlySeries(deals: DealRow[]): MonthlySeries {
  return useMemo(() => {
    const byMonth = new Map<string, Record<string, number>>();
    for (let month = 1; month <= 12; month += 1) byMonth.set(String(month).padStart(2, "0"), {});

    const years = new Set<string>();
    for (const deal of deals) {
      const [mm, yyyy] = deal.month_base.split("/");
      years.add(yyyy);
      if (!isResultado(deal.status)) continue;
      const bucket = byMonth.get(mm);
      if (bucket) bucket[yyyy] = (bucket[yyyy] ?? 0) + 1;
    }

    return {
      rows: Array.from(byMonth, ([mes, counts]) => ({ mes, ...counts })),
      years: Array.from(years).sort(),
    };
  }, [deals]);
}
