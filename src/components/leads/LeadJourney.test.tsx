import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LeadJourney } from "./LeadJourney";
import type { LeadRecord } from "@/integrations/supabase/leads";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lead = (patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "lead", full_name: "Cliente", phone: null, phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "in_progress", funnel_stage: "warm", assigned_to: "broker", assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null, next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, roulette_misses: 0, created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z", name: "Cliente", whatsapp: "", source: "Site",
  broker_name: "Corretor", form_name: null, form_answers: {}, tracking: {},
  stage_changed_at: "2026-10-01T10:00:00Z", ...patch,
});

async function renderJourney(record: LeadRecord, writable = true) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const onMove = vi.fn();
  const onConvert = vi.fn();
  await act(async () => {
    root.render(<LeadJourney lead={record} writable={writable} onMove={onMove} onConvert={onConvert} />);
  });
  return {
    container, onMove, onConvert,
    cleanup: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

describe("LeadJourney", () => {
  it("orienta o próximo passo e termina na conversão", async () => {
    const view = await renderJourney(lead());
    expect(view.container.textContent).toMatch(/Agora:.*Apresente as melhores opções/i);
    expect(view.container.textContent).toMatch(/Próximo: Interesse confirmado/i);
    expect(view.container.textContent).toMatch(/DestinoConverter em negócio/i);
    await view.cleanup();
  });

  it("trata ausência de resposta como atenção, não como avanço", async () => {
    const view = await renderJourney(lead({ funnel_stage: "no_response" }));
    expect(view.container.textContent).toMatch(/não é retrocesso/i);
    expect(view.container.textContent).toMatch(/Próximo: Conversa iniciada/i);
    expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
    await view.cleanup();
  });

  it("mantém o destino visível, mas não oferece conversão em modo leitura", async () => {
    const view = await renderJourney(lead(), false);
    expect(view.container.textContent).toMatch(/Converter em negócio/i);
    expect(view.container.querySelector('button[aria-label^="Converter"]')).toBeNull();
    await view.cleanup();
  });
});
