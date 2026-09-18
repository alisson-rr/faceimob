import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/integrations/supabase/integrations";

/**
 * O laço que a tela de Integrações existe para fechar.
 *
 * A sonda do Brevo devolve, junto do veredito, a lista de remetentes que a
 * conta aceita — é o único caminho do admin para descobrir qual endereço serve
 * quando o valor gravado não presta (em 02/09/2026 `brevo/sender_email`
 * guardava a chave de API). O laço só fecha se, depois de gravar um endereço da
 * lista, a tela PARAR de acusar o valor antigo: o veredito velho ao lado do
 * toast de sucesso se lê como "a gravação não pegou".
 *
 * O caminho real (sonda → `/v3/senders` → conta de verdade) é cobrado em
 * `e2e/admin/crons.spec.ts`; aqui o que se cobra é a tela, com a resposta da
 * function simulada. Mesmo recorte de `MetaAdsSetup.test.tsx`: `react-dom`
 * puro, sem testing-library, e `vi.waitFor` no lugar de `act`.
 */
const cofre = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  setIntegrationSecret: vi.fn(),
  listCronJobsHealth: vi.fn(),
}));
vi.mock("@/integrations/supabase/integrations", () => cofre);

const cliente = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  // Interruptor do e-mail da CCA (`automation_settings.cca_move_email`, 0155).
  update: vi.fn(),
  emailLigado: false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: cliente.invoke },
    rpc: cliente.rpc,
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: { cca_move_email: cliente.emailLigado }, error: null }) }),
      update: (valores: unknown) => {
        cliente.update(valores);
        return { eq: () => ({ select: async () => ({ data: [{ id: true }], error: null }) }) };
      },
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const auth = vi.hoisted(() => ({ isAdmin: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => codigo === "settings.integrations", isAdmin: auth.isAdmin }),
}));

import AdminIntegrations from "./AdminIntegrations";

/** Chave de API no formato que de fato foi parar no slot do remetente. */
const CHAVE_DE_API = `xkeysib-${"a".repeat(81)}`;

/** Recusa por remetente: é o corpo que a function devolve com HTTP 502. */
const RECUSA = {
  ok: false,
  error: "A chave de API foi aceita, mas o remetente não serve: brevo/sender_email não é um e-mail.",
  remetentes: [
    { email: "controle@faceimob.com.br", ativo: true },
    { email: "pendente@faceimob.com.br", ativo: false },
    // Não é e-mail: não pode chegar à tela como se fosse endereço aceito.
    { email: CHAVE_DE_API, ativo: true },
  ],
};

