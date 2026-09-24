import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import type { DealRow } from "./data";
import { buildLeadershipReport, leadershipScopes, loadLeadershipContext, type LeadershipContext, type ReportGoal } from "./leadershipData";

const h = vi.hoisted(() => ({ urls: [] as { url: URL; method: string }[], leadError: false }));
const teams = [{ id: "team-a", manager_id: "manager", director_id: "director" },
  { id: "team-b", manager_id: "manager", director_id: "director" }];
const members = [{ team_id: "team-a", profile_id: "broker" }, { team_id: "team-b", profile_id: "broker" }];
const people = [{ id: "director", name: "Diretor", active: true, roles: ["director", "broker"] },
  { id: "manager", name: "Gerente", active: true, roles: ["manager", "broker"] },
  { id: "old", name: "Desligado", active: false, roles: ["manager"] }] as PersonRecord[];

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("http://fake.local", "anon", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      h.urls.push({ url, method: init?.method ?? "GET" });
      if (url.pathname.endsWith("/leads")) return h.leadError
        ? new Response(null, { status: 403 })
        : new Response(null, { status: 200, headers: { "content-range": "0-0/1432" } });
      const rows = url.pathname.endsWith("/teams") ? teams : url.pathname.endsWith("/team_members") ? members : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: {
        "content-type": "application/json", "content-range": `0-${rows.length - 1}/${rows.length}`,
      } });
    },
  } }) };
});

const goal = (metric: string, target: number, extra = {}): ReportGoal => ({ scope: "profile", profile_id: "director", team_id: null, metric, target, ...extra });
const deal = (id: string, patch: Partial<DealRow> = {}): DealRow => ({ id, month_base: "09/2026", outcome: "open", status: "PROPOSTA",
  director1_id: "director", director1_name: "Diretor", manager1_id: "manager", manager1_name: "Gerente", deal_value: 200_000, ...patch } as DealRow);
const context = (goals: ReportGoal[] = []): LeadershipContext => ({ scopes: leadershipScopes(people, teams, members), goals,
  leads: { "director:director": 1432, "manager:manager": 1432 } });

describe("relatório da operação", () => {
  it("conta gestores de equipe que não são membros e deduplica corretor de duas equipes", () => {
    const scopes = leadershipScopes(people, teams, members);
    expect(scopes).toHaveLength(2);
    expect(scopes[0].profileIds).toEqual(["director", "manager", "broker"]);
    expect(scopes[1].profileIds).toEqual(["manager", "broker"]);
  });

  it("separa Ágil, Virou Negócio, vendas/VGV e OFF no mês-base, sem duplicar slots", () => {
    const deals = [deal("agil", { status: "13. Esteira Ágil" }), deal("neg", { status: "08. VIROU NEGÓCIO" }),
      deal("analise", { status: "15. ANÁLISE P/ VIRAR NEGÓCIO" }), deal("venda", { outcome: "won", director2_id: "director", director2_name: "Diretor", deal_value: 123_456.78 }),
      deal("off", { status: "OFF - SEM RETORNO", outcome: "lost" }), deal("distrato", { status: "17. DISTRATO", outcome: "lost" }),
      deal("fora", { outcome: "won", month_base: "08/2026" }), deal("fechado", { status: "NEGÓCIO FECHADO" })];
    const [director] = buildLeadershipReport(deals, context([goal("sales", 4), goal("sales_comp", 8)]), "09/2026");
    expect(director).toMatchObject({ sales: 1, vgv: 123_456.78, agile: 1, business: 2, off: 1, goal: 4, compensationGoal: 8, reached: 25, leads: 1432 });
    expect(buildLeadershipReport(deals, context(), "all")[0]).toMatchObject({ sales: 2, goal: null, reached: null });
  });

  it("não copia meta operacional para remuneração nem trata cadastro ausente como zero", () => {
    const [director] = buildLeadershipReport([], context([goal("sales", 0)]), "09/2026");
    expect(director).toMatchObject({ goal: 0, compensationGoal: null, reached: null, sales: 0 });
  });

  it("soma metas completas das equipes; meta própria prevalece, mesmo zero", () => {
    const goals = [goal("sales", 3, { scope: "team", team_id: "team-a", profile_id: null }),
      goal("sales", 5, { scope: "team", team_id: "team-b", profile_id: null })];
    expect(buildLeadershipReport([], context(goals), "09/2026")[0].goal).toBe(8);
    expect(buildLeadershipReport([], context(goals.slice(0, 1)), "09/2026")[0].goal).toBeNull();
    expect(buildLeadershipReport([], context([...goals, goal("sales", 0)]), "09/2026")[0].goal).toBe(0);
  });
});

describe("consulta do relatório", () => {
  beforeEach(() => { h.urls.length = 0; h.leadError = false; });
  it("conta mais de 1.000 leads por HEAD no mês escolhido, com limite exclusivo no próximo mês", async () => {
    const data = await loadLeadershipContext("12/2026", people, new AbortController().signal);
    expect(data.leads["director:director"]).toBe(1432);
    const lead = h.urls.find(r => r.url.pathname.endsWith("/leads"))!;
    expect(lead.method).toBe("HEAD");
    expect(lead.url.searchParams.getAll("created_at")).toEqual(["gte.2026-12-01T00:00:00-03:00", "lt.2027-01-01T00:00:00-03:00"]);
    expect(lead.url.searchParams.get("assigned_to")).toBe("in.(director,manager,broker)");
    expect(h.urls.find(r => r.url.pathname.endsWith("/goals"))!.url.searchParams.get("period")).toBe("eq.2026-12-01");
  });
  it("falha de leitura de leads não vira zero no relatório", async () => {
    h.leadError = true;
    await expect(loadLeadershipContext("09/2026", people, new AbortController().signal)).rejects.toThrow("leads:");
  });
});
