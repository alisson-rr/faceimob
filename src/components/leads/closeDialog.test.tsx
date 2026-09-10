import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { LeadRecord } from "@/integrations/supabase/leads";
import { CloseLeadDialog } from "./CloseLeadDialog";

/**
 * Encerrar o lead como perdido ou descartado.
 *
 * É a saída que faltava no bloco inteiro: `next_action_at` vencido é o que
 * conta em `overdue_lead_count` e trava o check-in em 20 atrasados, e só
 * reagendar ou converter tirava o lead da conta. Na prática o bloqueio era
 * contornável por reagendamento infinito.
 *
 * Dois riscos, os dois cobrados aqui:
 *   · nada pré-selecionado — "Perdido" e "Sem interesse" prontos no campo
 *     fazem qualquer clique distraído gravar um motivo que ninguém escolheu
 *     (foi o defeito do `LoseDealDialog` do Pipeline);
 *   · o toast de sucesso só depois de o banco confirmar: `close_lead` recusa
 *     por RLS, e "Lead encerrado" com o lead intacto é pior que o erro.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// O jsdom não implementa o que o Select do Radix chama ao abrir a lista
// (rolagem e captura de ponteiro). Sem estes três, o diálogo estoura antes de
// o teste chegar às asserções — é limitação do ambiente, não do componente.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => undefined;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;

const invalidou = vi.fn(async () => undefined);
vi.mock("./data", () => ({ useInvalidateLeads: () => invalidou }));

const encerrar = vi.fn();
vi.mock("@/integrations/supabase/leads", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  closeLead: (...args: unknown[]) => encerrar(...args),
}));

const avisos: { title?: string; variant?: string }[] = [];
vi.mock("@/hooks/use-toast", () => ({
  toast: (payload: { title?: string; variant?: string }) => { avisos.push(payload); },
}));

const lead = (patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "l1", full_name: "Cliente Perdido", phone: null, phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "in_progress", funnel_stage: "warm", assigned_to: "eu", assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null,
  next_action_at: "2026-08-01T10:00:00Z",
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, roulette_misses: 0,
  created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
  name: "Cliente Perdido", whatsapp: "", source: "", broker_name: "Eu",
  form_name: null, form_answers: {}, tracking: {}, stage_changed_at: "2026-08-20T10:00:00Z",
  ...patch,
});

async function abrir() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<CloseLeadDialog lead={lead()} onClose={() => undefined} />);
  });
  return async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
}

const botao = (rotulo: RegExp) => [...document.body.querySelectorAll("button")]
  .find((b) => rotulo.test((b.textContent ?? "").trim()));

/** Escolhe uma opção de um `Select` do Radix pelo texto. */
const escolher = async (gatilho: RegExp, opcao: RegExp) => {
  const trigger = [...document.body.querySelectorAll<HTMLElement>('[role="combobox"]')]
    .find((element) => gatilho.test(element.textContent ?? ""));
  if (!trigger) throw new Error(`select não encontrado: ${gatilho}`);
  // O Radix abre por teclado; o clique do jsdom não dispara o pointer event.
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((element) => opcao.test(element.textContent ?? ""));
  if (!item) throw new Error(`opção não encontrada: ${opcao}`);
  await act(async () => { item.click(); });
};

beforeEach(() => {
  encerrar.mockReset();
  invalidou.mockClear();
  avisos.length = 0;
});

describe("CloseLeadDialog", () => {
  it("nada vem pré-selecionado e o botão nasce travado", async () => {
    const fechar = await abrir();

    expect(document.body.textContent).toMatch(/Escolha perdido ou descartado/i);
    expect(document.body.textContent).toMatch(/Escolha o motivo/i);
    expect(botao(/^encerrar lead$/i)?.disabled, "sem escolha não se encerra nada").toBe(true);

    await fechar();
  });

  it("com status e motivo escolhidos, grava o que foi escolhido", async () => {
    encerrar.mockResolvedValue(undefined);
    const fechar = await abrir();

    await escolher(/Escolha perdido ou descartado/i, /^Perdido/);
    await escolher(/Escolha o motivo/i, /Comprou com concorrente/);

    const confirmar = botao(/^encerrar lead$/i);
    expect(confirmar?.disabled).toBe(false);
    await act(async () => { confirmar?.click(); });

    expect(encerrar).toHaveBeenCalledWith("l1", "lost", "Comprou com concorrente");
    expect(avisos.at(-1)?.title).toMatch(/perdido/i);
    expect(invalidou, "a lista precisa refletir o lead que saiu da operação").toHaveBeenCalled();

    await fechar();
  });

  it("recusa do banco não vira toast de sucesso", async () => {
    encerrar.mockRejectedValue(Object.assign(new Error("close_lead"), {
      db: { code: "42501", message: "Sem permissão para encerrar este lead." },
    }));
    const fechar = await abrir();

    await escolher(/Escolha perdido ou descartado/i, /^Descartado/);
    await escolher(/Escolha o motivo/i, /Contato inválido/);
    await act(async () => { botao(/^encerrar lead$/i)?.click(); });

    expect(encerrar).toHaveBeenCalledWith("l1", "discarded", "Contato inválido");
    expect(avisos.at(-1)?.variant, "o lead continua aberto no servidor").toBe("destructive");
    expect(avisos.some((aviso) => /descartado/i.test(aviso.title ?? ""))).toBe(false);

    await fechar();
  });
});
