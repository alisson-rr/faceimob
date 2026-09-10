import { describe, it, expect } from "vitest";
import {
  attendSecondsLeft, formatCountdown, canClaim, isLeadOverdue,
  sourcePerformance, describeLeadEvent, decorateLead, trackingFields,
  FUNNEL_STAGES, LEAD_STATUSES, funnelStageLabel,
  type LeadRecord,
} from "./leads";

const NOW = new Date("2026-07-30T12:00:00.000Z").getTime();

const lead = (overrides: Partial<LeadRecord> = {}): LeadRecord =>
  ({
    id: "lead-1",
    full_name: "Maria Souza",
    phone: "5551999990000",
    status: "assigned",
    funnel_stage: "new",
    assigned_to: "broker-1",
    attend_deadline: null,
    next_action_at: null,
    created_at: "2026-07-30T11:00:00.000Z",
    updated_at: "2026-07-30T11:00:00.000Z",
    converted_at: null,
    source: "Meta Ads",
    name: "Maria Souza",
    ...overrides,
  }) as LeadRecord;

describe("trava de atendimento", () => {
  it("conta o tempo restante a partir de attend_deadline", () => {
    const result = attendSecondsLeft(
      lead({ attend_deadline: "2026-07-30T12:04:00.000Z" }),
      NOW,
    );
    expect(result).toBe(240);
  });

  it("nunca devolve negativo quando o prazo já estourou", () => {
    const result = attendSecondsLeft(
      lead({ attend_deadline: "2026-07-30T11:55:00.000Z" }),
      NOW,
    );
    expect(result).toBe(0);
  });

  it("não mostra cronômetro em lead já assumido (claim zera o prazo)", () => {
    expect(attendSecondsLeft(lead({ status: "attending", attend_deadline: null }), NOW)).toBeNull();
  });

  it("não mostra cronômetro em lead na fila, sem dono", () => {
    expect(attendSecondsLeft(lead({ status: "queued", assigned_to: null }), NOW)).toBeNull();
  });

  it("formata mm:ss", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(-10)).toBe("00:00");
  });
});

describe("canClaim", () => {
  it("libera só para o corretor dono do lead aguardando atendimento", () => {
    expect(canClaim(lead(), "broker-1")).toBe(true);
  });

  it("bloqueia lead de outro corretor — é a trava contra atendimento duplo", () => {
    expect(canClaim(lead(), "broker-2")).toBe(false);
  });

  it("bloqueia lead que já está em atendimento", () => {
    expect(canClaim(lead({ status: "attending" }), "broker-1")).toBe(false);
  });

  it("bloqueia sem sessão", () => {
    expect(canClaim(lead(), null)).toBe(false);
  });
});

describe("isLeadOverdue (mesma regra de overdue_lead_count)", () => {
  it("é atrasado quando a próxima ação venceu e o lead está na operação", () => {
    expect(isLeadOverdue(lead({ status: "in_progress", next_action_at: "2026-07-30T10:00:00.000Z" }), NOW)).toBe(true);
  });

  it("não é atrasado sem próxima ação marcada", () => {
    expect(isLeadOverdue(lead({ status: "in_progress", next_action_at: null }), NOW)).toBe(false);
  });

  it("não conta lead convertido nem perdido", () => {
    expect(isLeadOverdue(lead({ status: "converted", next_action_at: "2026-07-30T10:00:00.000Z" }), NOW)).toBe(false);
    expect(isLeadOverdue(lead({ status: "lost", next_action_at: "2026-07-30T10:00:00.000Z" }), NOW)).toBe(false);
  });

  it("não é atrasado quando a próxima ação ainda está no futuro", () => {
    expect(isLeadOverdue(lead({ status: "assigned", next_action_at: "2026-07-30T18:00:00.000Z" }), NOW)).toBe(false);
  });
});

describe("etapas e status", () => {
  it("o funil só usa etapas que existem no enum lead_funnel_stage", () => {
    const enumStages = [
      "new", "first_contact", "no_response", "warm",
      "hot", "gathering_docs", "scheduled_visit", "qualified",
    ];
    expect(FUNNEL_STAGES.map((stage) => stage.key)).toEqual(enumStages);
  });

  it("convertido é status, não etapa de funil", () => {
    expect(FUNNEL_STAGES.some((stage) => stage.key === ("converted" as never))).toBe(false);
    expect(LEAD_STATUSES.some((status) => status.value === "converted")).toBe(true);
  });

  it("etapa desconhecida cai no próprio valor em vez de sumir", () => {
    expect(funnelStageLabel("etapa_nova")).toBe("etapa_nova");
    expect(funnelStageLabel(null)).toBe("—");
  });
});

