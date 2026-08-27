import { describe, expect, it } from "vitest";
import type { LeadRecord, LeadSource } from "@/integrations/supabase/leads";
import { emptyLeadFilters, hasActiveFilter, leadMetrics, matchesFilters, waNumber } from "./model";
import { rowsToLeads } from "./importSheet";

const lead = (patch: Partial<LeadRecord>): LeadRecord => ({
  id: "id", full_name: "Cliente", phone: null, phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "queued", funnel_stage: "new", assigned_to: null, assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null, next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
  name: patch.full_name ?? "Cliente", whatsapp: "", source: "", broker_name: null,
  form_name: null, form_answers: {}, tracking: {}, stage_changed_at: "2026-08-20T10:00:00Z",
  ...patch,
});

const source = (patch: Partial<LeadSource>): LeadSource => ({
  id: "s1", code: "s1", label: "Origem", channel: "meta", active: true, ...patch,
});

describe("matchesFilters", () => {
  const meta = lead({ full_name: "Ana Silva", name: "Ana Silva", email: "ana@ex.com", phone: "11988887777", source_id: "s1", status: "assigned", campaign_name: "Campanha Verão" });
  const semOrigem = lead({ id: "b", full_name: "Bruno", name: "Bruno", status: "queued" });

  it("sem filtro, todo lead passa", () => {
    expect(matchesFilters(meta, emptyLeadFilters)).toBe(true);
    expect(matchesFilters(semOrigem, emptyLeadFilters)).toBe(true);
  });

  it("a busca cobre nome, e-mail, telefone e campanha", () => {
    for (const term of ["ana", "ANA@EX", "98888", "verão"]) {
      expect(matchesFilters(meta, { ...emptyLeadFilters, search: term })).toBe(true);
    }
    expect(matchesFilters(semOrigem, { ...emptyLeadFilters, search: "ana" })).toBe(false);
  });

  it("'none' é lead sem origem, e não 'todas as origens'", () => {
    expect(matchesFilters(semOrigem, { ...emptyLeadFilters, source: "none" })).toBe(true);
    expect(matchesFilters(meta, { ...emptyLeadFilters, source: "none" })).toBe(false);
    expect(matchesFilters(meta, { ...emptyLeadFilters, source: "s1" })).toBe(true);
  });

  it("hasActiveFilter ignora busca só de espaço", () => {
    expect(hasActiveFilter(emptyLeadFilters)).toBe(false);
    expect(hasActiveFilter({ ...emptyLeadFilters, search: "   " })).toBe(false);
    expect(hasActiveFilter({ ...emptyLeadFilters, status: "queued" })).toBe(true);
  });
});

describe("leadMetrics", () => {
  it("conta atrasado pela mesma regra do banco: próxima ação vencida e lead vivo", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    const metrics = leadMetrics([
      lead({ id: "1", status: "queued" }),
      lead({ id: "2", status: "attending", next_action_at: "2026-08-25T12:00:00Z" }),
      lead({ id: "3", status: "in_progress", next_action_at: "2026-08-27T12:00:00Z" }),
      // Convertido com ação vencida não é atraso: saiu da operação.
      lead({ id: "4", status: "converted", next_action_at: "2026-08-01T12:00:00Z" }),
    ], now);

    expect(metrics).toEqual({ total: 4, queued: 1, attending: 2, converted: 1, overdue: 1 });
  });
});

describe("waNumber", () => {
  it("normaliza para dígitos com DDI e devolve vazio sem telefone", () => {
    expect(waNumber("(11) 98888-7777")).toBe("5511988887777");
    expect(waNumber("5511988887777")).toBe("5511988887777");
    expect(waNumber(null)).toBe("");
    expect(waNumber("---")).toBe("");
  });
});

describe("rowsToLeads", () => {
  const sources = [source({ id: "imp", label: "Leadfy", channel: "import" }), source({ id: "meta", label: "Meta Ads" })];
  const header = ["Cliente", "Telefone", "Email", "Fonte", "Observação"];
  const row = (n: number) => [`Cliente ${n}`, `1198888000${n}`, `c${n}@ex.com`, "Meta Ads", "veio do anúncio"];

  it("importa TODAS as linhas — a amostra de 10 é só da tabela (F03)", () => {
    const rows = [header, ...Array.from({ length: 30 }, (_, i) => row(i))];
    expect(rowsToLeads(rows, sources)).toHaveLength(30);
  });

  it("casa a origem pelo rótulo e cai na origem de importação quando não bate", () => {
    const parsed = rowsToLeads([header, row(1), ["Cliente X", "11999", "x@ex.com", "Origem que não existe", ""]], sources);
    expect(parsed[0].source_id).toBe("meta");
    expect(parsed[1].source_id).toBe("imp");
    // O rótulo cru sobrevive no UTM, que é o que permite auditar depois.
    expect(parsed[1].utm_source).toBe("Origem que não existe");
  });

  it("reconhece cabeçalhos alternativos e ignora linha sem nome", () => {
    const parsed = rowsToLeads([
      ["nome", "whatsapp", "e-mail"],
      ["Ana", "11988887777", "ana@ex.com"],
      ["", "", ""],
    ], sources);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ full_name: "Ana", phone: "11988887777", email: "ana@ex.com" });
  });
});
