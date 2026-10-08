import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ccaColumnOf, ccaColumnStatusAllowed, foraDaEsteiraDoCca, loadCcaBoard, periodoCcaPreset, periodoValido, ultimos30Dias, type CcaStage,
} from "./ccaData";

const h = vi.hoisted(() => ({
  urls: [] as URL[],
  caseError: null as { code: string; message: string } | null,
  listLegacyDeals: vi.fn(async (_signal?: AbortSignal, opts?: { ids?: string[] }) =>
    (opts?.ids ?? []).map((id) => ({ id, client: `Cliente ${id}`, cpf: "12345678900", status: id === "d2" ? "13. Esteira Ágil" : "EM ANÁLISE", developer: "", project: "", broker1: "", deal_value: 0, notes: "" }))),
}));

// Cliente do Supabase de verdade atrás de um `fetch` falso: o que se confere é
// a URL que iria ao PostgREST.
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const tabelas: Record<string, unknown[]> = {
    cca_stages: [{ id: "s1", name: "EM ANÁLISE", color: "info", position: 1, status: "under_review", active: true, deal_status_id: null }],
    // Como o banco devolve com submitted_at asc: o mais antigo primeiro.
    cca_cases: [
      { id: "k2", deal_id: "d2", status: "under_review", stage_id: "s1", decision_notes: null, submitted_at: "2026-09-01T12:00:00Z", stage_entered_at: "2026-09-02T12:00:00Z" },
      { id: "k1", deal_id: "d1", status: "under_review", stage_id: "s1", decision_notes: null },
      // A coluna antiga fica para auditoria; devolver ao comercial muda apenas
      // o status para cancelled. Mesmo que uma resposta em cache ainda traga a
      // linha, ela não pode reaparecer no quadro.
      { id: "k3", deal_id: "d3", status: "cancelled", stage_id: "s1", decision_notes: "Devolvido" },
    ],
  };
  const fetchFalso = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    h.urls.push(url);
    if (url.pathname.endsWith("/cca_cases") && h.caseError && url.searchParams.get("select")?.includes("stage_entered_at")) {
      return new Response(JSON.stringify(h.caseError), { status: 400, headers: { "content-type": "application/json" } });
    }
    const linhas = tabelas[url.pathname.replace("/rest/v1/", "")] ?? [];
    const selected = url.searchParams.get("select")?.split(",") ?? [];
    const payload = url.pathname.endsWith("/cca_cases") ? linhas.map(row => Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(([key]) => selected.includes(key)),
    )) : linhas;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": `0-${linhas.length - 1}/${linhas.length}` },
    });
  };
  return {
    supabase: createClient("http://fake.local", "anon", {
      global: { fetch: fetchFalso },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});

vi.mock("@/integrations/supabase/newSchema", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/newSchema")>()),
  listLegacyDeals: h.listLegacyDeals,
}));

const coluna = (id: string, status: CcaStage["status"], position: number): CcaStage => ({
  id, name: id, color: "info", position, status,
});

// Colunas ATIVAS, por posição, como `loadCcaBoard` as recebe.
const ativas = [
  coluna("em-analise", "under_review", 1),
  coluna("pendente", "pending_documents", 2),
  coluna("aprovado-total", "approved", 5),
  coluna("aprovado-cond", "approved", 7),
];

