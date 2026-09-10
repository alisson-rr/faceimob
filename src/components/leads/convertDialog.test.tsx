import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { LeadRecord } from "@/integrations/supabase/leads";
import { ConvertLeadDialog } from "./ConvertLeadDialog";

/**
 * Os dois controles do diálogo de conversão que enganavam quem os usa.
 *
 *   · a caixa "reabrir e converter" era um `<label>` em volta do Checkbox do
 *     Radix — que é um `button` sem texto dentro. O leitor de tela anunciava
 *     "caixa de seleção, não marcada", sem dizer o quê, e é ela que reabre um
 *     lead perdido e cria o negócio que entra no rateio da comissão.
 *   · o dropzone dizia aceitar "qualquer arquivo", mas o upload acontece ANTES
 *     da conversão e `rejectAttachment` recusa fora da lista do bucket: o
 *     usuário preenchia o formulário inteiro e recebia "Não foi possível
 *     converter", um erro que fala do negócio e não do arquivo.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./data", () => ({
  useDevelopers: () => ({ data: [{ id: "d1", name: "Construtora Um" }], isPending: false, error: null }),
  useDeveloperProjects: () => ({ data: [], isPending: false, error: null }),
  useInvalidateLeads: () => async () => undefined,
}));

const lead = (patch: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "l1", full_name: "Cliente Conversão", phone: null, phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "lost", funnel_stage: "new", assigned_to: null, assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null, next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: "Sem retorno",
  lost_at: null, notes: null, roulette_misses: 0, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
  name: "Cliente Conversão", whatsapp: "", source: "", broker_name: "Corretor",
  form_name: null, form_answers: {}, tracking: {}, stage_changed_at: "2026-08-20T10:00:00Z",
  ...patch,
});

async function abrir(patch: Partial<LeadRecord> = {}) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<ConvertLeadDialog lead={lead(patch)} onClose={() => undefined} />);
  });
  return async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
}

const escolher = async (arquivo: File) => {
  const entrada = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  if (!entrada) throw new Error("o diálogo não tem seletor de arquivo");
  Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
  await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); });
  return entrada;
};

describe("ConvertLeadDialog", () => {
  it("a caixa de reabrir tem rótulo associado, não um label vazio", async () => {
    const fechar = await abrir();

    const caixa = document.body.querySelector('[role="checkbox"]');
    expect(caixa, "lead perdido precisa da confirmação de reabertura").toBeTruthy();
    expect(caixa?.id, "sem id não há como o Label apontar para ele").toBeTruthy();
    const rotulo = document.body.querySelector(`label[for="${caixa!.id}"]`);
    expect(rotulo?.textContent).toMatch(/reabrir e converter/i);

    await fechar();
  });

  it("recusa o arquivo que o bucket não aceita na hora da escolha", async () => {
    const fechar = await abrir();

    // O que a tela promete é o que o bucket aceita (0056).
    const entrada = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    expect(entrada?.getAttribute("accept")).toMatch(/\.pdf/);
    expect(document.body.textContent).toMatch(/até 8 MB/i);

    await escolher(new File(["conteudo"], "fotos.zip", { type: "application/zip" }));
    // Recusado: o dropzone continua vazio, em vez de guardar o arquivo para
    // derrubar a conversão inteira lá na frente.
    expect(document.body.textContent).not.toMatch(/fotos\.zip/);
    expect(document.body.textContent).toMatch(/solte o documento/i);

    // Contraprova: um PDF entra.
    await escolher(new File(["%PDF-1.4"], "contrato.pdf", { type: "application/pdf" }));
    expect(document.body.textContent).toMatch(/contrato\.pdf/);

    await fechar();
  });
});