describe("sourcePerformance", () => {
  it("mede conversão por origem e o tempo real até converter", () => {
    const result = sourcePerformance([
      { source: "Meta Ads", status: "converted", created_at: "2026-07-01T00:00:00.000Z", converted_at: "2026-07-11T00:00:00.000Z" },
      { source: "Meta Ads", status: "queued", created_at: "2026-07-20T00:00:00.000Z", converted_at: null },
      { source: "Indicação", status: "lost", created_at: "2026-07-02T00:00:00.000Z", converted_at: null },
    ]);

    const meta = result.find((row) => row.source === "Meta Ads");
    expect(meta).toMatchObject({ totalLeads: 2, converted: 1, conversionRate: 50, avgDaysToConvert: 10 });
    expect(result.find((row) => row.source === "Indicação")).toMatchObject({ conversionRate: 0, avgDaysToConvert: 0 });
  });

  it("agrupa lead sem origem em vez de descartar", () => {
    const result = sourcePerformance([
      { source: "", status: "queued", created_at: "2026-07-20T00:00:00.000Z", converted_at: null },
    ]);
    expect(result[0].source).toBe("Sem origem");
  });
});

describe("describeLeadEvent", () => {
  it("traduz mudança de etapa", () => {
    expect(describeLeadEvent({ kind: "stage_changed", from_value: "new", to_value: "hot" }))
      .toBe("Etapa alterada: Novo Lead → Lead Quente");
  });

  it("traduz mudança de status", () => {
    expect(describeLeadEvent({ kind: "status_changed", from_value: "assigned", to_value: "attending" }))
      .toBe("Status alterado: Aguardando atendimento → Em atendimento");
  });

  it("explica o motivo da devolução à fila", () => {
    expect(describeLeadEvent({ kind: "released", detail: { reason: "timeout" } }))
      .toBe("Devolvido à fila (prazo de atendimento estourou)");
  });

  it("nomeia o corretor da atribuição quando o perfil é conhecido", () => {
    const names = new Map([["broker-1", "João Lima"]]);
    expect(describeLeadEvent({ kind: "assigned", to_value: "broker-1" }, names))
      .toBe("Atribuído pela roleta: João Lima");
  });

  it("o encerramento diz o motivo, que é o que só ele registra", () => {
    // `close_lead` não regrava o `status_changed` (o gatilho `leads_log_changes`
    // já faz isso, e dois eventos iguais duplicavam a linha do histórico e a
    // conta de "quantos perdemos por preço"). Ele grava um evento próprio, e o
    // que esse evento carrega de novo é o motivo escolhido.
    expect(describeLeadEvent({
      kind: "closed", from_value: "in_progress", to_value: "lost",
      detail: { reason: "Preço — acima do orçamento" },
    })).toBe("Lead encerrado como Perdido: Preço — acima do orçamento");
  });

  it("o lead que saiu da roleta diz quantas voltas deu", () => {
    expect(describeLeadEvent({ kind: "unattended", detail: { misses: 5 } }))
      .toBe("Saiu da roleta sem atendimento (5 voltas)");
  });

  it("evento desconhecido aparece cru em vez de virar linha vazia", () => {
    expect(describeLeadEvent({ kind: "algo_novo" })).toBe("algo_novo");
  });
});

describe("decorateLead", () => {
  const sources = new Map([["src-1", "Meta Ads"]]);
  const brokers = new Map([["broker-1", "João Lima"]]);

  it("resolve rótulo da origem e nome do corretor", () => {
    const result = decorateLead(
      { id: "l1", full_name: "Ana", phone: "5551", source_id: "src-1", assigned_to: "broker-1", created_at: "x", updated_at: "y" },
      sources, brokers,
    );
    expect(result).toMatchObject({ name: "Ana", source: "Meta Ads", broker_name: "João Lima", whatsapp: "5551" });
  });

  it("cai no utm_source quando a origem não está catalogada", () => {
    const result = decorateLead(
      { id: "l2", full_name: "Ana", source_id: null, utm_source: "instagram", assigned_to: null, created_at: "x", updated_at: "y" },
      sources, brokers,
    );
    expect(result.source).toBe("instagram");
    expect(result.broker_name).toBeNull();
  });
});

describe("trackingFields", () => {
  it("expõe UTM e campanha e omite o que está vazio", () => {
    const fields = trackingFields(lead({
      utm_source: "facebook",
      utm_campaign: "lancamento-julho",
      campaign_name: "Lançamento Julho",
      utm_medium: null,
      ad_name: null,
    }));
    const labels = fields.map((field) => field.label);
    expect(labels).toContain("Origem (UTM)");
    expect(labels).toContain("Campanha (UTM)");
    expect(labels).toContain("Campanha");
    expect(labels).not.toContain("Mídia");
    expect(labels).not.toContain("Anúncio");
  });
});