const registro = (label: string): IntegrationRecord => ({
  id: `id-${label}`,
  provider: "brevo",
  label,
  active: true,
  has_secret: true,
  config: null,
  updated_at: "2026-09-02T14:30:00.000Z",
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar(cofreGravado: IntegrationRecord[] = [registro("api_key"), registro("sender_email")]) {
  cofre.listIntegrations.mockResolvedValue(cofreGravado);
  cofre.listCronJobsHealth.mockResolvedValue([]);
  cliente.rpc.mockResolvedValue({ data: [], error: null });
  // `supabase.functions.invoke` transforma não-2xx em erro e ZERA `data`: o
  // corpo (com a lista) só existe em `error.context`. Simular o 502 é o ponto —
  // era por aqui que a lista se perdia antes de chegar à tela.
  cliente.invoke.mockResolvedValue({
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(JSON.stringify(RECUSA), { status: 502 }),
    }),
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(<MemoryRouter><AdminIntegrations /></MemoryRouter>);

  const el = container;
  await vi.waitFor(() => {
    expect(el.querySelector("h1")).not.toBeNull();
    expect(el.textContent).not.toContain("Carregando integrações");
  });
  return el;
}

/**
 * Sempre reconsultado, nunca guardado numa variavel: `load()` devolve a tela ao
 * estado de carregamento, e os cartoes que voltam depois sao nos NOVOS. Uma
 * referencia presa ao no antigo congela o texto de antes de salvar — e um teste
 * que le um no descartado passa (ou falha) por motivo nenhum.
 */
const cartao = (el: HTMLElement, titulo: string) =>
  el.querySelector<HTMLElement>(`[role="group"][aria-label="${titulo}"]`)!;

const botao = (dentro: HTMLElement, rotulo: RegExp) =>
  Array.from(dentro.querySelectorAll("button")).find((b) => rotulo.test(b.textContent ?? ""))!;

/** Input controlado do React só enxerga o valor pelo setter nativo. */
const digitar = (campo: HTMLInputElement, valor: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  auth.isAdmin = false;
  cliente.emailLigado = false;
});

describe("AdminIntegrations · e-mail das movimentações da CCA", () => {
  const interruptor = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[id="cca-move-email"]')!;

  it("fica no cartão do remetente, nasce desligado e só o admin liga", async () => {
    const el = await montar();
    const brevo = cartao(el, "Brevo — remetente");

    await vi.waitFor(() => expect(interruptor(brevo)).not.toBeNull());
    expect(interruptor(brevo).getAttribute("aria-checked")).toBe("false");
    expect(interruptor(brevo).disabled).toBe(true);
    expect(brevo.textContent).toContain("Só o administrador liga ou desliga este envio.");
  });

  it("o admin liga e a tela grava cca_move_email", async () => {
    auth.isAdmin = true;
    const el = await montar();
    const brevo = cartao(el, "Brevo — remetente");

    await vi.waitFor(() => expect(interruptor(brevo)?.disabled).toBe(false));
    interruptor(brevo).click();

    await vi.waitFor(() => expect(interruptor(brevo).getAttribute("aria-checked")).toBe("true"));
    expect(cliente.update).toHaveBeenCalledWith({ cca_move_email: true });
  });

  it("sem a chave da Brevo no cofre, nem o admin liga — e a tela diz por quê", async () => {
    auth.isAdmin = true;
    const el = await montar([registro("sender_email")]);
    const brevo = cartao(el, "Brevo — remetente");

    await vi.waitFor(() => expect(interruptor(brevo)).not.toBeNull());
    await vi.waitFor(() => expect(brevo.textContent).toContain("Cadastre a chave de API e o remetente da Brevo antes de ligar."));
    expect(interruptor(brevo).disabled).toBe(true);
  });

  it("ligado e sem credencial, desligar continua possível", async () => {
    auth.isAdmin = true;
    cliente.emailLigado = true;
    const el = await montar([]);
    const brevo = cartao(el, "Brevo — remetente");

    await vi.waitFor(() => expect(interruptor(brevo)?.getAttribute("aria-checked")).toBe("true"));
    expect(interruptor(brevo).disabled).toBe(false);
  });
});

describe("AdminIntegrations · sonda do Brevo", () => {
  it("a região viva já existe antes do teste: anúncio inserido junto com o texto não é confiável", async () => {
    const el = await montar();

    const regiao = cartao(el, "Brevo — remetente").querySelector('[role="status"]');
    expect(regiao, "sem região persistente, o leitor de tela não anuncia o veredito").not.toBeNull();
    expect(regiao!.getAttribute("aria-live")).toBe("polite");
    expect(regiao!.textContent).toBe("");
  });

  it("recusa traz a lista, marca o não verificado e não deixa a chave de API virar remetente", async () => {
    const el = await montar();
    const brevo = cartao(el, "Brevo — remetente");

    botao(brevo, /Testar conexão/).click();

    await vi.waitFor(() => expect(brevo.textContent).toContain("A Brevo aceita estes remetentes"));
    expect(brevo.textContent).toContain("controle@faceimob.com.br");
    expect(brevo.textContent).toContain("(cadastrado, mas ainda não verificado)");
    expect(brevo.textContent).toContain("não é nenhum deles");
    // A lista vem da rede: o que não é e-mail não pode ser oferecido como
    // endereço — e a credencial não pode aparecer em lugar nenhum da tela.
    expect(el.textContent).not.toContain(CHAVE_DE_API);

    // O anúncio tem de carregar a saída, não só o veredito; e a redação do
    // resumo é diferente da frase visível de propósito, senão qualquer busca
    // por texto (a do E2E, a do Ctrl+F) casaria dois nós.
    const regiao = brevo.querySelector('[role="status"]')!;
    expect(regiao.textContent).toContain("remetente(s) cadastrados");
    expect(regiao.textContent).toContain("não está entre eles");
    const passeio = document.createTreeWalker(brevo, NodeFilter.SHOW_TEXT);
    let ocorrencias = 0;
    while (passeio.nextNode()) {
      if (/não é nenhum deles/.test(passeio.currentNode.textContent ?? "")) ocorrencias++;
    }
    expect(ocorrencias, "a mesma frase em dois nós quebra qualquer busca por texto").toBe(1);
  });

  it("gravar o remetente apaga o veredito do valor antigo nos DOIS cartões do par", async () => {
    cofre.setIntegrationSecret.mockResolvedValue("id-novo");
    const el = await montar();
    const remetente = () => cartao(el, "Brevo — remetente");
    const chave = () => cartao(el, "Brevo — chave de API");

    // Os dois cartões apontam para a MESMA sonda; o veredito velho tem de sair
    // dos dois, senão o cartão da chave segue acusando um valor já trocado.
    botao(remetente(), /Testar conexão/).click();
    botao(chave(), /Testar conexão/).click();
    await vi.waitFor(() => {
      expect(remetente().textContent).toContain("A Brevo aceita estes remetentes");
      expect(chave().textContent).toContain("A Brevo aceita estes remetentes");
    });

    digitar(remetente().querySelector("input")!, "controle@faceimob.com.br");
    botao(remetente(), /^Salvar/).click();

    await vi.waitFor(() => expect(cofre.setIntegrationSecret).toHaveBeenCalledTimes(1));
    expect(cofre.setIntegrationSecret.mock.calls[0].slice(0, 3))
      .toEqual(["brevo", "sender_email", "controle@faceimob.com.br"]);

    await vi.waitFor(() => {
      expect(el.textContent).not.toContain("Carregando integrações");
      expect(remetente().textContent, "a tela segue acusando o valor que acabou de ser trocado")
        .not.toContain("não é nenhum deles");
      expect(chave().textContent, "o par compartilha a sonda: o cartão da chave ficou com o veredito velho")
        .not.toContain("A Brevo aceita estes remetentes");
    });
    expect(remetente().querySelector('[role="status"]')!.textContent).toBe("");
  });

  it("o veredito de outra integração sobrevive: a limpeza é do par que foi trocado", async () => {
    cofre.setIntegrationSecret.mockResolvedValue("id-novo");
    const el = await montar();
    const openai = () => cartao(el, "OpenAI — chave de API");
    const remetente = () => cartao(el, "Brevo — remetente");

    cliente.invoke.mockResolvedValueOnce({ data: { ok: true, models: 42 }, error: null });
    botao(openai(), /Testar conexão/).click();
    await vi.waitFor(() => expect(openai().textContent).toContain("42 modelos"));

    digitar(remetente().querySelector("input")!, "controle@faceimob.com.br");
    botao(remetente(), /^Salvar/).click();

    await vi.waitFor(() => {
      expect(cofre.setIntegrationSecret).toHaveBeenCalledTimes(1);
      expect(el.textContent).not.toContain("Carregando integrações");
    });
    // Apagar tudo faria o admin perder um veredito que continua válido.
    expect(openai().textContent).toContain("42 modelos");
  });
});
