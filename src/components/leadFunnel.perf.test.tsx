import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { LeadRecord } from "@/integrations/supabase/leads";

/**
 * Custo do cronômetro da trava sobre o funil de leads (Pipeline, aba Leads).
 *
 * 500 cartões abertos, 1 em trava na mão de quem olha. `waNumber` roda uma vez
 * por render de cartão, então vira o contador.
 */
const estado = vi.hoisted(() => ({ cartoes: 0, leads: [] as LeadRecord[] }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "eu" } }) }));
vi.mock("@/components/LeadDetailModal", () => ({ default: () => null }));
vi.mock("@/components/leads", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/leads")>();
  const noop = () => undefined;
  return {
    ...real,
    useOpenLeads: () => ({ data: estado.leads, error: null, isPending: false, refetch: noop }),
    useAutomationSettings: () => ({ data: undefined }),
    useTimeoutReleasesToday: () => ({ data: undefined }),
    useInvalidateLeads: () => noop,
    useLeadsRealtime: noop,
    waNumber: (phone: string | null) => { estado.cartoes += 1; return real.waNumber(phone); },
  };
});

import LeadFunnel from "./LeadFunnel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date("2026-09-13T12:00:00Z").getTime();

const lead = (i: number, patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: `l${i}`, full_name: `Cliente ${i}`, phone: "5511988770001", phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: "Campanha", adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "in_progress", funnel_stage: "new", assigned_to: "outro", assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: "2026-09-13T11:00:00Z", next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, roulette_misses: 0, created_at: "2026-09-13T10:00:00Z", updated_at: "2026-09-13T10:00:00Z",
  name: `Cliente ${i}`, whatsapp: "", source: "Meta", broker_name: "Corretor",
  form_name: null, form_answers: {}, tracking: {}, stage_changed_at: "2026-09-13T10:00:00Z",
  ...patch,
});

describe("LeadFunnel com 500 cartões e 1 lead em trava", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  it("mede renders de cartão por segundo e num evento realtime", async () => {
    const leads = Array.from({ length: 500 }, (_, i) => lead(i));
    leads[0] = lead(0, {
      status: "assigned", assigned_to: "eu", attend_deadline: new Date(T0 + 70_000).toISOString(),
    });
    estado.leads = leads;

    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => { root.render(<LeadFunnel actorName="Eu" onConvert={() => undefined} />); });
    expect(container.querySelector(".lead-funnel"), "o funil perdeu `lead-funnel`, gancho da regra de pintura em index.css").not.toBeNull();
    estado.cartoes = 0;

    for (let s = 0; s < 5; s += 1) {
      await act(async () => { vi.advanceTimersByTime(1_000); });
    }
    const porSegundo = estado.cartoes / 5;
    // Badge e botão "Atender" mostram os mesmos segundos.
    expect(container.textContent?.match(/01:05/g)?.length).toBe(2);
    for (let s = 5; s < 15; s += 1) {
      await act(async () => { vi.advanceTimersByTime(1_000); });
    }
    expect(container.textContent?.match(/00:55/g)?.length).toBe(2);
    expect(container.innerHTML).toContain("text-destructive");

    // Realtime no pior caso: lead novo no topo, um convertido saindo da lista,
    // um alterado e TODOS os demais como objetos novos (o TanStack só
    // reaproveita a referência de lead que ficou na mesma posição).
    estado.cartoes = 0;
    const recarga: LeadRecord[] = JSON.parse(JSON.stringify(leads));
    recarga.splice(10, 1);
    recarga[300] = { ...recarga[300], broker_name: "Outro corretor" };
    recarga.unshift(lead(500, { name: "Lead novo" }));
    estado.leads = recarga;
    await act(async () => { root.render(<LeadFunnel actorName="Eu" onConvert={() => undefined} />); });
    const realtime = estado.cartoes;
    expect(container.textContent).toContain("Outro corretor");
    expect(container.textContent).toContain("Lead novo");

    // Antes da correção (relógio de 1 s no funil, cartão sem memo): 500
    // cartões/s e 500 por evento realtime.
    expect(porSegundo, "cartões re-renderizados por segundo").toBe(0);
    // Só o lead novo e o que mudou.
    expect(realtime, "cartões re-renderizados no evento realtime").toBe(2);
    await act(async () => { root.unmount(); });
    container.remove();
  }, 180_000);
});