describe("ccaColumnOf · onde o caso aparece no quadro", () => {
  it("usa o estágio do caso quando ele está entre os ativos", () => {
    expect(ccaColumnOf(ativas, { stage_id: "aprovado-cond", status: "approved" })?.id).toBe("aprovado-cond");
  });

  it("põe o Status 2 Esteira Ágil na coluna Esteira Ágil, mesmo com stage_id antigo", () => {
    const colunas = [
      { ...coluna("agil", "under_review", 1), name: "ESTEIRA ÁGIL" },
      { ...coluna("processando", "under_review", 2), name: "EM PROCESSAMENTO" },
    ];
    expect(ccaColumnOf(colunas, { stage_id: "processando", status: "under_review" }, "13. ESTEIRA AGIL")?.id)
      .toBe("agil");
  });

  it("prefere a coluna ligada ao Status 2 antes do stage_id histórico", () => {
    const colunas = [
      { ...coluna("pendente", "pending_documents", 1), deal_status: { label: "16. PENDENTE" } },
      { ...coluna("processando", "under_review", 2), deal_status: { label: "12. EM PROCESSAMENTO" } },
    ];
    expect(ccaColumnOf(colunas, { stage_id: "processando", status: "under_review" }, "16. PENDENTE")?.id)
      .toBe("pendente");
  });

  it("estágio desativado ou nulo cai na primeira coluna de mesmo desfecho", () => {
    expect(ccaColumnOf(ativas, { stage_id: "aprovado-antigo", status: "approved" })?.id).toBe("aprovado-total");
    expect(ccaColumnOf(ativas, { stage_id: null, status: "pending_documents" })?.id).toBe("pendente");
  });

  // Antes caía em `stages[0]`: os casos cancelados apareciam em "EM ANÁLISE".
  it("sem coluna do desfecho o caso sai do quadro", () => {
    expect(ccaColumnOf(ativas, { stage_id: "distrato-queda", status: "cancelled" })).toBeUndefined();
  });
});

describe("ccaColumnStatusAllowed · o que a coluna pode gravar", () => {
  it("recusa rótulo de envio e desfecho, com prefixo, caixa e NBSP", () => {
    for (const valor of [
      "13. ESTEIRA AGIL", "15. ANÁLISE P/ VIRAR NEGÓCIO",
      "18. QUEDA", "OFF", "OFF - SEM RETORNO", "17. DISTRATO", "13.\u00a0esteira agil",
    ]) {
      expect(ccaColumnStatusAllowed(valor), valor).toBe(false);
    }
  });

  // "RET. ESTEIRA AGIL" é o Status 2 da coluna RETORNO À ESTEIRA ÁGIL (15/09).
  it("aceita o Status 2 comum das colunas e o do retorno à esteira ágil", () => {
    for (const valor of [
      "16. PENDENTE", "09. APROV. TOTAL", "EM ANÁLISE", "19. REPROVADO", "OFFICE",
      "RET. ESTEIRA AGIL", "ret. esteira agil",
    ]) {
      expect(ccaColumnStatusAllowed(valor), valor).toBe(true);
    }
  });
});

describe("período da esteira", () => {
  it("abre em hoje-30 até hoje no calendário de São Paulo, não no UTC", () => {
    // 02:00 UTC do dia 15 ainda é noite do dia 14 em São Paulo.
    expect(ultimos30Dias(new Date("2026-09-15T02:00:00Z"))).toEqual({ de: "2026-08-15", ate: "2026-09-14" });
  });

  it("só vale completo e em ordem — o meio da digitação do ano não vira consulta", () => {
    expect(periodoValido({ de: "2026-09-15", ate: "2026-09-15" })).toBe(true);
    expect(periodoValido({ de: "2026-09-16", ate: "2026-09-15" }), "início depois do fim").toBe(false);
    expect(periodoValido({ de: "", ate: "2026-09-15" }), "campo apagado").toBe(false);
    expect(periodoValido({ de: "0202-08-16", ate: "2026-09-15" }), "ano pela metade").toBe(false);
  });

  it("oferece hoje, ontem, semana, mês e mês passado no calendário de São Paulo", () => {
    const agora = new Date("2026-10-08T15:00:00Z");
    expect(periodoCcaPreset("hoje", agora)).toEqual({ de: "2026-10-08", ate: "2026-10-08" });
    expect(periodoCcaPreset("ontem", agora)).toEqual({ de: "2026-10-07", ate: "2026-10-07" });
    expect(periodoCcaPreset("semana", agora)).toEqual({ de: "2026-10-05", ate: "2026-10-08" });
    expect(periodoCcaPreset("mes", agora)).toEqual({ de: "2026-10-01", ate: "2026-10-08" });
    expect(periodoCcaPreset("mes_passado", agora)).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
  });
});

describe("loadCcaBoard · só o período, filtrado no banco", () => {
  beforeEach(() => { h.urls.length = 0; h.caseError = null; });

  it("mantém a esteira disponível no banco anterior ao contador, sem inventar a data do status", async () => {
    h.caseError = { code: "42703", message: "column cca_cases.stage_entered_at does not exist" };
    const board = await loadCcaBoard({ de: "2026-09-01", ate: "2026-09-30" });
    expect(board.deals).toHaveLength(2);
    expect(board.deals[0]).toMatchObject({ client: "Cliente d2", stageEnteredAt: null, submittedAt: "2026-09-01T12:00:00Z" });
    const requests = h.urls.filter(url => url.pathname.endsWith("/cca_cases"));
    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get("select")).not.toContain("stage_entered_at");
    expect(requests[1].searchParams.get("order")).toBe("submitted_at.asc,id.asc");
  });

  it.each([
    { code: "42501", message: "permission denied for table cca_cases" },
    { code: "42703", message: "column cca_cases.stage_id does not exist" },
  ])("não esconde outro erro: $code $message", async error => {
    h.caseError = error;
    await expect(loadCcaBoard({ de: "2026-09-01", ate: "2026-09-30" })).rejects.toMatchObject(error);
    expect(h.urls.filter(url => url.pathname.endsWith("/cca_cases"))).toHaveLength(1);
  });

  it("filtra e ordena os casos na consulta e pede só os negócios deles", async () => {
    const board = await loadCcaBoard({ de: "2026-08-16", ate: "2026-12-31" });

    const casos = h.urls.find((url) => url.pathname.endsWith("/cca_cases"));
    // Fim inclusivo: até a meia-noite de São Paulo do dia seguinte, virando o ano.
    expect(casos?.searchParams.getAll("submitted_at")).toEqual([
      "gte.2026-08-16T00:00:00-03:00", "lt.2027-01-01T00:00:00-03:00",
    ]);
    expect(casos?.searchParams.get("order")).toBe("submitted_at.asc,id.asc");
    expect(casos?.searchParams.get("status")).toBe("neq.cancelled");
    expect(h.listLegacyDeals).toHaveBeenCalledWith(expect.anything(), { ids: ["d2", "d1"] });

    // Mantém a ordem do banco, com o nome do negócio e os registros do editor.
    expect(board.deals.map((deal) => deal.client)).toEqual(["Cliente d2", "Cliente d1"]);
    expect(board.negocios.map((deal) => deal.id)).toEqual(["d2", "d1"]);
    expect(board.deals[0]).toMatchObject({ cpf: "12345678900", agile: true, submittedAt: "2026-09-01T12:00:00Z", stageEnteredAt: "2026-09-02T12:00:00Z" });
    expect(board.deals[1].agile).toBe(false);
    expect(board.deals.some((deal) => deal.dealId === "d3"), "cancelado não volta pela coluna antiga").toBe(false);
  });
});

describe("foraDaEsteiraDoCca", () => {
  it("análise externa de construtora sem CCA próprio fica fora; a do CCA próprio e os demais status ficam", () => {
    const proprio = new Set(["tenda"]);
    expect(foraDaEsteiraDoCca("ANÁLISE EXTERNA", "MRV", proprio)).toBe(true);
    expect(foraDaEsteiraDoCca("ANÁLISE EXTERNA", " Tenda ", proprio)).toBe(false);
    expect(foraDaEsteiraDoCca("12. EM PROCESSAMENTO", "MRV", proprio)).toBe(false);
    expect(foraDaEsteiraDoCca("ANÁLISE EXTERNA", "MRV", null)).toBe(false);
  });
});
